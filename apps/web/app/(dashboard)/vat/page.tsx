'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { vatApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VatSummary {
  period: string;
  outputVat: number;
  inputVat: number;
  netVat: number;
  outputVatOutstanding: number;
  inputVatOutstanding: number;
  netVatExposure: number;
  outputCount: number;
  inputCount: number;
  unreconciledCount: number;
  status: string;
}

interface VatEntry {
  id: string;
  type: 'OUTPUT' | 'INPUT';
  invoiceId?: string;
  incomingInvoiceId?: string;
  supplierTin?: string;
  buyerTin?: string;
  taxableAmount: number;
  vatAmount: number;
  vatRate: number;
  invoiceDate: string;
  period: string;
  status: string;
}

interface Mismatch extends VatEntry {
  issue: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

function monthOptions(): { value: string; label: string }[] {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-NG', { year: 'numeric', month: 'long' });
    opts.push({ value, label });
  }
  return opts;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Metric card ───────────────────────────────────────────────────────────────

function VatCard({
  label,
  value,
  sub,
  colorCls = 'bg-white border-border',
  labelCls = 'text-muted',
  valueCls = 'text-dark',
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  colorCls?: string;
  labelCls?: string;
  valueCls?: string;
  loading: boolean;
}) {
  return (
    <div className={`border rounded-xl p-5 ${colorCls}`}>
      <p className={`text-xs font-medium uppercase tracking-wide mb-3 ${labelCls}`}>{label}</p>
      {loading ? (
        <>
          <Sk className="h-9 w-24 mb-2" />
          <Sk className="h-3 w-36" />
        </>
      ) : (
        <>
          <p className={`text-3xl font-bold ${valueCls}`}>{value}</p>
          {sub && <p className={`text-xs mt-1.5 ${labelCls}`}>{sub}</p>}
        </>
      )}
    </div>
  );
}

// ── Entry table ───────────────────────────────────────────────────────────────

function EntryTable({
  entries,
  type,
  loading,
  onReconcile,
}: {
  entries: VatEntry[];
  type: 'OUTPUT' | 'INPUT';
  loading: boolean;
  onReconcile: (id: string) => void;
}) {
  const cols = type === 'OUTPUT'
    ? ['Invoice #', 'Buyer TIN', 'Taxable', 'VAT', 'Status']
    : ['Invoice #', 'Supplier TIN', 'Taxable', 'VAT', 'Status'];

  const filtered = entries.filter((e) => e.type === type);

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="font-semibold text-dark text-sm">
          {type === 'OUTPUT' ? 'Output VAT Entries' : 'Input VAT Entries'}
        </h3>
      </div>
      {loading ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-10 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">No entries for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {cols.map((col, i) => (
                  <th
                    key={col}
                    className={`px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i >= 2 ? 'text-right' : 'text-left'}`}
                  >
                    {col}
                  </th>
                ))}
                <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide text-right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const tin = type === 'OUTPUT' ? e.buyerTin : e.supplierTin;
                const invoiceRef = e.invoiceId ?? e.incomingInvoiceId ?? '—';
                const isReconciled = e.status === 'RECONCILED';
                return (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{invoiceRef.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs text-muted">{tin ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(e.taxableAmount, 'NGN')}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(e.vatAmount, 'NGN')}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        isReconciled ? 'bg-green-50 text-green-700' :
                        e.status === 'DISPUTED' ? 'bg-red-50 text-red-600' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {e.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isReconciled && (
                        <button
                          onClick={() => onReconcile(e.id)}
                          className="text-xs text-green hover:underline"
                        >
                          Reconcile
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VatPage() {
  useRequireAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [summary, setSummary] = useState<VatSummary | null>(null);
  const [entries, setEntries] = useState<VatEntry[]>([]);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setSummaryLoading(true);
    setEntriesLoading(true);

    const [summaryRes, entriesRes, mismatchRes] = await Promise.allSettled([
      vatApi.summary(p),
      vatApi.entries({ period: p, limit: 100 }),
      vatApi.mismatches(p),
    ]);

    setSummary(summaryRes.status === 'fulfilled' ? (summaryRes.value as VatSummary) : null);
    setSummaryLoading(false);

    setEntries(
      entriesRes.status === 'fulfilled'
        ? ((entriesRes.value as { data: VatEntry[] }).data ?? [])
        : [],
    );
    setEntriesLoading(false);

    setMismatches(
      mismatchRes.status === 'fulfilled'
        ? ((mismatchRes.value as { issues: Mismatch[] }).issues ?? [])
        : [],
    );
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  async function handleReconcile(entryId: string) {
    await vatApi.reconcile(entryId);
    void load(period);
  }

  const net = summary?.netVat ?? 0;
  const netExposure = summary?.netVatExposure ?? 0;
  const netIsPos = net > 0;
  const netIsNeg = net < 0;
  const exposureIsPos = netExposure > 0;
  const exposureIsNeg = netExposure < 0;

  const periods = monthOptions();

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-5 sticky top-0 z-10">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-dark">VAT Reconciliation</h1>
            <p className="text-sm text-muted mt-0.5">Track and reconcile your VAT position</p>
          </div>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm text-dark bg-white focus:outline-none focus:ring-2 focus:ring-green/20"
          >
            {periods.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Status bar */}
        <div className="bg-white rounded-xl border border-border px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-dark font-medium">Period: {period}</span>
          <span className="text-muted">·</span>
          <span className={`font-medium ${summary?.status === 'FILED' ? 'text-green-700' : summary?.status === 'CLOSED' ? 'text-blue-700' : 'text-amber-700'}`}>
            {summaryLoading ? '—' : `Status: ${summary?.status ?? 'OPEN'}`}
          </span>
          {!summaryLoading && (summary?.unreconciledCount ?? 0) > 0 && (
            <>
              <span className="text-muted">·</span>
              <span className="text-amber-600">{summary!.unreconciledCount} entries unreconciled</span>
            </>
          )}
        </div>

        {/* Row 1: Period summary */}
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Period Summary</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <VatCard
              label="Output VAT"
              value={formatCurrency(summary?.outputVat ?? 0, 'NGN')}
              sub={`${summary?.outputCount ?? 0} entries · collected from buyers`}
              loading={summaryLoading}
            />
            <VatCard
              label="Input VAT"
              value={formatCurrency(summary?.inputVat ?? 0, 'NGN')}
              sub={`${summary?.inputCount ?? 0} entries · paid to suppliers`}
              loading={summaryLoading}
            />
            <VatCard
              label="Net VAT"
              value={formatCurrency(Math.abs(net), 'NGN')}
              sub={netIsPos ? 'Net receivable — owed by buyers' : netIsNeg ? 'Net payable — owed to FIRS' : 'Balanced'}
              colorCls={netIsPos ? 'bg-green-50 border-green-200' : netIsNeg ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}
              labelCls={netIsPos ? 'text-green-700' : netIsNeg ? 'text-red-700' : 'text-gray-600'}
              valueCls={netIsPos ? 'text-green-800' : netIsNeg ? 'text-red-700' : 'text-gray-700'}
              loading={summaryLoading}
            />
          </div>
        </div>

        {/* Row 2: Outstanding exposure */}
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Outstanding Exposure</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <VatCard
              label="Output VAT Outstanding"
              value={formatCurrency(summary?.outputVatOutstanding ?? 0, 'NGN')}
              sub="VAT in unpaid receivables"
              colorCls="bg-amber-50 border-amber-200"
              labelCls="text-amber-700"
              valueCls="text-amber-800"
              loading={summaryLoading}
            />
            <VatCard
              label="Input VAT Outstanding"
              value={formatCurrency(summary?.inputVatOutstanding ?? 0, 'NGN')}
              sub="VAT in unpaid payables"
              colorCls="bg-amber-50 border-amber-200"
              labelCls="text-amber-700"
              valueCls="text-amber-800"
              loading={summaryLoading}
            />
            <VatCard
              label="Net VAT Exposure"
              value={formatCurrency(Math.abs(netExposure), 'NGN')}
              sub={exposureIsPos ? 'Net receivable' : exposureIsNeg ? 'Net payable' : 'Balanced'}
              colorCls={exposureIsPos ? 'bg-green-50 border-green-200' : exposureIsNeg ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}
              labelCls={exposureIsPos ? 'text-green-700' : exposureIsNeg ? 'text-red-700' : 'text-gray-600'}
              valueCls={exposureIsPos ? 'text-green-800' : exposureIsNeg ? 'text-red-700' : 'text-gray-700'}
              loading={summaryLoading}
            />
          </div>
        </div>

        {/* Entry tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EntryTable
            entries={entries}
            type="OUTPUT"
            loading={entriesLoading}
            onReconcile={handleReconcile}
          />
          <EntryTable
            entries={entries}
            type="INPUT"
            loading={entriesLoading}
            onReconcile={handleReconcile}
          />
        </div>

        {/* Mismatches */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-dark text-sm">Potential Issues</h3>
          </div>
          {entriesLoading ? (
            <div className="p-4 space-y-2">
              {[0, 1].map((i) => <Sk key={i} className="h-10 w-full" />)}
            </div>
          ) : mismatches.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-green-700 font-medium">No issues found ✓</p>
              <p className="text-xs text-muted mt-1">All VAT entries match expected amounts and rates</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {mismatches.map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-start gap-3">
                  <span className="mt-1 w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <div>
                    <p className="text-sm text-dark font-medium">{m.issue}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {m.type} · {m.period} · VAT: {formatCurrency(m.vatAmount, 'NGN')} · Rate: {m.vatRate}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
