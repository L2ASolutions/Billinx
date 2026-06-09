"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { vatReturnApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

function prevMonthRange(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    start: first.toISOString().split("T")[0],
    end: last.toISOString().split("T")[0],
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  totalSales: number;
  exemptSales: number;
  zeroRatedSales: number;
  vatableSales: number;
  outputVat: number;
  totalPurchases: number;
  inputVat: number;
  netVatPayable: number;
}

interface ScheduleARow {
  customerName: string;
  customerTin: string;
  productName: string;
  productCategory: string;
  productDescription: string;
  stateCode: string;
  lgaCode: string;
  amountExclVat: number;
}

interface ScheduleBRow {
  description: string;
  customerTin: string;
  customerName: string;
  transactionDate: string;
  invoiceNumber: string;
  invoiceAmount: number;
  adjustedAmount: number;
}

interface ScheduleC2Row {
  sellerName: string;
  sellerTin: string;
  productDescription: string;
  amountExclVat: number;
  vatStatus: string;
}

interface VatReturnData {
  summary: Summary;
  scheduleA: ScheduleARow[];
  scheduleB: ScheduleBRow[];
  scheduleC2: ScheduleC2Row[];
}

// ── Summary cards ─────────────────────────────────────────────────────────────

const SUMMARY_CARDS: { key: keyof Summary; label: string; highlight?: boolean }[] = [
  { key: "totalSales",      label: "Total Sales (excl. VAT)" },
  { key: "exemptSales",     label: "Exempt Sales" },
  { key: "zeroRatedSales",  label: "Zero-Rated Sales" },
  { key: "vatableSales",    label: "VATable Sales" },
  { key: "outputVat",       label: "Output VAT (7.5%)" },
  { key: "totalPurchases",  label: "Total Purchases" },
  { key: "inputVat",        label: "Input VAT" },
  { key: "netVatPayable",   label: "Net VAT Payable", highlight: true },
];

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const isCredit = highlight && value <= 0;
  const isOwed = highlight && value > 0;
  return (
    <div className={`rounded-xl border p-5 ${
      isCredit ? "bg-green-50 border-green-200" :
      isOwed   ? "bg-amber-50 border-amber-200" :
                 "bg-white border-border"
    }`}>
      <p className={`text-xs font-medium mb-2 ${isCredit ? "text-green-700" : isOwed ? "text-amber-700" : "text-muted"}`}>
        {label}
      </p>
      <p className={`text-xl font-bold ${isCredit ? "text-green-800" : isOwed ? "text-amber-800" : "text-dark"}`}>
        {fmtCurrency(value)}
      </p>
      {highlight && (
        <p className={`text-xs mt-1 ${isCredit ? "text-green-600" : "text-amber-600"}`}>
          {isCredit ? "Credit position" : "Amount owed to FIRS"}
        </p>
      )}
    </div>
  );
}

// ── Schedule preview ──────────────────────────────────────────────────────────

function SchedulePreview<T>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: { key: keyof T; label: string; fmt?: (v: unknown) => string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const preview = expanded ? rows : rows.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-semibold text-dark text-sm">
          {title} <span className="text-muted font-normal">({rows.length} rows)</span>
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border">
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No data for this period.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface">
                    <tr>
                      {columns.map((col) => (
                        <th key={String(col.key)} className="px-4 py-2 text-left font-semibold text-muted whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.map((row, i) => (
                      <tr key={i} className="hover:bg-surface/50">
                        {columns.map((col) => {
                          const v = row[col.key];
                          return (
                            <td key={String(col.key)} className="px-4 py-2 text-dark whitespace-nowrap">
                              {col.fmt ? col.fmt(v) : String(v ?? "")}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 5 && (
                <div className="px-5 py-3 border-t border-border">
                  <button
                    className="text-xs text-green font-medium hover:underline"
                    onClick={() => setExpanded((e) => !e)}
                  >
                    {expanded ? "Show fewer rows" : `Show all ${rows.length} rows`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VatReturnPage() {
  const { user } = useAuth();
  const canExport = ["OWNER", "ADMIN", "ACCOUNTANT"].includes(user?.role ?? "");

  const defaults = prevMonthRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<VatReturnData | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleLoad() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const result = await vatReturnApi.summary(startDate, endDate) as VatReturnData;
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load VAT return data.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, filename } = await vatReturnApi.export(startDate, endDate);
      downloadBlob(blob, filename);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header className="bg-white border-b border-border px-6 py-5 sticky top-0 z-10">
        <h1 className="text-xl font-bold text-dark">VAT Return</h1>
        <p className="text-sm text-muted mt-0.5">Generate and download your VAT 002 return for NRS filing</p>
      </header>

      <div className="p-6 space-y-6 pb-24 max-w-5xl">

        {/* Period selector */}
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">Select filing period</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              />
            </div>
            <Button onClick={handleLoad} loading={loading}>
              Load summary
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Results */}
        {data && (
          <>
            {/* Summary cards */}
            <div>
              <h2 className="font-semibold text-dark mb-3">VAT position summary</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SUMMARY_CARDS.map(({ key, label, highlight }) => (
                  <SummaryCard
                    key={key}
                    label={label}
                    value={data.summary[key]}
                    highlight={highlight}
                  />
                ))}
              </div>
            </div>

            {/* Schedule previews */}
            <div className="space-y-3">
              <h2 className="font-semibold text-dark">Schedule previews</h2>

              <SchedulePreview<ScheduleARow>
                title="Schedule A — Sales"
                rows={data.scheduleA}
                columns={[
                  { key: "customerName", label: "Customer" },
                  { key: "customerTin", label: "TIN" },
                  { key: "productName", label: "Product" },
                  { key: "productCategory", label: "Category" },
                  { key: "stateCode", label: "State" },
                  { key: "lgaCode", label: "LGA" },
                  { key: "amountExclVat", label: "Amount (excl. VAT)", fmt: (v) => fmtCurrency(Number(v)) },
                ]}
              />

              <SchedulePreview<ScheduleBRow>
                title="Schedule B — Sales Adjustments"
                rows={data.scheduleB}
                columns={[
                  { key: "invoiceNumber", label: "Invoice No." },
                  { key: "customerName", label: "Customer" },
                  { key: "customerTin", label: "TIN" },
                  { key: "description", label: "Reason" },
                  { key: "transactionDate", label: "Date", fmt: (v) => fmtDate(String(v)) },
                  { key: "invoiceAmount", label: "Invoice Amount", fmt: (v) => fmtCurrency(Number(v)) },
                  { key: "adjustedAmount", label: "Adjusted Amount", fmt: (v) => fmtCurrency(Number(v)) },
                ]}
              />

              <SchedulePreview<ScheduleC2Row>
                title="Schedule C2 — Purchases"
                rows={data.scheduleC2}
                columns={[
                  { key: "sellerName", label: "Supplier" },
                  { key: "sellerTin", label: "TIN" },
                  { key: "productDescription", label: "Description" },
                  { key: "amountExclVat", label: "Amount (excl. VAT)", fmt: (v) => fmtCurrency(Number(v)) },
                  { key: "vatStatus", label: "VAT Status" },
                ]}
              />
            </div>

            {/* Export */}
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-semibold text-dark mb-1">Download VAT 002 Excel</h2>
              <p className="text-sm text-muted mb-4">
                Pre-filled with Schedules A, B, and C2 from this period.
              </p>
              {canExport ? (
                <>
                  <Button loading={exporting} onClick={handleExport}>
                    Download VAT 002 Excel
                  </Button>
                  <p className="text-xs text-muted mt-3">
                    Schedules D (Imports), E (Self-Charge VAT), and F (MDA Withholdings) must be completed manually.
                    Your VAT return is due by the 21st of the following month.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  Only Owner, Admin, and Accountant roles can download the VAT 002 file.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
