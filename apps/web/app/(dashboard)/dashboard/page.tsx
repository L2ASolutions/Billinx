'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi, incomingInvoiceApi, userApi, api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useUserProfile } from '@/lib/userProfile';
import { NotificationBell } from '@/components/dashboard/NotificationBell';

// ── Dashboard prefs ───────────────────────────────────────────────────────────

interface DashboardPrefs {
  showFinancialPosition: boolean;
  showRecentInvoices: boolean;
  showSubmissionQueue: boolean;
  showRecentActivity: boolean;
  showFirsStatus: boolean;
  showTaxPosition: boolean;
  showCompliancePosition: boolean;
}

const DEFAULT_PREFS: DashboardPrefs = {
  showFinancialPosition: true,
  showRecentInvoices: true,
  showSubmissionQueue: true,
  showRecentActivity: true,
  showFirsStatus: true,
  showTaxPosition: true,
  showCompliancePosition: true,
};

// ── Section open/close state (localStorage) ───────────────────────────────────

interface SectionState {
  financialPosition: boolean;
  taxPosition: boolean;
  compliancePosition: boolean;
}

const SECTION_KEY = 'billinx_dashboard_sections';
const DEFAULT_SECTIONS: SectionState = {
  financialPosition: false,
  taxPosition: false,
  compliancePosition: false,
};

function loadSections(): SectionState {
  if (typeof window === 'undefined') return DEFAULT_SECTIONS;
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    if (!raw) return DEFAULT_SECTIONS;
    return { ...DEFAULT_SECTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SECTIONS;
  }
}

function saveSections(s: SectionState) {
  try { localStorage.setItem(SECTION_KEY, JSON.stringify(s)); } catch {}
}

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
  total: number;
  accepted: number;
  rejected: number;
  rejectedAll?: number;
  pending: number;
  totalAmount: number;
  outstandingAmount?: number;
  outstandingInvoiceCount?: number;
  overdueCount?: number;
  outgoingTotal?: number;
  outgoingAccepted?: number;
  outgoingPending?: number;
  outgoingRejected?: number;
  collectedThisMonth?: number;
  outputVatOutstanding?: number;
  inputVatOutstanding?: number;
  netVatExposure?: number;
  totalWhtExpected?: number;
  expectedCashCollections?: number;
  availableWhtCredits?: number;
  pendingWhtCertificates?: number;
  submissionAcceptanceRate?: number;
  lowStockCount?: number;
  firsAwaiting?: number;
  rejectedCount?: number;
  stuckCount?: number;
  recentRejections?: RecentRejection[];
  outgoingStats?: { total: number; pending: number; accepted: number; rejected: number };
  incomingStats?: { total: number; toReview: number; approved: number; paid: number };
  recentInvoices: RecentInvoice[];
  recentPayments: RecentPayment[];
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
  totalWhtOutstanding?: number;
  netPayableAfterWht?: number;
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

// ── Payment provider pill ─────────────────────────────────────────────────────

function providerPill(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('paystack')) return 'bg-green-50 text-green-700';
  if (p.includes('flutterwave')) return 'bg-orange-50 text-orange-700';
  if (p.includes('bank') || p.includes('transfer')) return 'bg-blue-50 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

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

// ── Financial card (left-border style) ───────────────────────────────────────

type CardColor = 'green' | 'red' | 'amber' | 'gray';

const CARD_COLOR: Record<CardColor, { border: string; value: string; sub: string }> = {
  green: { border: 'border-l-[#1D9E75]', value: 'text-[#1D9E75]',  sub: 'text-green-600' },
  red:   { border: 'border-l-red-500',   value: 'text-red-600',    sub: 'text-red-500'   },
  amber: { border: 'border-l-amber-500', value: 'text-amber-700',  sub: 'text-amber-600' },
  gray:  { border: 'border-l-gray-400',  value: 'text-gray-500',   sub: 'text-gray-400'  },
};

function FinancialCard({
  label, value, sub1, sub2, color, href, loading,
}: {
  label: string;
  value: string;
  sub1?: string;
  sub2?: string;
  color: CardColor;
  href?: string;
  loading: boolean;
}) {
  const c = CARD_COLOR[color];
  const inner = (
    <div className={`bg-white rounded-xl border border-border border-l-4 ${c.border} p-5 h-full hover:shadow-sm transition-shadow`}>
      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">{label}</p>
      {loading ? (
        <>
          <Sk className="h-8 w-24 mb-2" />
          <Sk className="h-3 w-40 mb-1" />
          {sub2 && <Sk className="h-3 w-32" />}
        </>
      ) : (
        <>
          <p className={`text-2xl font-bold ${c.value}`}>{value}</p>
          {sub1 && <p className={`text-xs mt-1.5 ${c.sub}`}>{sub1}</p>}
          {sub2 && <p className={`text-xs mt-0.5 ${c.sub}`}>{sub2}</p>}
        </>
      )}
    </div>
  );
  if (href) return <Link href={href} className="block">{inner}</Link>;
  return inner;
}

// ── Collapsible section ───────────────────────────────────────────────────────

function SectionHeader({
  title, summary, summaryColor, open, onToggle,
}: {
  title: string;
  summary: string;
  summaryColor: CardColor;
  open: boolean;
  onToggle: () => void;
}) {
  const colorMap: Record<CardColor, string> = {
    green: 'text-[#1D9E75]',
    red:   'text-red-600',
    amber: 'text-amber-600',
    gray:  'text-gray-500',
  };
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors rounded-xl border border-border cursor-pointer"
    >
      <span className="font-semibold text-dark text-sm">{title}</span>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${colorMap[summaryColor]}`}>{summary}</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform duration-200 text-muted shrink-0 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    </button>
  );
}

function CollapsibleSection({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);

  useEffect(() => {
    if (!ref.current) return;
    if (open) {
      const h = ref.current.scrollHeight;
      setHeight(h);
      const t = setTimeout(() => setHeight(undefined), 300);
      return () => clearTimeout(t);
    } else {
      setHeight(ref.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [open]);

  return (
    <div
      ref={ref}
      className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
      style={{ maxHeight: height === undefined ? 'none' : `${height}px` }}
    >
      <div className="pt-4">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const profile = useUserProfile();

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [inventoryEnabled, setInventoryEnabled] = useState(false);

  const [incomingStats, setIncomingStats] = useState<IncomingStats | null>(null);
  const [incomingStatsLoading, setIncomingStatsLoading] = useState(true);

  const [queue, setQueue] = useState<QueueInvoice[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  const [prefs, setPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);
  const [pendingPrefs, setPendingPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const customiseRef = useRef<HTMLDivElement>(null);

  const [sections, setSections] = useState<SectionState>(DEFAULT_SECTIONS);

  // Load section state from localStorage on mount
  useEffect(() => { setSections(loadSections()); }, []);

  function toggleSection(key: keyof SectionState) {
    setSections((s) => {
      const next = { ...s, [key]: !s[key] };
      saveSections(next);
      return next;
    });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      userApi.getPreferences()
        .then(({ dashboardWidgets }) => {
          if (dashboardWidgets && Object.keys(dashboardWidgets).length > 0) {
            const raw = dashboardWidgets as Record<string, boolean>;
            const merged: DashboardPrefs = {
              showFinancialPosition:   raw.showFinancialPosition   ?? true,
              showRecentInvoices:      raw.showRecentInvoices      ?? true,
              showSubmissionQueue:     raw.showSubmissionQueue     ?? true,
              showRecentActivity:      raw.showRecentActivity      ?? true,
              showFirsStatus:          raw.showFirsStatus          ?? true,
              showTaxPosition:         raw.showTaxPosition         ?? (raw.showFinancialCards ?? true),
              showCompliancePosition:  raw.showCompliancePosition  ?? true,
            };
            setPrefs(merged);
            setPendingPrefs(merged);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
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

  async function handleRetryAll() {
    setRetryingAll(true);
    try {
      await api.post('/v1/admin/queue/retry-failed', {});
      await loadData();
    } catch {}
    setRetryingAll(false);
  }

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    setQueueLoading(true);
    setIncomingStatsLoading(true);

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
    setIncomingStatsLoading(false);

    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void loadData();
    api.get<any>('/v1/tenants/me').then((t) => setInventoryEnabled(!!t?.inventoryEnabled)).catch(() => {});
  }, [authLoading, loadData]);

  const firstName = profile?.firstName ?? user?.name?.split(' ')[0] ?? 'there';
  const tenantName = user?.tenantName ?? '';

  const lastRefreshedLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Financial Position computed values ─────────────────────────────────────
  const outstandingAmount = stats?.outstandingAmount ?? 0;
  const outstandingCount = stats?.outstandingInvoiceCount ?? 0;
  const overdueCount = stats?.overdueCount ?? 0;
  const totalWhtExpected = stats?.totalWhtExpected ?? 0;
  const expectedCash = stats?.expectedCashCollections ?? outstandingAmount;
  const outstandingPayables = incomingStats?.totalOutstanding ?? 0;
  const outstandingPayablesCount = incomingStats?.outstandingCount ?? 0;
  const netCash = expectedCash - outstandingPayables;
  const netCashPositive = netCash > 0;
  const netCashNegative = netCash < 0;

  // ── Tax Position computed values ───────────────────────────────────────────
  const outputVat = stats?.outputVatOutstanding ?? 0;
  const inputVat = stats?.inputVatOutstanding ?? (incomingStats?.totalVatOutstanding ?? 0);
  const netVat = outputVat - inputVat;
  const netVatPositive = netVat > 0;
  const netVatNegative = netVat < 0;
  const availableWhtCredits = stats?.availableWhtCredits ?? 0;

  // ── Compliance Position computed values ────────────────────────────────────
  const submissionTotal = stats?.total ?? 0;
  const submissionAccepted = stats?.accepted ?? 0;
  const submissionPending = stats?.pending ?? 0;
  const submissionRejected = stats?.rejectedAll ?? stats?.rejected ?? 0;
  const acceptanceRate = stats?.submissionAcceptanceRate ?? (submissionTotal > 0 ? Math.round((submissionAccepted / submissionTotal) * 1000) / 10 : 0);
  const pendingWhtCerts = stats?.pendingWhtCertificates;

  // ── Row 1 computed values ──────────────────────────────────────────────────
  const rejectedCount = stats?.rejectedCount ?? stats?.rejected ?? 0;
  const stuckCount = stats?.stuckCount ?? 0;
  const recentRejections = stats?.recentRejections ?? [];
  const outgoingStatsData = stats?.outgoingStats;
  const incomingStatsFromDashboard = stats?.incomingStats;
  const firstRejection = recentRejections[0];

  // Section summaries
  const financialSummary = netCash === 0
    ? '₦0 balanced'
    : `${formatCurrency(Math.abs(netCash), 'NGN')} net ${netCashPositive ? 'receivable' : 'payable'}`;
  const financialSummaryColor: CardColor = netCashPositive ? 'green' : netCashNegative ? 'red' : 'gray';

  const taxSummary = netVat === 0
    ? '₦0 balanced'
    : `${formatCurrency(Math.abs(netVat), 'NGN')} net VAT ${netVatPositive ? 'payable' : 'credit'}`;
  const taxSummaryColor: CardColor = netVatPositive ? 'red' : netVatNegative ? 'green' : 'gray';

  const complianceItemsNeedAttention = pendingWhtCerts ?? 0;
  const complianceSummary = complianceItemsNeedAttention > 0
    ? `${complianceItemsNeedAttention} item${complianceItemsNeedAttention > 1 ? 's' : ''} need attention`
    : 'All systems operational';
  const complianceSummaryColor: CardColor = complianceItemsNeedAttention > 0 ? 'amber' : 'green';

  const acceptanceRateColor: CardColor = acceptanceRate >= 90 ? 'green' : acceptanceRate >= 70 ? 'amber' : 'red';

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
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl border border-border shadow-lg z-50 p-4">
                <p className="text-xs font-semibold text-dark uppercase tracking-wide mb-2">Sections</p>
                <div className="space-y-2.5 mb-4">
                  {(
                    [
                      { key: 'showFinancialPosition', label: 'Financial Position' },
                      { key: 'showTaxPosition', label: 'Tax Position' },
                      { key: 'showCompliancePosition', label: 'Compliance Position' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-dark">{label}</span>
                      <Toggle checked={pendingPrefs[key]} onChange={() => togglePendingPref(key)} />
                    </div>
                  ))}
                </div>

                <p className="text-xs font-semibold text-dark uppercase tracking-wide mb-2 pt-3 border-t border-border">Panels</p>
                <div className="space-y-2.5">
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
                  <button onClick={cancelPrefs} className="text-sm text-muted hover:text-dark transition-colors">
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
        {/* ── Row 1: 4 compact status cards (always visible) ──────────────── */}
        <div className="grid grid-cols-4 gap-4">
          {/* Card 1: Outgoing Invoices */}
          <Link href="/invoices" className="block">
            <div className="bg-[#1a2b4a] rounded-xl border border-[#1a2b4a] p-4 h-full hover:opacity-90 transition-opacity">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-blue-200 uppercase tracking-wide">Outgoing Invoices</p>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
                </svg>
              </div>
              {statsLoading ? (
                <>
                  <div className="animate-pulse bg-blue-800/40 rounded h-7 w-12 mb-1.5" />
                  <div className="animate-pulse bg-blue-800/40 rounded h-3 w-36" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-white">{outgoingStatsData?.total ?? stats?.outgoingTotal ?? stats?.total ?? 0}</p>
                  <p className="text-xs text-blue-300 mt-1">
                    {outgoingStatsData?.pending ?? stats?.outgoingPending ?? 0} pending · {outgoingStatsData?.accepted ?? stats?.outgoingAccepted ?? 0} accepted · {outgoingStatsData?.rejected ?? stats?.outgoingRejected ?? 0} rejected
                  </p>
                </>
              )}
            </div>
          </Link>

          {/* Card 2: Incoming Invoices */}
          <Link href="/incoming-invoices" className="block">
            <div className="bg-emerald-700 rounded-xl border border-emerald-700 p-4 h-full hover:opacity-90 transition-opacity">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-emerald-200 uppercase tracking-wide">Incoming Invoices</p>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" />
                </svg>
              </div>
              {incomingStatsLoading ? (
                <>
                  <div className="animate-pulse bg-emerald-600/40 rounded h-7 w-12 mb-1.5" />
                  <div className="animate-pulse bg-emerald-600/40 rounded h-3 w-36" />
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-white">{incomingStatsFromDashboard?.total ?? incomingStats?.total ?? 0}</p>
                  <p className="text-xs text-emerald-200 mt-1">
                    {incomingStatsFromDashboard?.toReview ?? incomingStats?.received ?? 0} to review · {incomingStatsFromDashboard?.approved ?? incomingStats?.approved ?? 0} approved · {incomingStatsFromDashboard?.paid ?? incomingStats?.paid ?? 0} paid
                  </p>
                </>
              )}
            </div>
          </Link>

          {/* Card 3: FIRS Rejections */}
          <Link href="/submissions?status=REJECTED" className="block">
            <div className={`rounded-xl border p-4 h-full hover:shadow-sm transition-shadow ${
              statsLoading ? 'bg-white border-border' :
              rejectedCount === 0 ? 'bg-white border-[#1D9E75] border-l-4 border-l-[#1D9E75]' :
              'bg-white border-red-200 border-l-4 border-l-red-500'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide">FIRS Rejections</p>
                  <div className="relative group inline-block">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 text-xs text-white bg-gray-800 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                      Invoices that were submitted to FIRS but failed validation. Common reasons include invalid TIN format, missing HSN code, or incorrect tax amounts. Click to view details and fix each rejection.
                    </div>
                  </div>
                </div>
                {statsLoading ? null : rejectedCount === 0 ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
              </div>
              {statsLoading ? (
                <>
                  <Sk className="h-7 w-16 mb-1.5" />
                  <Sk className="h-3 w-32" />
                </>
              ) : rejectedCount === 0 ? (
                <>
                  <p className="text-2xl font-bold text-[#1D9E75]">All clear</p>
                  <p className="text-xs text-green-600 mt-1">No rejected invoices</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-red-600">{rejectedCount}</p>
                  <p className="text-xs text-red-500 mt-1 truncate">
                    {firstRejection ? `${firstRejection.rejectionReason ?? 'Rejected'} · ${firstRejection.invoiceNumber?.slice(0, 12) ?? ''}` : `${rejectedCount} rejection${rejectedCount > 1 ? 's' : ''}`}
                  </p>
                </>
              )}
            </div>
          </Link>

          {/* Card 4: Stuck Submissions */}
          <Link href="/submissions?status=QUEUED" className="block">
            <div className={`rounded-xl border p-4 h-full transition-opacity ${
              statsLoading ? 'bg-white border-border' :
              stuckCount === 0 ? 'bg-white border-[#1D9E75] border-l-4 border-l-[#1D9E75]' :
              'bg-white border-amber-200 border-l-4 border-l-amber-500'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide">Stuck Submissions</p>
                  <div className="relative group inline-block">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 text-xs text-white bg-gray-800 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                      Invoices that have been in the submission queue for more than 5 minutes without reaching FIRS. This usually happens due to a network issue or service interruption. Click Retry all to resubmit them to FIRS.
                    </div>
                  </div>
                </div>
                {statsLoading ? null : stuckCount === 0 ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                )}
              </div>
              {statsLoading ? (
                <>
                  <Sk className="h-7 w-16 mb-1.5" />
                  <Sk className="h-3 w-36" />
                </>
              ) : stuckCount === 0 ? (
                <>
                  <p className="text-2xl font-bold text-[#1D9E75]">Queue clear</p>
                  <p className="text-xs text-green-600 mt-1">All submissions processing</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-amber-700">{stuckCount} stuck</p>
                  <p className="text-xs text-amber-600 mt-1 mb-2">Invoices not reaching FIRS</p>
                  <button
                    onClick={(e) => { e.preventDefault(); void handleRetryAll(); }}
                    disabled={retryingAll}
                    className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-xs font-medium hover:bg-amber-200 transition-colors disabled:opacity-50"
                  >
                    {retryingAll ? 'Retrying…' : 'Retry all'}
                  </button>
                </>
              )}
            </div>
          </Link>
        </div>

        {/* ── Section 1: Financial Position (collapsible) ──────────────────── */}
        {prefs.showFinancialPosition && (
          <div className="space-y-0">
            <SectionHeader
              title="Financial Position"
              summary={statsLoading || incomingStatsLoading ? '…' : financialSummary}
              summaryColor={financialSummaryColor}
              open={sections.financialPosition}
              onToggle={() => toggleSection('financialPosition')}
            />
            <CollapsibleSection open={sections.financialPosition}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <FinancialCard
                    label="Outstanding Receivables"
                    value={formatCurrency(outstandingAmount, 'NGN')}
                    sub1={`${outstandingCount} invoice${outstandingCount !== 1 ? 's' : ''} · ${overdueCount} overdue`}
                    color="green"
                    href="/payments"
                    loading={statsLoading}
                  />
                  <FinancialCard
                    label="Expected Cash Collections"
                    value={formatCurrency(expectedCash, 'NGN')}
                    sub1={totalWhtExpected > 0 ? `After WHT deductions of ${formatCurrency(totalWhtExpected, 'NGN')}` : 'No WHT deductions pending'}
                    color="green"
                    href="/payments"
                    loading={statsLoading}
                  />
                  <FinancialCard
                    label="Outstanding Payables"
                    value={formatCurrency(outstandingPayables, 'NGN')}
                    sub1={`${outstandingPayablesCount} invoice${outstandingPayablesCount !== 1 ? 's' : ''} pending payment`}
                    color="red"
                    href="/incoming-invoices"
                    loading={incomingStatsLoading}
                  />
                  <FinancialCard
                    label="Net Cash Position"
                    value={formatCurrency(Math.abs(netCash), 'NGN')}
                    sub1={netCash > 0 ? 'Net receivable position' : netCash < 0 ? 'Net payable position' : 'Balanced position'}
                    color={netCashPositive ? 'green' : netCashNegative ? 'red' : 'gray'}
                    loading={statsLoading || incomingStatsLoading}
                  />
                </div>

                {/* Payments card inside Financial Position */}
                <div className="bg-white rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide">Payments</p>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                  </div>
                  {statsLoading ? (
                    <>
                      <Sk className="h-7 w-28 mb-1" />
                      <Sk className="h-3 w-36 mb-3" />
                      <Sk className="h-4 w-full mb-1.5" />
                      <Sk className="h-4 w-full mb-2" />
                      <Sk className="h-3 w-16" />
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-[#1D9E75]">{formatCurrency(stats?.collectedThisMonth ?? 0, 'NGN')}</p>
                      <p className="text-xs text-muted mt-0.5 mb-3">collected this month</p>
                      {!stats?.recentPayments?.length ? (
                        <div className="space-y-1">
                          <p className="text-xs text-muted">No payments yet</p>
                          <Link href="/payments" className="text-xs text-green font-medium">Record payment →</Link>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {stats.recentPayments.map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-dark truncate">
                                {p.buyerName.length > 15 ? p.buyerName.slice(0, 15) + '…' : p.buyerName}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-xs font-medium text-dark">{formatCurrency(p.amount, 'NGN')}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${providerPill(p.provider)}`}>
                                  {p.provider}
                                </span>
                              </div>
                            </div>
                          ))}
                          <Link href="/payments" className="text-xs text-green font-medium block pt-1">View all →</Link>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* ── Collapsible Section 2: Tax Position ─────────────────────────── */}
        {prefs.showTaxPosition && (
          <div className="space-y-0">
            <SectionHeader
              title="Tax Position"
              summary={statsLoading || incomingStatsLoading ? '…' : taxSummary}
              summaryColor={taxSummaryColor}
              open={sections.taxPosition}
              onToggle={() => toggleSection('taxPosition')}
            />
            <CollapsibleSection open={sections.taxPosition}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <FinancialCard
                  label="Output VAT Outstanding"
                  value={formatCurrency(outputVat, 'NGN')}
                  sub1="VAT in unpaid receivables"
                  sub2="Payable to FIRS when collected"
                  color="red"
                  loading={statsLoading}
                />
                <FinancialCard
                  label="Input VAT Outstanding"
                  value={formatCurrency(inputVat, 'NGN')}
                  sub1="VAT in unpaid payables"
                  sub2="Claimable from FIRS when paid"
                  color="green"
                  loading={incomingStatsLoading}
                />
                <FinancialCard
                  label="Net VAT Exposure"
                  value={formatCurrency(Math.abs(netVat), 'NGN')}
                  sub1={netVatPositive ? 'Net future payable to FIRS' : netVatNegative ? 'Net future credit from FIRS' : 'Balanced VAT position'}
                  color={netVatPositive ? 'red' : netVatNegative ? 'green' : 'gray'}
                  loading={statsLoading || incomingStatsLoading}
                />
                <FinancialCard
                  label="Available WHT Credits"
                  value={formatCurrency(availableWhtCredits, 'NGN')}
                  sub1="Verified WHT deductions"
                  sub2="Available to offset CIT"
                  color="green"
                  loading={statsLoading}
                />
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* ── Collapsible Section 3: Compliance Position ──────────────────── */}
        {prefs.showCompliancePosition && (
          <div className="space-y-0">
            <SectionHeader
              title="Compliance Position"
              summary={statsLoading ? '…' : complianceSummary}
              summaryColor={complianceSummaryColor}
              open={sections.compliancePosition}
              onToggle={() => toggleSection('compliancePosition')}
            />
            <CollapsibleSection open={sections.compliancePosition}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* FIRS Connection */}
                <div className="bg-white rounded-xl border border-border border-l-4 border-l-[#1D9E75] p-5">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">FIRS Connection</p>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#1D9E75] animate-pulse shrink-0" />
                    <p className="text-xl font-bold text-[#1D9E75]">Connected</p>
                  </div>
                  <p className="text-xs text-green-600">Interswitch NRS · Active</p>
                  {lastRefreshedLabel && (
                    <p className="text-xs text-green-600 mt-0.5">Last checked {lastRefreshedLabel}</p>
                  )}
                </div>

                {/* E-Invoices Submitted */}
                <Link href="/submissions" className="block">
                  <div className={`bg-white rounded-xl border border-border border-l-4 border-l-${acceptanceRateColor === 'green' ? '[#1D9E75]' : acceptanceRateColor === 'amber' ? 'amber-500' : 'red-500'} p-5 h-full hover:shadow-sm transition-shadow`}>
                    <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">E-Invoices Submitted</p>
                    {statsLoading ? (
                      <>
                        <Sk className="h-8 w-16 mb-2" />
                        <Sk className="h-3 w-44 mb-1" />
                        <Sk className="h-3 w-32" />
                      </>
                    ) : (
                      <>
                        <p className={`text-2xl font-bold ${acceptanceRateColor === 'green' ? 'text-[#1D9E75]' : acceptanceRateColor === 'amber' ? 'text-amber-700' : 'text-red-600'}`}>
                          {submissionTotal}
                        </p>
                        <p className="text-xs text-muted mt-1.5">
                          {submissionAccepted} accepted · {submissionPending} pending · {submissionRejected} rejected
                        </p>
                        <p className={`text-xs mt-0.5 font-medium ${acceptanceRateColor === 'green' ? 'text-[#1D9E75]' : acceptanceRateColor === 'amber' ? 'text-amber-600' : 'text-red-500'}`}>
                          {acceptanceRate}% acceptance rate
                        </p>
                      </>
                    )}
                  </div>
                </Link>

                {/* Stock Alerts — only when inventoryEnabled */}
                {inventoryEnabled && (
                  <Link href="/inventory?filter=low" className="block">
                    <div className={`bg-white rounded-xl border border-border border-l-4 ${
                      statsLoading ? 'border-l-gray-300' :
                      (stats?.lowStockCount ?? 0) === 0 ? 'border-l-[#1D9E75]' : 'border-l-amber-500'
                    } p-5 h-full hover:shadow-sm transition-shadow`}>
                      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Stock Alerts</p>
                      {statsLoading ? (
                        <>
                          <Sk className="h-8 w-12 mb-2" />
                          <Sk className="h-3 w-40" />
                        </>
                      ) : (stats?.lowStockCount ?? 0) === 0 ? (
                        <>
                          <p className="text-2xl font-bold text-[#1D9E75]">0</p>
                          <p className="text-xs text-green-600 mt-1.5">All products in stock</p>
                        </>
                      ) : (
                        <>
                          <p className="text-2xl font-bold text-amber-700">{stats?.lowStockCount}</p>
                          <p className="text-xs text-amber-600 mt-1.5">Product{(stats?.lowStockCount ?? 0) !== 1 ? 's' : ''} need restocking</p>
                        </>
                      )}
                    </div>
                  </Link>
                )}

                {/* Pending WHT Certificates */}
                <div className={`bg-white rounded-xl border border-border border-l-4 ${pendingWhtCerts == null ? 'border-l-gray-400' : pendingWhtCerts === 0 ? 'border-l-[#1D9E75]' : 'border-l-amber-500'} p-5`}>
                  <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Pending WHT Certificates</p>
                  {statsLoading ? (
                    <>
                      <Sk className="h-8 w-12 mb-2" />
                      <Sk className="h-3 w-40 mb-1" />
                      <Sk className="h-3 w-32" />
                    </>
                  ) : pendingWhtCerts == null ? (
                    <>
                      <p className="text-2xl font-bold text-gray-400">—</p>
                      <p className="text-xs text-gray-400 mt-1.5">WHT tracking coming soon</p>
                    </>
                  ) : pendingWhtCerts === 0 ? (
                    <>
                      <p className="text-2xl font-bold text-[#1D9E75]">0</p>
                      <p className="text-xs text-green-600 mt-1.5">All certificates received</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-amber-700">{pendingWhtCerts}</p>
                      <p className="text-xs text-amber-600 mt-1.5">Invoices with WHT deducted</p>
                      <p className="text-xs text-amber-600 mt-0.5">Action required</p>
                    </>
                  )}
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* ── FIRS status bar ──────────────────────────────────────────────── */}
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

        {/* ── Recent invoices table ────────────────────────────────────────── */}
        {prefs.showRecentInvoices && (
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
          </div>
        )}

        {/* ── Bottom row: Submission queue + Recent activity ───────────────── */}
        {(prefs.showSubmissionQueue || prefs.showRecentActivity) && (
          <div className={`grid grid-cols-1 gap-6 ${prefs.showSubmissionQueue && prefs.showRecentActivity ? 'lg:grid-cols-2' : ''}`}>
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
