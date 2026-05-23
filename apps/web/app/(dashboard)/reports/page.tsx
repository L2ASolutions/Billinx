"use client";

import { useState } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { exportApi } from "@/lib/api";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";

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

  return (
    <>
      <Topbar title="Reports & Exports" />

      <div className="p-6 space-y-6 max-w-3xl">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* Date range export */}
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-1">Date Range Export</h2>
          <p className="text-sm text-muted mb-5">
            Export all invoices in a date range for FIRS compliance reporting.
          </p>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
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

        {/* Monthly report */}
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
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Year</label>
              <select
                className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {[2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
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

        {/* Info */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-sm text-blue-700">
            <strong>FIRS Compliance:</strong> CSV and JSON exports are formatted for FIRS / NRS e-invoicing audit submissions.
            Exports are rate-limited to one request per 60 seconds per tenant.
          </p>
        </div>
      </div>
    </>
  );
}
