'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi, incomingInvoiceApi, analyticsApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useUserProfile } from '@/lib/userProfile';
import { NotificationBell } from '@/components/dashboard/NotificationBell';
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecentPayment {
  buyerName: string;
  amount: number;
  provider: string;
  paidAt: string;
}

interface RecentRejection {
  invoiceNumber: string;
  buyerName: string;
  rejectionReason: string | null;
  rejectedAt: string | null;
}

interface Stats {
  outstandingAmount?: number;
  outstandingInvoiceCount?: number;
  overdueCount?: number;
  outputVatOutstanding?: number;
  inputVatOutstanding?: number;
  netVatExposure?: number;
  collectedThisMonth?: number;
  rejectedCount?: number;
  rejected?: number;
  recentRejections?: RecentRejection[];
  incomingStats?: { total: number; toReview: number; approved: number; paid: number };
  recentPayments?: RecentPayment[];
}

interface IncomingStats {
  totalOutstanding?: number;
  outstandingCount?: number;
}

interface RevenueMonth {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-NG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatYAxis(value: number): string {
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(0)}K`;
  return `₦${value}`;
}

function providerColor(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('paystack')) return 'bg-green-50 text-green-700';
  if (p.includes('flutterwave')) return 'bg-orange-50 text-orange-700';
  if (p.includes('bank') || p.includes('transfer')) return 'bg-blue-50 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Custom tooltip for recharts ───────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-dark mb-1.5">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span className="text-muted capitalize">{entry.name}:</span>
          <span className="font-medium text-dark">{formatCurrency(entry.value, 'NGN')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const profile = useUserProfile();

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [incomingStats, setIncomingStats] = useState<IncomingStats | null>(null);
  const [incomingLoading, setIncomingLoading] = useState(true);

  const [revenueData, setRevenueData] = useState<RevenueMonth[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(true);

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    setIncomingLoading(true);
    setRevenueLoading(true);

    const statsResult = await invoiceApi.stats().catch(() => null);
    setStats(statsResult as Stats | null);
    setStatsLoading(false);

    const [incomingResult, revenueResult] = await Promise.allSettled([
      incomingInvoiceApi.stats(),
      analyticsApi.revenueVsExpenses(6),
    ]);

    setIncomingStats(
      incomingResult.status === 'fulfilled' ? (incomingResult.value as IncomingStats) : null,
    );
    setIncomingLoading(false);

    setRevenueData(
      revenueResult.status === 'fulfilled'
        ? (revenueResult.value as RevenueMonth[])
        : [],
    );
    setRevenueLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadData();
  }, [authLoading, loadData]);

  const firstName = profile?.firstName ?? user?.name?.split(' ')[0] ?? 'there';
  const tenantName = user?.tenantName ?? '';

  // Money card values
  const outstandingAmount = (stats as any)?.outstandingAmount ?? 0;
  const outstandingCount = (stats as any)?.outstandingInvoiceCount ?? 0;
  const overdueCount = (stats as any)?.overdueCount ?? 0;
  const outstandingPayables = (incomingStats as any)?.totalOutstanding ?? 0;
  const payablesCount = (incomingStats as any)?.outstandingCount ?? 0;
  const netCash = outstandingAmount - outstandingPayables;

  // VAT summary
  const outputVat = (stats as any)?.outputVatOutstanding ?? 0;
  const inputVat = (stats as any)?.inputVatOutstanding ?? 0;
  const netVat = outputVat - inputVat;

  // Attention data
  const rejectedCount = (stats as any)?.rejectedCount ?? (stats as any)?.rejected ?? 0;
  const toReview = (stats as any)?.incomingStats?.toReview ?? 0;
  const recentRejections: RecentRejection[] = (stats as any)?.recentRejections ?? [];
  const recentPayments: RecentPayment[] = (stats as any)?.recentPayments ?? [];

  // Attention banner — highest priority first
  const showRejections = !statsLoading && rejectedCount > 0;
  const showOverdue = !statsLoading && overdueCount > 0 && !showRejections;
  const showToReview = !statsLoading && toReview > 0 && !showRejections && !showOverdue;
  const showBanner = showRejections || showOverdue || showToReview;

  // Needs attention panel items (max 4)
  const attentionItems = [
    ...recentRejections.slice(0, 4).map((r) => ({
      type: 'rejected' as const,
      label: r.invoiceNumber ?? 'Unknown',
      sub: r.rejectionReason ?? 'Rejected by FIRS',
    })),
  ].slice(0, 4);

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-border px-6 py-5 flex items-start justify-between sticky top-0 z-10">
        <div>
          {authLoading ? (
            <>
              <Sk className="h-6 w-52 mb-2" />
              <Sk className="h-4 w-72" />
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-dark">
                {greeting()}, {firstName}
              </h1>
              <p className="text-sm text-muted mt-0.5">
                {todayLabel()}{tenantName ? ` · ${tenantName}` : ''}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <NotificationBell />
          <Link href="/invoices/new">
            <Button size="sm">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" className="mr-1.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create invoice
            </Button>
          </Link>
        </div>
      </header>

      <div className="p-6 space-y-5">

        {/* ── Attention banner ────────────────────────────────────────────── */}
        {showBanner && (
          <div className={`rounded-xl border-l-4 px-5 py-3.5 flex items-center justify-between gap-4 ${
            showRejections
              ? 'bg-red-50 border-l-red-500'
              : showOverdue
              ? 'bg-red-50 border-l-red-500'
              : 'bg-amber-50 border-l-amber-500'
          }`}>
            <div className="flex items-center gap-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={showRejections || showOverdue ? 'text-red-500' : 'text-amber-600'}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className={`text-sm font-medium ${showRejections || showOverdue ? 'text-red-800' : 'text-amber-800'}`}>
                {showRejections
                  ? `${rejectedCount} invoice${rejectedCount !== 1 ? 's' : ''} rejected by FIRS — fix now to stay compliant`
                  : showOverdue
                  ? `${overdueCount} invoice${overdueCount !== 1 ? 's' : ''} are overdue`
                  : `${toReview} received invoice${toReview !== 1 ? 's' : ''} need review`}
              </p>
            </div>
            <Link
              href={
                showRejections
                  ? '/invoices?tab=sent&status=rejected'
                  : showOverdue
                  ? '/invoices?tab=sent&filter=overdue'
                  : '/invoices?tab=received&filter=review'
              }
              className={`text-xs font-semibold shrink-0 hover:underline ${
                showRejections || showOverdue ? 'text-red-700' : 'text-amber-700'
              }`}
            >
              View →
            </Link>
          </div>
        )}

        {/* ── 3 Money cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          {/* Receivables */}
          <Link href="/payments" className="block">
            <div className="bg-white rounded-xl border border-border border-l-4 border-l-[#1D9E75] p-5 h-full hover:shadow-sm transition-shadow">
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Outstanding receivables</p>
              {statsLoading ? (
                <>
                  <Sk className="h-8 w-28 mb-2" />
                  <Sk className="h-3 w-36 mb-1" />
                  <Sk className="h-3 w-20" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-[#1D9E75]">{formatCurrency(outstandingAmount, 'NGN')}</p>
                  <p className="text-xs text-green-600 mt-1.5">
                    {outstandingCount} invoice{outstandingCount !== 1 ? 's' : ''} unpaid
                  </p>
                  {overdueCount > 0 && (
                    <p className="text-xs text-red-500 mt-0.5 font-medium">{overdueCount} overdue</p>
                  )}
                </>
              )}
            </div>
          </Link>

          {/* Payables */}
          <Link href="/invoices?tab=received" className="block">
            <div className={`bg-white rounded-xl border border-border border-l-4 p-5 h-full hover:shadow-sm transition-shadow ${
              outstandingPayables > 0 ? 'border-l-red-500' : 'border-l-gray-300'
            }`}>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Outstanding payables</p>
              {incomingLoading ? (
                <>
                  <Sk className="h-8 w-28 mb-2" />
                  <Sk className="h-3 w-36 mb-1" />
                </>
              ) : (
                <>
                  <p className={`text-2xl font-bold ${outstandingPayables > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {formatCurrency(outstandingPayables, 'NGN')}
                  </p>
                  <p className="text-xs text-muted mt-1.5">
                    {payablesCount} supplier invoice{payablesCount !== 1 ? 's' : ''}
                  </p>
                </>
              )}
            </div>
          </Link>

          {/* Net position */}
          <div className={`bg-white rounded-xl border border-border border-l-4 p-5 ${
            statsLoading || incomingLoading
              ? 'border-l-gray-200'
              : netCash > 0
              ? 'border-l-[#1D9E75]'
              : netCash < 0
              ? 'border-l-red-500'
              : 'border-l-gray-300'
          }`}>
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Net cash position</p>
            {statsLoading || incomingLoading ? (
              <>
                <Sk className="h-8 w-28 mb-2" />
                <Sk className="h-3 w-24" />
              </>
            ) : (
              <>
                <p className={`text-2xl font-bold ${
                  netCash > 0 ? 'text-[#1D9E75]' : netCash < 0 ? 'text-red-600' : 'text-gray-400'
                }`}>
                  {formatCurrency(Math.abs(netCash), 'NGN')}
                </p>
                <p className="text-xs text-muted mt-1.5">
                  {netCash > 0 ? 'Net receivable' : netCash < 0 ? 'Net payable' : 'Balanced'}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── VAT summary line ────────────────────────────────────────────── */}
        {!statsLoading && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <span>Output VAT: <span className="text-dark font-medium">{formatCurrency(outputVat, 'NGN')}</span></span>
            <span className="mx-1">·</span>
            <span>Input VAT: <span className="text-dark font-medium">{formatCurrency(inputVat, 'NGN')}</span></span>
            <span className="mx-1">·</span>
            <span>
              Net:{' '}
              <span className={`font-medium ${netVat > 0 ? 'text-red-600' : netVat < 0 ? 'text-[#1D9E75]' : 'text-dark'}`}>
                {netVat >= 0 ? '' : '-'}{formatCurrency(Math.abs(netVat), 'NGN')} {netVat > 0 ? 'payable' : netVat < 0 ? 'credit' : ''}
              </span>
            </span>
            <span className="mx-1">·</span>
            <Link href="/vat-return" className="text-[#1D9E75] font-medium hover:underline">View VAT return →</Link>
          </div>
        )}

        {/* ── Revenue vs Expenses chart ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-dark">Revenue vs expenses</h2>
              <p className="text-xs text-muted mt-0.5">Last 6 months</p>
            </div>
          </div>
          {revenueLoading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => <Sk key={i} className="h-10 w-full" />)}
              <Sk className="h-32 w-full" />
            </div>
          ) : revenueData.length === 0 || revenueData.every((d) => d.revenue === 0 && d.expenses === 0) ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" className="text-gray-300">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <p className="text-sm text-muted">No invoice data yet — create your first invoice to see trends</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={formatYAxis}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar dataKey="revenue" name="Revenue" fill="#1D9E75" radius={[3, 3, 0, 0]} maxBarSize={40} />
                <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3, 3, 0, 0]} maxBarSize={40} />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#3b82f6' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Bottom two panels ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Recent payments */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Recent payments</h2>
              <Link href="/payments" className="text-xs text-[#1D9E75] font-medium hover:underline">
                View all →
              </Link>
            </div>
            {statsLoading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-10 w-full" />)}
              </div>
            ) : recentPayments.length === 0 ? (
              <div className="py-12 flex flex-col items-center gap-3 text-center px-5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" className="text-gray-300">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                <p className="text-sm text-muted">No payments recorded yet</p>
                <Link href="/payments" className="text-xs text-[#1D9E75] font-medium hover:underline">
                  Record payment →
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recentPayments.slice(0, 4).map((p, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-dark truncate">{p.buyerName}</p>
                      <p className="text-xs text-muted mt-0.5">{timeAgo(p.paidAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerColor(p.provider)}`}>
                        {p.provider}
                      </span>
                      <span className="text-sm font-bold text-[#1D9E75]">{formatCurrency(p.amount, 'NGN')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Needs attention */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Needs attention</h2>
              <Link href="/invoices" className="text-xs text-[#1D9E75] font-medium hover:underline">
                View all →
              </Link>
            </div>
            {statsLoading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => <Sk key={i} className="h-10 w-full" />)}
              </div>
            ) : attentionItems.length === 0 && overdueCount === 0 ? (
              <div className="py-12 flex flex-col items-center gap-3 text-center px-5">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1D9E75]">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-dark">Everything is up to date</p>
                <p className="text-xs text-muted">No invoices need attention</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {attentionItems.map((item, i) => (
                  <li key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className={`mt-0.5 shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                      item.type === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {item.type === 'rejected' ? 'Rejected' : 'Overdue'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-dark truncate">{item.label}</p>
                      <p className="text-xs text-muted mt-0.5 truncate">{item.sub}</p>
                    </div>
                  </li>
                ))}
                {overdueCount > 0 && attentionItems.length < 4 && (
                  <li className="px-5 py-3 flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                      Overdue
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-dark">{overdueCount} invoice{overdueCount !== 1 ? 's' : ''} past due date</p>
                      <Link href="/invoices?tab=sent&filter=overdue" className="text-xs text-[#1D9E75] hover:underline">
                        View overdue invoices →
                      </Link>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
