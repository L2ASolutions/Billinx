"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { invoiceApi } from "@/lib/api";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "ALL",               label: "All" },
  { key: "ACCEPTED",          label: "Accepted" },
  { key: "QUEUED,SUBMITTING", label: "In queue" },
  { key: "REJECTED,SUBMISSION_FAILED,DEAD_LETTERED", label: "Rejected" },
] as const;

type StatusTab = typeof STATUS_TABS[number]["key"];

const STATUS_PILLS: Record<string, { label: string; cls: string }> = {
  ACCEPTED:          { label: "Accepted",  cls: "bg-green-50 text-green-700" },
  REJECTED:          { label: "Rejected",  cls: "bg-red-50 text-red-600" },
  QUEUED:            { label: "Queued",    cls: "bg-gray-100 text-gray-600" },
  SUBMITTING:        { label: "Sending",   cls: "bg-amber-50 text-amber-700" },
  SUBMISSION_FAILED: { label: "Rejected",  cls: "bg-red-50 text-red-600" },
  DEAD_LETTERED:     { label: "Rejected",  cls: "bg-red-100 text-red-700" },
  VALIDATING:        { label: "Queued",    cls: "bg-gray-100 text-gray-600" },
  VALIDATION_FAILED: { label: "Rejected",  cls: "bg-red-50 text-red-600" },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  rejectionCode?: string;
  updatedAt: string;
  createdAt: string;
  submissionAttempts?: Array<{ attemptNumber: number; status: string; errorMessage?: string }>;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── FIRS response text ─────────────────────────────────────────────────────────

function firsResponse(inv: Invoice): string {
  if (inv.status === "ACCEPTED") return "IRN issued";
  if (["QUEUED", "VALIDATING"].includes(inv.status)) return "In queue";
  if (inv.status === "SUBMITTING") return "Awaiting response";
  if (["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(inv.status)) {
    const err = inv.submissionAttempts?.find(a => a.errorMessage)?.errorMessage;
    return err ? err.slice(0, 30) : (inv.rejectionCode ?? "Rejected by FIRS");
  }
  return "—";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubmissionsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { limit: 50 };
      if (activeTab !== "ALL") params.status = activeTab;
      const res = await invoiceApi.list(params);
      setInvoices(res.data as Invoice[]);
      if (activeTab === "ALL") setAllTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const accepted  = invoices.filter((i) => i.status === "ACCEPTED").length;
  const inQueue   = invoices.filter((i) => ["QUEUED", "SUBMITTING", "VALIDATING"].includes(i.status)).length;
  const rejected  = invoices.filter((i) =>
    ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(i.status)
  ).length;
  const successRate = allTotal > 0 ? Math.round((accepted / allTotal) * 100) : 0;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark">FIRS submissions</h1>
          <p className="text-sm text-muted mt-0.5">All submission activity via Interswitch NRS</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green/20 text-xs font-medium text-green-700">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Connected · Interswitch NRS
          </span>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Total submitted</p>
            {loading ? <Sk className="h-8 w-12" /> : (
              <>
                <p className="text-3xl font-bold text-dark">{allTotal}</p>
                <p className="text-xs text-muted mt-1">All time</p>
              </>
            )}
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Accepted</p>
            {loading ? <Sk className="h-8 w-12" /> : (
              <>
                <p className="text-3xl font-bold text-green-700">{accepted}</p>
                <p className="text-xs text-muted mt-1">{successRate}% success rate</p>
              </>
            )}
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">In queue</p>
            {loading ? <Sk className="h-8 w-12" /> : (
              <>
                <p className="text-3xl font-bold text-amber-600">{inQueue}</p>
                <p className="text-xs text-muted mt-1">Processing now</p>
              </>
            )}
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Rejected</p>
            {loading ? <Sk className="h-8 w-12" /> : (
              <>
                <p className={`text-3xl font-bold ${rejected > 0 ? "text-red-600" : "text-dark"}`}>{rejected}</p>
                <p className="text-xs text-muted mt-1">Action needed</p>
              </>
            )}
          </div>
        </div>

        {/* Submission history table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-dark">Submission history</h2>
              <p className="text-xs text-muted mt-0.5">All times in WAT</p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex border-b border-border px-4">
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? "border-green text-green"
                    : "border-transparent text-muted hover:text-dark"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="px-6 py-4 space-y-2">
              {[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-muted text-sm">No submissions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Invoice", "Buyer", "Submitted", "Status", "Attempt", "FIRS response"].map((col, i) => (
                      <th key={col}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const pill = STATUS_PILLS[inv.status] ?? { label: inv.status.replace(/_/g, " "), cls: "bg-gray-100 text-gray-600" };
                    const isSending = inv.status === "SUBMITTING";
                    const latestAttempt = inv.submissionAttempts?.length ?? 1;
                    return (
                      <tr key={inv.id}
                        className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                        <td className="px-6 py-3">
                          <Link href={`/invoices/${inv.id}`}
                            className="text-sm font-mono text-green hover:underline">
                            {inv.platformIrn?.slice(0, 20) ?? inv.id.slice(0, 8)}…
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                        <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                          {formatDateTime(inv.updatedAt)}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pill.cls}`}>
                            {isSending && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                            )}
                            {pill.label}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm text-muted text-center">
                          {latestAttempt}
                        </td>
                        <td className="px-6 py-3 text-sm text-muted">
                          {firsResponse(inv)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
