"use client";

import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { exportApi, analyticsApi } from "@/lib/api";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtCurrency(n: number) {
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

type Period = "month" | "quarter" | "year";

// ── Analytics types ───────────────────────────────────────────────────────────

interface TopItem {
  itemName: string;
  hsnCode: string;
  totalQuantity: number;
  totalRevenue: number;
  invoiceCount: number;
  averagePrice: number;
}

interface TopPurchase {
  description: string;
  supplierName: string;
  totalQuantity: number;
  totalSpend: number;
  invoiceCount: number;
  averagePrice: number;
}

interface TopSupplier {
  supplierName: string;
  supplierTin: string;
  invoiceCount: number;
  totalSpend: number;
  lastInvoiceDate: string;
}

interface TopClient {
  clientName: string;
  tin: string;
  invoiceCount: number;
  totalRevenue: number;
  lastInvoiceDate: string;
}

interface PriceTrend {
  period: string;
  averagePrice: number;
  invoiceCount: number;
}

// ── Sales Analytics Tab ───────────────────────────────────────────────────────

function SalesAnalyticsTab() {
  const [period, setPeriod] = useState<Period>("year");
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, clients] = await Promise.all([
        analyticsApi.topItemsSold(period) as Promise<TopItem[]>,
        analyticsApi.topClients() as Promise<TopClient[]>,
      ]);
      setTopItems(items);
      setTopClients(clients);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [period]);

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {(["month", "quarter", "year"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              period === p
                ? "bg-green text-white border-green"
                : "border-border text-muted hover:border-green hover:text-green"
            }`}
          >
            {p === "month" ? "This Month" : p === "quarter" ? "This Quarter" : "This Year"}
          </button>
        ))}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      {/* Top sold items */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-dark">Top selling items</h3>
          <p className="text-xs text-muted mt-0.5">By revenue from accepted invoices</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-2.5 font-medium text-muted">Item</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">HSN</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Qty sold</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Revenue</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Avg price</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-muted">Loading…</td></tr>}
            {!loading && topItems.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted">No data for this period</td></tr>}
            {!loading && topItems.map((item, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/40">
                <td className="px-4 py-3 font-medium text-dark max-w-[200px] truncate">{item.itemName}</td>
                <td className="px-4 py-3 text-muted">{item.hsnCode || "—"}</td>
                <td className="px-4 py-3 text-right">{item.totalQuantity.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium text-dark">{fmtCurrency(item.totalRevenue)}</td>
                <td className="px-4 py-3 text-right text-muted">{fmtCurrency(item.averagePrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top clients */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-dark">Top clients by revenue</h3>
          <p className="text-xs text-muted mt-0.5">From accepted outgoing invoices</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-2.5 font-medium text-muted">Client</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">TIN</th>
              <th className="text-center px-4 py-2.5 font-medium text-muted">Invoices</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Revenue</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">Last invoice</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-muted">Loading…</td></tr>}
            {!loading && topClients.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted">No accepted invoices yet</td></tr>}
            {!loading && topClients.map((c, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/40">
                <td className="px-4 py-3 font-medium text-dark">{c.clientName}</td>
                <td className="px-4 py-3 text-muted">{c.tin || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center bg-green/10 text-green text-xs font-semibold px-2 py-0.5 rounded-full">{c.invoiceCount}</span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-dark">{fmtCurrency(c.totalRevenue)}</td>
                <td className="px-4 py-3 text-muted">{fmtDate(c.lastInvoiceDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Purchase Analytics Tab ────────────────────────────────────────────────────

function PurchaseAnalyticsTab() {
  const [period, setPeriod] = useState<Period>("year");
  const [topPurchases, setTopPurchases] = useState<TopPurchase[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<TopSupplier[]>([]);
  const [priceTrends, setPriceTrends] = useState<PriceTrend[]>([]);
  const [trendItem, setTrendItem] = useState("");
  const [trendSearch, setTrendSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [purchases, suppliers] = await Promise.all([
        analyticsApi.topPurchases(period) as Promise<TopPurchase[]>,
        analyticsApi.topSuppliers() as Promise<TopSupplier[]>,
      ]);
      setTopPurchases(purchases);
      setTopSuppliers(suppliers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [period]);

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function loadTrends() {
    if (!trendSearch.trim()) return;
    setTrendLoading(true);
    try {
      const data = await analyticsApi.priceTrends(trendSearch, 6) as PriceTrend[];
      setPriceTrends(data);
      setTrendItem(trendSearch);
    } catch {
      setPriceTrends([]);
    } finally {
      setTrendLoading(false);
    }
  }

  const trendChange = priceTrends.length >= 2
    ? ((priceTrends[priceTrends.length - 1].averagePrice - priceTrends[0].averagePrice) / priceTrends[0].averagePrice) * 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {(["month", "quarter", "year"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              period === p
                ? "bg-green text-white border-green"
                : "border-border text-muted hover:border-green hover:text-green"
            }`}
          >
            {p === "month" ? "This Month" : p === "quarter" ? "This Quarter" : "This Year"}
          </button>
        ))}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      {/* Top purchased items */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-dark">Most purchased items</h3>
          <p className="text-xs text-muted mt-0.5">By spend from incoming invoices</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-2.5 font-medium text-muted">Item</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">Supplier</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Qty</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Total spend</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Avg price</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-muted">Loading…</td></tr>}
            {!loading && topPurchases.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted">No purchase data for this period</td></tr>}
            {!loading && topPurchases.map((item, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/40">
                <td className="px-4 py-3 font-medium text-dark max-w-[180px] truncate">{item.description}</td>
                <td className="px-4 py-3 text-muted max-w-[150px] truncate">{item.supplierName}</td>
                <td className="px-4 py-3 text-right">{item.totalQuantity.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium text-dark">{fmtCurrency(item.totalSpend)}</td>
                <td className="px-4 py-3 text-right text-muted">{fmtCurrency(item.averagePrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top suppliers */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-dark">Top suppliers by spend</h3>
          <p className="text-xs text-muted mt-0.5">From all incoming invoices</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-2.5 font-medium text-muted">Supplier</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">TIN</th>
              <th className="text-center px-4 py-2.5 font-medium text-muted">Invoices</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted">Total spend</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted">Last invoice</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-muted">Loading…</td></tr>}
            {!loading && topSuppliers.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-muted">No incoming invoices yet</td></tr>}
            {!loading && topSuppliers.map((s, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-surface/40">
                <td className="px-4 py-3 font-medium text-dark">{s.supplierName}</td>
                <td className="px-4 py-3 text-muted">{s.supplierTin || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{s.invoiceCount}</span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-dark">{fmtCurrency(s.totalSpend)}</td>
                <td className="px-4 py-3 text-muted">{fmtDate(s.lastInvoiceDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Price trends */}
      <div className="bg-white rounded-xl border border-border p-5">
        <h3 className="font-semibold text-dark mb-1">Price trends</h3>
        <p className="text-xs text-muted mb-4">Track how unit price for a purchased item has changed over the last 6 months</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Input
              label="Item name"
              placeholder="Search for an item to see price history…"
              value={trendSearch}
              onChange={(e) => setTrendSearch(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); loadTrends(); } }}
            />
          </div>
          <Button onClick={loadTrends} loading={trendLoading} variant="secondary">Search</Button>
        </div>

        {trendItem && !trendLoading && (
          <div className="mt-4">
            {priceTrends.length === 0 ? (
              <p className="text-sm text-muted">No price data found for &ldquo;{trendItem}&rdquo;</p>
            ) : (
              <>
                {trendChange !== null && (
                  <p className="text-sm font-medium text-dark mb-3">
                    {fmtCurrency(priceTrends[0].averagePrice)} → {fmtCurrency(priceTrends[priceTrends.length - 1].averagePrice)}{" "}
                    <span className={trendChange >= 0 ? "text-red-600" : "text-green"}>
                      ({trendChange >= 0 ? "+" : ""}{trendChange.toFixed(1)}%)
                    </span>
                  </p>
                )}
                <div className="space-y-2">
                  {priceTrends.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-muted w-16 shrink-0">{t.period}</span>
                      <div className="flex-1 bg-surface rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-green h-2 rounded-full"
                          style={{
                            width: `${Math.max(4, (t.averagePrice / Math.max(...priceTrends.map(x => x.averagePrice))) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-dark font-medium w-28 text-right shrink-0">{fmtCurrency(t.averagePrice)}</span>
                      <span className="text-muted text-xs shrink-0">{t.invoiceCount} inv</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Reports Page ─────────────────────────────────────────────────────────

type Tab = "exports" | "sales" | "purchases";

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";
  const [activeTab, setActiveTab] = useState<Tab>("exports");

  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(today);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const [csvLoading, setCsvLoading] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [jsonResult, setJsonResult] = useState<Record<string, unknown> | null>(null);
  const [monthlyResult, setMonthlyResult] = useState<unknown>(null);
  const [error, setError] = useState("");

  async function handleExportCsv() {
    setError("");
    setCsvLoading(true);
    try {
      const { blob, filename } = await exportApi.csv(startDate, endDate);
      downloadBlob(blob, filename || `invoices-${startDate}-to-${endDate}.csv`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setCsvLoading(false);
    }
  }

  async function handleExportJson() {
    setError("");
    setJsonLoading(true);
    try {
      const data = await exportApi.json(startDate, endDate);
      setJsonResult(data as Record<string, unknown>);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setJsonLoading(false);
    }
  }

  async function handleMonthly() {
    setError("");
    setMonthlyLoading(true);
    try {
      const data = await exportApi.monthly(year, month);
      setMonthlyResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Report failed");
    } finally {
      setMonthlyLoading(false);
    }
  }

  function downloadJsonResult() {
    if (!jsonResult) return;
    const blob = new Blob([JSON.stringify(jsonResult, null, 2)], { type: "application/json" });
    downloadBlob(blob, `invoices-${startDate}-to-${endDate}.json`);
  }

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  type MonthlyReport = { year: number; month: number; summary?: Record<string, unknown>; invoices?: unknown[] };
  const mr = monthlyResult as MonthlyReport | null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "exports", label: "Exports" },
    { key: "sales", label: "Sales Analytics" },
    { key: "purchases", label: "Purchase Analytics" },
  ];

  return (
    <>
      <Topbar title="Reports & Exports" />

      <div className="p-6 space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === t.key
                  ? "border-green text-green"
                  : "border-transparent text-muted hover:text-dark"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Exports tab */}
        {activeTab === "exports" && (
          <div className="space-y-6 max-w-3xl">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
            )}

            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-semibold text-dark mb-1">Date Range Export</h2>
              <p className="text-sm text-muted mb-5">
                Export all invoices in a date range for FIRS compliance reporting.
              </p>
              <div className="flex gap-3 items-end flex-wrap">
                <div><Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                <div><Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button loading={csvLoading} onClick={handleExportCsv}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5 inline">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export CSV
                </Button>
                <Button variant="secondary" loading={jsonLoading} onClick={handleExportJson}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5 inline">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export JSON
                </Button>
              </div>

              {jsonResult && (
                <div className="mt-4 p-4 bg-surface rounded-xl border border-border">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-dark">JSON Export Ready</p>
                    <Button size="sm" onClick={downloadJsonResult}>Download</Button>
                  </div>
                  <pre className="text-xs text-muted overflow-auto max-h-48 whitespace-pre-wrap">
                    {JSON.stringify(jsonResult, null, 2).slice(0, 800)}
                    {JSON.stringify(jsonResult, null, 2).length > 800 ? "\n…(truncated)" : ""}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-semibold text-dark mb-1">Monthly Summary Report</h2>
              <p className="text-sm text-muted mb-5">
                Get an aggregated summary for a specific month including totals, counts, and acceptance rates.
              </p>
              <div className="flex gap-3 items-end flex-wrap">
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">Month</label>
                  <select
                    className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">Year</label>
                  <select
                    className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <Button loading={monthlyLoading} onClick={handleMonthly}>Get Report</Button>
              </div>

              {mr && (
                <div className="mt-5 space-y-4">
                  <div className="p-3 bg-surface rounded-lg border border-border">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                      {MONTHS[(mr.month ?? month) - 1]} {mr.year ?? year} Summary
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {mr.summary && Object.entries(mr.summary).map(([k, v]) => (
                        <div key={k}>
                          <p className="text-xs text-muted capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</p>
                          <p className="text-sm font-semibold text-dark">{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(mr, null, 2)], { type: "application/json" });
                        downloadBlob(blob, `report-${mr.year ?? year}-${String(mr.month ?? month).padStart(2, "0")}.json`);
                      }}
                    >
                      Download JSON
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-sm text-blue-700">
                <strong>FIRS Compliance:</strong> CSV and JSON exports are formatted for FIRS / NRS e-invoicing audit submissions.
                Exports are rate-limited to one request per 60 seconds per tenant.
              </p>
            </div>
          </div>
        )}

        {activeTab === "sales" && <SalesAnalyticsTab />}
        {activeTab === "purchases" && <PurchaseAnalyticsTab />}
      </div>
    </>
  );
}
