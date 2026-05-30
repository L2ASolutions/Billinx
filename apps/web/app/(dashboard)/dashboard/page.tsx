'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi, incomingInvoiceApi, userApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useUserProfile } from '@/lib/userProfile';
import { NotificationBell } from '@/components/dashboard/NotificationBell';

// ── Dashboard prefs ───────────────────────────────────────────────────────────

interface DashboardPrefs {
  showRecentInvoices: boolean;
  showSubmissionQueue: boolean;
  showRecentActivity: boolean;
  showFirsStatus: boolean;
}

const DEFAULT_PREFS: DashboardPrefs = {
  showRecentInvoices: true,
  showSubmissionQueue: true,
  showRecentActivity: true,
  showFirsStatus: true,
};

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
  outputVatOutstanding?: number;
  inputVatOutstanding?: number;
  netVatExposure?: number;
  recentInvoices: RecentInvoice[];
}

interface IncomingStats {
  total: number;
  received: number;
  validated: number;
  approved: number;
  paid: number;
  totalOutstanding: number;
  outstandingCount: number;
  totalVatOutstanding: number;
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

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-green' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
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
  const profile = useUserProfile();

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [incomingStats, setIncomingStats] = useState<IncomingStats | null>(null);

  const [queue, setQueue] = useState<QueueInvoice[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [prefs, setPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);
  const [pendingPrefs, setPendingPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const customiseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    userApi.getPreferences()
      .then(({ dashboardWidgets }) => {
        if (dashboardWidgets && Object.keys(dashboardWidgets).length > 0) {
          const merged = { ...DEFAULT_PREFS, ...dashboardWidgets } as DashboardPrefs;
          setPrefs(merged);
          setPendingPrefs(merged);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!customiseOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (customiseRef.current && !customiseRef.current.contains(e.target as Node)) {
        setPendingPrefs(prefs);
        setCustomiseOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customiseOpen, prefs]);

  function openCustomise() {
    setPendingPrefs(prefs);
    setSavedConfirm(false);
    setCustomiseOpen(o => !o);
  }

  function togglePendingPref(key: keyof DashboardPrefs) {
    setPendingPrefs(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function savePrefs() {
    setPrefs(pendingPrefs);
    setSavedConfirm(true);
    setTimeout(() => setSavedConfirm(false), 2000);
    userApi.savePreferences({ dashboardWidgets: pendingPrefs as unknown as Record<string, boolean> })
      .catch(() => {});
  }

  function cancelPrefs() {
    setPendingPrefs(prefs);
    setCustomiseOpen(false);
  }

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    setQueueLoading(true);

    const [statsResult, listResult, incomingStatsResult] = await Promise.allSettled([
      invoiceApi.stats(),
      invoiceApi.list({ page: 1, limit: 5 } as Record<string, string | number>),
      incomingInvoiceApi.stats(),
    ]);

    setStats(statsResult.status === 'fulfilled' ? (statsResult.value as Stats) : null);
    setStatsLoading(false);

    setQueue(
      listResult.status === 'fulfilled'
        ? ((listResult.value as { data: QueueInvoice[] }).data ?? [])
        : [],
    );
    setQueueLoading(false);

    setIncomingStats(
      incomingStatsResult.status === 'fulfilled'
        ? (incomingStatsResult.value as IncomingStats)
        : null,
    );

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadData();
  }, [authLoading, loadData]);

  const firstName = profile?.firstName ?? user?.name?.split(' ')[0] ?? 'there';
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
          <NotificationBell />
          <div className="relative" ref={customiseRef}>
            <button
              onClick={openCustomise}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:bg-surface hover:text-dark transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Customise
            </button>
            {customiseOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl border border-border shadow-lg z-50 p-4">
                <p className="text-xs font-semibold text-dark uppercase tracking-wide mb-3">Dashboard widgets</p>
                <div className="space-y-3">
                  {(
                    [
                      { key: 'showRecentInvoices', label: 'Recent invoices' },
                      { key: 'showSubmissionQueue', label: 'Submission queue' },
                      { key: 'showRecentActivity', label: 'Recent activity' },
                      { key: 'showFirsStatus', label: 'FIRS status bar' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-dark">{label}</span>
                      <Toggle checked={pendingPrefs[key]} onChange={() => togglePendingPref(key)} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
                  <button
                    onClick={cancelPrefs}
                    className="text-sm text-muted hover:text-dark transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePrefs}
                    className="px-3 py-1.5 rounded-lg bg-green text-white text-sm font-medium hover:bg-green-dark transition-colors"
                  >
                    {savedConfirm ? 'Saved ✓' : 'Save preferences'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
        {/* ── Row 1: Invoice Activity ─────────────────────────────────────────── */}
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
          <Link href="/payments" className="block">
            <MetricCard
              label="Outstanding Receivables"
              value={formatCurrency(outstandingAmount, 'NGN')}
              sub={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'}
              valueClass={overdueCount > 0 ? 'text-red-600' : 'text-dark'}
              loading={statsLoading}
            />
          </Link>
          <Link href="/payments" className="block">
            <MetricCard
              label="Collected This Month"
              value={formatCurrency(collectedThisMonth, 'NGN')}
              sub={trend ?? 'All time'}
              loading={statsLoading}
            />
          </Link>
        </div>

        {/* ── Row 2: Payables ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4">
          <Link href="/incoming-invoices?status=APPROVED" className="block">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-3">Outstanding Payables</p>
              {statsLoading ? (
                <>
                  <Sk className="h-9 w-20 mb-2" />
                  <Sk className="h-3 w-40" />
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-amber-800">
                    {formatCurrency(incomingStats?.totalOutstanding ?? 0, 'NGN')}
                  </p>
                  <p className="text-xs text-amber-600 mt-1.5">
                    {incomingStats?.outstandingCount ?? 0} invoices pending payment
                  </p>
                </>
              )}
            </div>
          </Link>
        </div>

        {/* ── Row 3: VAT Exposure ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-3">Output VAT Outstanding</p>
            {statsLoading ? (
              <>
                <Sk className="h-9 w-20 mb-2" />
                <Sk className="h-3 w-44" />
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-amber-800">
                  {formatCurrency(stats?.outputVatOutstanding ?? 0, 'NGN')}
                </p>
                <p className="text-xs text-amber-600 mt-1.5">VAT embedded in unpaid receivables</p>
              </>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-3">Input VAT Outstanding</p>
            {statsLoading ? (
              <>
                <Sk className="h-9 w-20 mb-2" />
                <Sk className="h-3 w-44" />
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-amber-800">
                  {formatCurrency(stats?.inputVatOutstanding ?? 0, 'NGN')}
                </p>
                <p className="text-xs text-amber-600 mt-1.5">VAT embedded in unpaid payables</p>
              </>
            )}
          </div>

          {(() => {
            const net = stats?.netVatExposure ?? 0;
            const isPos = net > 0;
            const isNeg = net < 0;
            const colorCls = isPos ? 'bg-green-50 border-green-200' : isNeg ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
            const labelCls = isPos ? 'text-green-700' : isNeg ? 'text-red-700' : 'text-gray-600';
            const valueCls = isPos ? 'text-green-800' : isNeg ? 'text-red-700' : 'text-gray-700';
            const tag = isPos ? 'Net receivable' : isNeg ? 'Net payable' : 'Balanced';
            return (
              <div className={`border rounded-xl p-5 ${colorCls}`}>
                <p className={`text-xs font-medium uppercase tracking-wide mb-3 ${labelCls}`}>Net VAT Exposure</p>
                {statsLoading ? (
                  <>
                    <Sk className="h-9 w-20 mb-2" />
                    <Sk className="h-3 w-32" />
                  </>
                ) : (
                  <>
                    <p className={`text-3xl font-bold ${valueCls}`}>
                      {formatCurrency(Math.abs(net), 'NGN')}
                    </p>
                    <p className={`text-xs mt-1.5 ${labelCls}`}>{tag} · Output minus Input VAT</p>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* ── FIRS status bar ─────────────────────────────────────────────────── */}
        {prefs.showFirsStatus && (
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
        )}

        {/* ── Recent invoices table ───────────────────────────────────────────── */}
        {prefs.showRecentInvoices && <div className="bg-white rounded-xl border border-border overflow-hidden">
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
                    const pill = PILL[inv.status ?? ''] ?? { label: (inv.status ?? '').replace(/_/g, ' '), cls: 'bg-gray-100 text-gray-600' };
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
        </div>}

        {/* ── Bottom row: Submission queue + Recent activity ──────────────────── */}
        {(prefs.showSubmissionQueue || prefs.showRecentActivity) && (
          <div className={`grid grid-cols-1 gap-6 ${prefs.showSubmissionQueue && prefs.showRecentActivity ? 'lg:grid-cols-2' : ''}`}>
            {/* Submission queue */}
            {prefs.showSubmissionQueue && (
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
            )}

            {/* Recent activity — derived from the same queue list; zero extra API calls */}
            {prefs.showRecentActivity && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
