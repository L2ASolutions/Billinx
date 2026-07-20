'use client';

import { useCallback, useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth';
import { invoiceApi, incomingInvoiceApi, userApi } from '@/lib/api';
import { useUserProfile } from '@/lib/userProfile';

import { DashboardHeader } from './components/DashboardHeader';
import { AttentionBanner } from './components/AttentionBanner';
import { FinancialSummaryCards } from './components/FinancialSummaryCards';
import { VatSummaryStrip } from './components/VatSummaryStrip';
import { FirsRejectionsCard } from './components/FirsRejectionsCard';
import { DashboardCharts } from './components/DashboardCharts';
import { RecentPaymentsPanel } from './components/RecentPaymentsPanel';
import { NeedsAttentionPanel } from './components/NeedsAttentionPanel';
import { CustomizeSheet } from './components/CustomizeSheet';
import { canSeeFinancials, canCustomize, isSectionVisible, FINANCIAL_SECTIONS } from './components/visibility';
import type { RecentPayment, RecentRejection, Stats, IncomingStats, ChartData, RejectionsData } from './components/types';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, isLoading: authLoading, logout } = useRequireAuth();
  const profile = useUserProfile();
  const router = useRouter();

  const role = user?.role ?? 'VIEWER';
  const financials = canSeeFinancials(role);

  const displayFullName = user?.name ?? '';

  function handleLogout() {
    logout();
    router.push('/login');
  }

  // ── Data state ───────────────────────────────────────────────────────────────

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [incomingStats, setIncomingStats] = useState<IncomingStats | null>(null);
  const [incomingLoading, setIncomingLoading] = useState(true);

  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [chartsLoading, setChartsLoading] = useState(true);

  const [rejectionsData, setRejectionsData] = useState<RejectionsData | null>(null);
  const [rejectionsLoading, setRejectionsLoading] = useState(true);

  // ── Tenant visibility (from stats response) ──────────────────────────────────

  const [tenantVisibility, setTenantVisibility] = useState<Record<string, boolean> | undefined>(undefined);

  // ── Preferences state ────────────────────────────────────────────────────────

  const [savedHidden, setSavedHidden] = useState<string[]>([]);
  const [localHidden, setLocalHidden] = useState<string[]>([]);
  const [_prefsLoaded, setPrefsLoaded] = useState(false);

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
    const typedStats = statsResult as Stats | null;
    setStats(typedStats);
    if (typedStats?.myVisibility) {
      setTenantVisibility(typedStats.myVisibility as unknown as Record<string, boolean>);
    }
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
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    void loadCharts();
    void loadRejections();
    void loadPreferences();
  }, [authLoading, loadData, loadCharts, loadRejections, loadPreferences]);

  // ── Derived values ────────────────────────────────────────────────────────────

  const firstName = profile?.firstName ?? user?.name?.split(' ')[0] ?? 'there';
  const tenantName = user?.tenantName ?? '';

  const outstandingAmount = stats?.outstandingAmount ?? 0;
  const outstandingCount = stats?.outstandingInvoiceCount ?? 0;
  const overdueCount = stats?.overdueCount ?? 0;
  const outstandingPayables = incomingStats?.totalOutstanding ?? 0;
  const payablesCount = incomingStats?.outstandingCount ?? 0;
  const netCash = outstandingAmount - outstandingPayables;

  const outputVat = stats?.outputVatOutstanding ?? 0;
  const inputVat = stats?.inputVatOutstanding ?? 0;
  const netVat = outputVat - inputVat;

  const rejectedCount = stats?.rejectedCount ?? stats?.rejected ?? 0;
  const toReview = stats?.incomingStats?.toReview ?? 0;
  const recentRejections: RecentRejection[] = stats?.recentRejections ?? [];
  const recentPayments: RecentPayment[] = stats?.recentPayments ?? [];

  const showRejections = !statsLoading && rejectedCount > 0;
  const showOverdue = !statsLoading && overdueCount > 0 && !showRejections;
  const showToReview = !statsLoading && toReview > 0 && !showRejections && !showOverdue;

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
    return isSectionVisible(key, role, tenantVisibility, canCustomize(role) ? localHidden : []);
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

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <DashboardHeader
        authLoading={authLoading}
        firstName={firstName}
        tenantName={tenantName}
        role={role}
        displayFullName={displayFullName}
        onOpenPanel={openPanel}
        onLogout={handleLogout}
      />

      <div className="p-6 space-y-5">

        {/* ── Toast ───────────────────────────────────────────────────────────── */}
        {toast && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-dark text-white text-sm px-5 py-2.5 rounded-xl shadow-lg">
            {toast}
          </div>
        )}

        {/* ── Attention banner ────────────────────────────────────────────── */}
        <AttentionBanner
          showRejections={showRejections}
          showOverdue={showOverdue}
          showToReview={showToReview}
          rejectedCount={rejectedCount}
          overdueCount={overdueCount}
          toReview={toReview}
        />

        {/* ── Financial: Money cards (OWNER/ADMIN/ACCOUNTANT only) ─────────── */}
        {financials && sectionVisible('receivables') && (
          <FinancialSummaryCards
            statsLoading={statsLoading}
            incomingLoading={incomingLoading}
            outstandingAmount={outstandingAmount}
            outstandingCount={outstandingCount}
            overdueCount={overdueCount}
            outstandingPayables={outstandingPayables}
            payablesCount={payablesCount}
            netCash={netCash}
          />
        )}

        {/* ── Financial: VAT summary line ─────────────────────────────────── */}
        {financials && sectionVisible('vat_strip') && !statsLoading && (
          <VatSummaryStrip outputVat={outputVat} inputVat={inputVat} netVat={netVat} />
        )}

        {/* ── FIRS Rejections card (all roles, always visible) ─────────────── */}
        <FirsRejectionsCard data={rejectionsData} loading={rejectionsLoading} />

        {/* ── Dashboard charts ──────────────────────────────────────────────── */}
        <DashboardCharts
          chartsLoading={chartsLoading}
          chartData={chartData}
          showRevenueChart={showRevenueChart}
          showPipelineChart={showPipelineChart}
          showActivityChart={showActivityChart}
        />

        {/* ── Bottom two panels ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Recent payments */}
          <RecentPaymentsPanel statsLoading={statsLoading} recentPayments={recentPayments} />

          {/* Needs attention */}
          {sectionVisible('needs_attention') && (
            <NeedsAttentionPanel
              statsLoading={statsLoading}
              attentionItems={attentionItems}
              overdueCount={overdueCount}
            />
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
          tenantVisibility={tenantVisibility}
        />
      )}
    </div>
  );
}
