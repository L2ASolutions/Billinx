'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  totalAmount: number;
  outstandingAmount?: number;
  overdueCount?: number;
  collectedThisMonth?: number;
  collectedLastMonth?: number;
  recentInvoices: RecentInvoice[];
}

interface RecentInvoice {
  id: string;
  platformIrn: string | null;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  createdAt: string;
}

interface QueueInvoice {
  id: string;
  platformIrn: string | null;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  updatedAt?: string;
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

function trendLabel(current: number, previous: number | undefined): string | null {
  if (previous == null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  return `${delta >= 0 ? '+' : ''}${Math.round(delta)}% vs last month`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

const PILL: Record<string, { label: string; cls: string }> = {
  ACCEPTED:              { label: 'Accepted',    cls: 'bg-green-50 text-green-700' },
  REJECTED:              { label: 'Rejected',    cls: 'bg-red-50 text-red-600' },
  DRAFT:                 { label: 'Draft',       cls: 'bg-gray-100 text-gray-500' },
  QUEUED:                { label: 'Pending',     cls: 'bg-amber-50 text-amber-700' },
  SUBMITTING:            { label: 'Submitting',  cls: 'bg-amber-50 text-amber-700' },
  SUBMITTED:             { label: 'Submitted',   cls: 'bg-blue-50 text-blue-700' },
  VALIDATING:            { label: 'Pending',     cls: 'bg-amber-50 text-amber-700' },
  VALIDATION_FAILED:     { label: 'Invalid',     cls: 'bg-red-50 text-red-600' },
  SUBMISSION_FAILED:     { label: 'Failed',      cls: 'bg-red-50 text-red-600' },
  DEAD_LETTERED:         { label: 'Dead letter', cls: 'bg-red-100 text-red-700' },
  CANCELLED:             { label: 'Cancelled',   cls: 'bg-gray-100 text-gray-500' },
  CANCELLATION_REQUESTED:{ label: 'Cancelling',  cls: 'bg-gray-100 text-gray-500' },
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  valueClass = 'text-dark',
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">{label}</p>
      {loading ? (
        <>
          <Sk className="h-9 w-16 mb-2" />
          <Sk className="h-3 w-28" />
        </>
      ) : (
        <>
          <p className={`text-3xl font-bold ${valueClass}`}>{value}</p>
          <p className="text-xs text-muted mt-1.5">{sub}</p>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useRequireAuth();

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [queue, setQueue] = useState<QueueInvoice[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    setQueueLoading(true);

    // Call 1 — stats (feeds all 4 metric cards + recent-invoices table)
    try {
      const statsData = await invoiceApi.stats();
      setStats(statsData as Stats);
    } catch {
      setStats(null);
    }
    setStatsLoading(false);

    // Call 2 — list (feeds submission queue + recent activity panels)
    try {
      const listData = await invoiceApi.list({ page: 1, limit: 5 } as Record<string, string | number>);
      setQueue((listData as { data: QueueInvoice[] }).data ?? []);
    } catch {
      setQueue([]);
    }
    setQueueLoading(false);

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadData();
  }, [authLoading, loadData]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const tenantName = user?.tenantName ?? '';
  const acceptanceRate =
    stats && stats.total > 0 ? Math.round((stats.accepted / stats.total) * 100) : 0;

  const outstandingAmount = stats?.outstandingAmount ?? 0;
  const overdueCount = stats?.overdueCount ?? 0;
  const collectedThisMonth = stats?.collectedThisMonth ?? 0;
  const trend = trendLabel(collectedThisMonth, stats?.collectedLastMonth);

  const lastRefreshedLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
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
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title={lastRefreshedLabel ? `Last refreshed ${lastRefreshedLabel}` : 'Refresh dashboard'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:bg-surface hover:text-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshIcon spinning={refreshing} />
            <span className="hidden sm:inline">
              {refreshing ? 'Refreshing…' : lastRefreshedLabel ? `Updated ${lastRefreshedLabel}` : 'Refresh'}
            </span>
          </button>
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

      <div className="p-6 space-y-6">
        {/* ── 4 Metric cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Invoices"
            value={String(stats?.total ?? 0)}
            sub={stats && stats.total > 0 ? `${stats.pending} pending` : 'No invoices yet'}
            loading={statsLoading}
          />
          <MetricCard
            label="FIRS Accepted"
            value={String(stats?.accepted ?? 0)}
            sub={stats && stats.total > 0 ? `${acceptanceRate}% acceptance rate` : 'No invoices yet'}
            valueClass="text-green-700"
            loading={statsLoading}
          />
          <MetricCard
            label="Outstanding Receivables"
            value={formatCurrency(outstandingAmount, 'NGN')}
            sub={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'}
            valueClass={overdueCount > 0 ? 'text-red-600' : 'text-dark'}
            loading={statsLoading}
          />
          <MetricCard
            label="Collected This Month"
            value={formatCurrency(collectedThisMonth, 'NGN')}
            sub={trend ?? 'All time'}
            loading={statsLoading}
          />
        </div>

        {/* ── FIRS status bar ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
            <span className="text-sm font-medium text-dark">FIRS MBS connection active</span>
          </div>
          <span className="text-sm text-muted">All submissions routing via Interswitch NRS</span>
          {lastRefreshedLabel && (
            <span className="text-sm text-muted lg:ml-auto">Last checked {lastRefreshedLabel}</span>
          )}
        </div>

        {/* ── Recent invoices table ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-dark">Recent invoices</h2>
            <Link href="/invoices" className="text-sm text-green font-medium hover:underline">
              View all →
            </Link>
          </div>

          {statsLoading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => <Sk key={i} className="h-10 w-full" />)}
            </div>
          ) : !stats?.recentInvoices?.length ? (
            <div className="py-16 flex flex-col items-center gap-4 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" className="text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-sm text-muted">No invoices yet.</p>
              <Link href="/invoices/new"><Button size="sm">Create invoice</Button></Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {(['Invoice #', 'Buyer', 'Date', 'Status', 'Amount'] as const).map((col, i) => (
                      <th key={col}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i === 4 ? 'text-right' : 'text-left'}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.recentInvoices.map((inv) => {
                    const pill = PILL[inv.status] ?? { label: inv.status.replace(/_/g, ' '), cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={inv.id}
                        className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                        <td className="px-6 py-3">
                          <Link href={`/invoices/${inv.id}`}
                            className="text-sm font-mono text-green hover:underline">
                            {inv.platformIrn ? inv.platformIrn.slice(0, 20) + '…' : inv.id.slice(0, 8) + '…'}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                        <td className="px-6 py-3 text-sm text-muted">{formatDate(inv.createdAt)}</td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                          {formatCurrency(inv.totalAmount, inv.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Bottom row: Submission queue + Recent activity ──────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Submission queue */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-dark">Submission queue</h2>
                {!queueLoading && stats && (
                  <span className="px-2 py-0.5 rounded-full bg-surface text-xs font-medium text-muted border border-border">
                    {stats.pending} pending
                  </span>
                )}
              </div>
              <Link href="/submissions" className="text-sm text-green font-medium hover:underline">
                View all →
              </Link>
            </div>
            {queueLoading ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2].map((i) => <Sk key={i} className="h-12 w-full" />)}
              </div>
            ) : queue.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted">No recent invoices</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {queue.map((inv) => {
                  const pill = PILL[inv.status] ?? { label: inv.status, cls: 'bg-gray-100 text-gray-600' };
                  return (
                    <li key={inv.id}
                      className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-surface transition-colors">
                      <div className="min-w-0">
                        <Link href={`/invoices/${inv.id}`}
                          className="text-sm font-mono text-green hover:underline block truncate">
                          {inv.platformIrn ? inv.platformIrn.slice(0, 18) + '…' : inv.id.slice(0, 8) + '…'}
                        </Link>
                        <p className="text-xs text-muted truncate mt-0.5">
                          {inv.buyerName} · {formatCurrency(inv.totalAmount, inv.currency)}
                        </p>
                      </div>
                      <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pill.cls}`}>
                        {pill.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Recent activity — derived from the same queue list; zero extra API calls */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Recent activity</h2>
            </div>
            {queueLoading ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2].map((i) => <Sk key={i} className="h-10 w-full" />)}
              </div>
            ) : queue.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted">No recent activity</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {queue.map((inv) => {
                  const pill = PILL[inv.status] ?? { label: inv.status, cls: 'bg-gray-100 text-gray-600' };
                  const isRejected = ['REJECTED', 'SUBMISSION_FAILED', 'DEAD_LETTERED', 'VALIDATION_FAILED'].includes(inv.status);
                  const isAccepted = inv.status === 'ACCEPTED';
                  return (
                    <li key={inv.id}
                      className="px-6 py-3 flex items-start gap-3 hover:bg-surface transition-colors">
                      {/* Status dot */}
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isAccepted ? 'bg-green-500' : isRejected ? 'bg-red-500' : 'bg-amber-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/invoices/${inv.id}`}
                            className="text-sm text-dark font-medium hover:text-green transition-colors truncate">
                            {inv.buyerName}
                          </Link>
                          <span className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${pill.cls}`}>
                            {pill.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-0.5">
                          {formatCurrency(inv.totalAmount, inv.currency)}
                          {inv.updatedAt ? ` · ${formatDate(inv.updatedAt)}` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
