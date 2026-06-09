'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi, incomingInvoiceApi, userApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useUserProfile } from '@/lib/userProfile';
import { NotificationBell } from '@/components/dashboard/NotificationBell';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Sector,
  type PieSectorDataItem,
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

interface ChartData {
  revenueTrend: { month: string; monthKey: string; amount: number }[];
  invoiceStatusBreakdown: { status: string; count: number }[];
  sentVsReceived: { month: string; sent: number; received: number }[];
}

interface RejectionsData {
  totalRejected: number;
  allResolved: boolean;
  reasons: { errorCode: string; errorMessage: string; count: number; invoiceIds: string[] }[];
}

// ── Section keys ──────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  receivables:     'Outstanding Receivables & Payables',
  vat_strip:       'VAT Summary',
  revenue_chart:   'Monthly Revenue chart',
  pipeline_chart:  'Invoice Pipeline chart',
  activity_chart:  'Invoice Activity chart',
  needs_attention: 'Needs Attention',
};

const FINANCIAL_SECTIONS = new Set(['receivables', 'vat_strip', 'revenue_chart']);

// ── Role helpers ──────────────────────────────────────────────────────────────

function canSeeFinancials(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

function canCustomize(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
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

const STATUS_COLORS: Record<string, string> = {
  Paid: '#1D9E75',
  Accepted: '#86EFAC',
  Overdue: '#EF4444',
  'Needs attention': '#F59E0B',
  Draft: '#9CA3AF',
  Cancelled: '#E5E7EB',
};

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

// ── Custom tooltips ───────────────────────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-dark mb-1">{label}</p>
      <p className="text-muted">
        Revenue:{' '}
        <span className="font-semibold text-dark">{formatCurrency(payload[0].value, 'NGN')}</span>
      </p>
      <p className="text-[#1D9E75] text-[10px] mt-1">Click to view invoices →</p>
    </div>
  );
}

function ActivityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-dark mb-1.5">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span className="text-muted capitalize">{entry.name}:</span>
          <span className="font-medium text-dark">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function activeDonutShape(props: PieSectorDataItem) {
  const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill } = props;
  return (
    <Sector
      cx={cx as number}
      cy={cy as number}
      innerRadius={innerRadius as number}
      outerRadius={(outerRadius as number) + 6}
      startAngle={startAngle as number}
      endAngle={endAngle as number}
      fill={fill}
    />
  );
}

// ── FIRS Rejections Card ──────────────────────────────────────────────────────

function FirsRejectionsCard({
  data,
  loading,
}: {
  data: RejectionsData | null;
  loading: boolean;
}) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border border-l-4 border-l-gray-200 p-5">
        <Sk className="h-4 w-36 mb-2" />
        <Sk className="h-3 w-48 mb-3" />
        <Sk className="h-8 w-full" />
      </div>
    );
  }

  if (!data || data.allResolved) {
    return (
      <div className="bg-white rounded-xl border border-border border-l-4 border-l-[#1D9E75] p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1D9E75]">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-dark">FIRS Status</p>
            <p className="text-xs text-muted">No rejected invoices this period</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[#1D9E75] shrink-0">All accepted</span>
      </div>
    );
  }

  const topReasons = data.reasons.slice(0, 3);
  const moreCount = data.reasons.length - 3;

  return (
    <div className="bg-white rounded-xl border border-border border-l-4 border-l-red-500 p-5">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-dark">FIRS Rejections</span>
        </div>
        <span className="text-sm font-bold text-red-600 shrink-0">
          {data.totalRejected} invoice{data.totalRejected !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {topReasons.map((reason) => (
          <button
            key={reason.errorCode}
            onClick={() => router.push('/invoices?direction=sent&filter=needs-attention')}
            className="w-full flex items-center justify-between gap-3 text-left hover:bg-red-50 rounded-lg px-3 py-2 transition-colors group"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-dark truncate">{reason.errorMessage}</p>
              <p className="text-[10px] text-muted font-mono">{reason.errorCode}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted">
                {reason.count} invoice{reason.count !== 1 ? 's' : ''}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-muted group-hover:text-red-500 transition-colors">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
        {moreCount > 0 && (
          <p className="text-xs text-muted px-3">+ {moreCount} more reason{moreCount !== 1 ? 's' : ''}</p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border flex justify-end">
        <Link
          href="/invoices?direction=sent&filter=needs-attention"
          className="text-xs font-semibold text-red-600 hover:underline"
        >
          View all rejected →
        </Link>
      </div>
    </div>
  );
}

// ── Customize Sheet ───────────────────────────────────────────────────────────

function CustomizeSheet({
  open,
  onClose,
  localHidden,
  onToggle,
  onSave,
  saving,
  role,
}: {
  open: boolean;
  onClose: () => void;
  localHidden: string[];
  onToggle: (key: string) => void;
  onSave: () => void;
  saving: boolean;
  role: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sections = Object.entries(SECTION_LABELS).filter(([key]) => {
    if (FINANCIAL_SECTIONS.has(key)) return canSeeFinancials(role);
    return true;
  });

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={onClose}
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[360px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-dark">Customize dashboard</h2>
            <p className="text-xs text-muted mt-0.5">
              Choose which sections to show on your dashboard. These preferences are saved to your account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 shrink-0 p-1 rounded hover:bg-gray-100 transition-colors text-muted"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toggles */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {sections.map(([key, label]) => {
            const isOn = !localHidden.includes(key);
            return (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-dark">{label}</span>
                <button
                  onClick={() => onToggle(key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${isOn ? 'bg-[#1D9E75]' : 'bg-gray-200'}`}
                  role="switch"
                  aria-checked={isOn}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 transition-transform duration-200 ${isOn ? 'translate-x-4' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
            );
          })}
          <p className="text-xs text-muted pt-2">
            FIRS Rejections is always visible and cannot be hidden.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <Button
            onClick={onSave}
            disabled={saving}
            className="w-full"
            size="sm"
          >
            {saving ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const profile = useUserProfile();
  const router = useRouter();

  const role = user?.role ?? 'VIEWER';
  const financials = canSeeFinancials(role);

  // ── Data state ───────────────────────────────────────────────────────────────

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [incomingStats, setIncomingStats] = useState<IncomingStats | null>(null);
  const [incomingLoading, setIncomingLoading] = useState(true);

  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartsLoading, setChartsLoading] = useState(true);

  const [rejectionsData, setRejectionsData] = useState<RejectionsData | null>(null);
  const [rejectionsLoading, setRejectionsLoading] = useState(true);

  // ── Preferences state ────────────────────────────────────────────────────────

  const [savedHidden, setSavedHidden] = useState<string[]>([]);
  const [localHidden, setLocalHidden] = useState<string[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // ── Customize panel state ────────────────────────────────────────────────────

  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // ── Load all data in parallel ────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setStatsLoading(true);
    setIncomingLoading(true);

    const [statsResult, incomingResult] = await Promise.all([
      invoiceApi.stats().catch(() => null),
      incomingInvoiceApi.stats().catch(() => null),
    ]);
    setStats(statsResult as Stats | null);
    setStatsLoading(false);
    setIncomingStats(incomingResult as IncomingStats | null);
    setIncomingLoading(false);
  }, []);

  const loadCharts = useCallback(async () => {
    setChartsLoading(true);
    const result = await invoiceApi.dashboardCharts().catch(() => null);
    setChartData(result);
    setChartsLoading(false);
  }, []);

  const loadRejections = useCallback(async () => {
    setRejectionsLoading(true);
    const result = await invoiceApi.dashboardRejections().catch(() => null);
    setRejectionsData(result);
    setRejectionsLoading(false);
  }, []);

  const loadPreferences = useCallback(async () => {
    if (!canCustomize(role)) {
      setPrefsLoaded(true);
      return;
    }
    const result = await userApi.getPreferences().catch(() => null);
    const hidden = result?.hidden ?? [];
    setSavedHidden(hidden);
    setLocalHidden(hidden);
    setPrefsLoaded(true);
  }, [role]);

  useEffect(() => {
    if (authLoading) return;
    void loadData();
    void loadCharts();
    void loadRejections();
    void loadPreferences();
  }, [authLoading, loadData, loadCharts, loadRejections, loadPreferences]);

  // ── Derived values ────────────────────────────────────────────────────────────

  const firstName = profile?.firstName ?? user?.name?.split(' ')[0] ?? 'there';
  const tenantName = user?.tenantName ?? '';

  const outstandingAmount = (stats as any)?.outstandingAmount ?? 0;
  const outstandingCount = (stats as any)?.outstandingInvoiceCount ?? 0;
  const overdueCount = (stats as any)?.overdueCount ?? 0;
  const outstandingPayables = (incomingStats as any)?.totalOutstanding ?? 0;
  const payablesCount = (incomingStats as any)?.outstandingCount ?? 0;
  const netCash = outstandingAmount - outstandingPayables;

  const outputVat = (stats as any)?.outputVatOutstanding ?? 0;
  const inputVat = (stats as any)?.inputVatOutstanding ?? 0;
  const netVat = outputVat - inputVat;

  const rejectedCount = (stats as any)?.rejectedCount ?? (stats as any)?.rejected ?? 0;
  const toReview = (stats as any)?.incomingStats?.toReview ?? 0;
  const recentRejections: RecentRejection[] = (stats as any)?.recentRejections ?? [];
  const recentPayments: RecentPayment[] = (stats as any)?.recentPayments ?? [];

  const showRejections = !statsLoading && rejectedCount > 0;
  const showOverdue = !statsLoading && overdueCount > 0 && !showRejections;
  const showToReview = !statsLoading && toReview > 0 && !showRejections && !showOverdue;
  const showBanner = showRejections || showOverdue || showToReview;

  const attentionItems = [
    ...recentRejections.slice(0, 4).map((r) => ({
      type: 'rejected' as const,
      label: r.invoiceNumber ?? 'Unknown',
      sub: r.rejectionReason ?? 'Rejected by FIRS',
    })),
  ].slice(0, 4);

  // ── Section visibility helpers ────────────────────────────────────────────────

  function sectionVisible(key: string): boolean {
    if (FINANCIAL_SECTIONS.has(key) && !financials) return false;
    if (!canCustomize(role)) return true;
    return !localHidden.includes(key);
  }

  // ── Panel handlers ────────────────────────────────────────────────────────────

  function openPanel() {
    setLocalHidden(savedHidden);
    setPanelOpen(true);
  }

  function closePanel() {
    setLocalHidden(savedHidden);
    setPanelOpen(false);
  }

  function toggleSection(key: string) {
    setLocalHidden((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function savePreferences() {
    setSaving(true);
    try {
      await userApi.savePreferences({ hidden: localHidden });
      setSavedHidden(localHidden);
      setPanelOpen(false);
      setToast('Dashboard preferences saved.');
      setTimeout(() => setToast(''), 3000);
    } finally {
      setSaving(false);
    }
  }

  // ── Charts section visibility ─────────────────────────────────────────────────

  const showRevenueChart = sectionVisible('revenue_chart');
  const showPipelineChart = sectionVisible('pipeline_chart');
  const showActivityChart = sectionVisible('activity_chart');
  const anyChartVisible = showRevenueChart || showPipelineChart || showActivityChart;
  const visibleChartCount = [showRevenueChart, showPipelineChart, showActivityChart].filter(Boolean).length;

  const noChartData =
    !chartData ||
    (chartData.revenueTrend.every((d) => d.amount === 0) &&
      chartData.invoiceStatusBreakdown.every((d) => d.count === 0) &&
      chartData.sentVsReceived.every((d) => d.sent === 0 && d.received === 0));

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
          {canCustomize(role) && (
            <Button size="sm" variant="secondary" onClick={openPanel}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Customize
            </Button>
          )}
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

        {/* ── Toast ───────────────────────────────────────────────────────────── */}
        {toast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-dark text-white text-sm px-5 py-2.5 rounded-xl shadow-lg">
            {toast}
          </div>
        )}

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

        {/* ── Financial: Money cards (OWNER/ADMIN/ACCOUNTANT only) ─────────── */}
        {financials && sectionVisible('receivables') && (
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
        )}

        {/* ── Financial: VAT summary line ─────────────────────────────────── */}
        {financials && sectionVisible('vat_strip') && !statsLoading && (
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

        {/* ── FIRS Rejections card (all roles, always visible) ─────────────── */}
        <FirsRejectionsCard data={rejectionsData} loading={rejectionsLoading} />

        {/* ── Dashboard charts ──────────────────────────────────────────────── */}
        {anyChartVisible && (
          chartsLoading ? (
            <div className={`grid gap-4 ${visibleChartCount === 3 ? 'grid-cols-3' : visibleChartCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {Array.from({ length: visibleChartCount }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-5">
                  <Sk className="h-4 w-36 mb-1" />
                  <Sk className="h-3 w-48 mb-4" />
                  <Sk className="h-[220px] w-full" />
                </div>
              ))}
            </div>
          ) : noChartData ? (
            <div className="bg-white rounded-xl border border-border p-10 flex flex-col items-center gap-3 text-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" className="text-gray-300">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <div>
                <p className="font-semibold text-dark">No invoice data yet</p>
                <p className="text-sm text-muted mt-0.5">Create your first invoice to start seeing trends</p>
              </div>
              <Link href="/invoices/new">
                <Button size="sm" className="mt-1">+ Create invoice</Button>
              </Link>
            </div>
          ) : (
            <div className={`grid gap-4 ${visibleChartCount === 3 ? 'grid-cols-3' : visibleChartCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* Chart 1 — Monthly Revenue (financial, OWNER/ADMIN/ACCOUNTANT only) */}
              {showRevenueChart && chartData && (
                <div className="bg-white rounded-xl border border-border p-5">
                  <h2 className="font-semibold text-dark">Monthly Revenue</h2>
                  <p className="text-xs text-muted mt-0.5 mb-4">
                    Accepted invoices — last 6 months. Click a bar to view that month&apos;s invoices.
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={chartData.revenueTrend}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                      style={{ cursor: 'pointer' }}
                    >
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
                      <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(29,158,117,0.06)' }} />
                      <Bar
                        dataKey="amount"
                        name="Revenue"
                        fill="#1D9E75"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={48}
                        cursor="pointer"
                        onClick={(data: any) => {
                          router.push(`/invoices?direction=sent&month=${data.monthKey}`);
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Chart 2 — Invoice Pipeline */}
              {showPipelineChart && chartData && (
                <div className="bg-white rounded-xl border border-border p-5 min-w-0">
                  <h2 className="font-semibold text-dark">Invoice Pipeline</h2>
                  <p className="text-xs text-muted mt-0.5 mb-4">
                    Current status of all sent invoices. Click a segment to view those invoices.
                  </p>
                  {(() => {
                    const nonZero = chartData.invoiceStatusBreakdown.filter((d) => d.count > 0);
                    const total = chartData.invoiceStatusBreakdown.reduce((s, d) => s + d.count, 0);
                    const filterMap: Record<string, string> = {
                      Paid: 'paid',
                      Accepted: 'accepted',
                      Overdue: 'overdue',
                      'Needs attention': 'needs-attention',
                      Draft: 'draft',
                      Cancelled: 'cancelled',
                    };
                    return (
                      <div className="flex flex-col items-center gap-3">
                        <div style={{ width: '100%', height: 180 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={nonZero}
                                dataKey="count"
                                nameKey="status"
                                cx="50%"
                                cy="50%"
                                innerRadius={68}
                                outerRadius={90}
                                paddingAngle={2}
                                activeShape={activeDonutShape}
                                cursor="pointer"
                                onClick={(_: any, index: number) => {
                                  const seg = nonZero[index];
                                  if (seg) router.push(`/invoices?direction=sent&filter=${filterMap[seg.status] ?? ''}`);
                                }}
                              >
                                {nonZero.map((entry) => (
                                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#9CA3AF'} />
                                ))}
                              </Pie>
                              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                                <tspan x="50%" dy="-6" fontSize="22" fontWeight="700" fill="#111827">{total}</tspan>
                                <tspan x="50%" dy="18" fontSize="10" fill="#9ca3af">invoices</tspan>
                              </text>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex flex-col gap-1.5 w-full">
                          {chartData.invoiceStatusBreakdown.map((d) => (
                            <button
                              key={d.status}
                              onClick={() => router.push(`/invoices?direction=sent&filter=${filterMap[d.status] ?? ''}`)}
                              className="flex items-center gap-2 text-left hover:bg-gray-50 rounded px-1 py-0.5 transition-colors"
                            >
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[d.status] ?? '#9CA3AF' }} />
                              <span className="text-xs text-muted flex-1 truncate">{d.status}</span>
                              <span className="text-xs font-semibold text-dark tabular-nums">{d.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Chart 3 — Invoice Activity */}
              {showActivityChart && chartData && (
                <div className="bg-white rounded-xl border border-border p-5">
                  <h2 className="font-semibold text-dark">Invoice Activity</h2>
                  <p className="text-xs text-muted mt-0.5 mb-4">
                    Invoices sent and received — last 6 months
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={chartData.sentVsReceived}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                        axisLine={false}
                        tickLine={false}
                        width={32}
                      />
                      <Tooltip content={<ActivityTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                      <Legend
                        wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                        iconType="circle"
                        iconSize={8}
                      />
                      <Bar dataKey="sent" name="Sent" fill="#1D9E75" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="received" name="Received" fill="#93C5FD" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Bottom two panels ─────────────────────────────────────────────── */}
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
          {sectionVisible('needs_attention') && (
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
          )}
        </div>
      </div>

      {/* ── Customize sheet ────────────────────────────────────────────────── */}
      {canCustomize(role) && (
        <CustomizeSheet
          open={panelOpen}
          onClose={closePanel}
          localHidden={localHidden}
          onToggle={toggleSection}
          onSave={savePreferences}
          saving={saving}
          role={role}
        />
      )}
    </div>
  );
}
