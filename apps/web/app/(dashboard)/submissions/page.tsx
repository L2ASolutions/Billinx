"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { invoiceApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "ALL",               label: "All" },
  { key: "ACCEPTED",          label: "Accepted" },
  { key: "QUEUED,SUBMITTING", label: "In queue" },
  { key: "REJECTED",          label: "Rejected" },
  { key: "SUBMISSION_FAILED", label: "Failed" },
  { key: "DEAD_LETTERED",     label: "Dead letter" },
] as const;

type StatusTab = typeof STATUS_TABS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED:          "bg-green-50 text-green-700",
  REJECTED:          "bg-red-50 text-red-600",
  QUEUED:            "bg-blue-50 text-blue-600",
  SUBMITTING:        "bg-amber-50 text-amber-700",
  SUBMISSION_FAILED: "bg-red-50 text-red-600",
  DEAD_LETTERED:     "bg-red-100 text-red-700",
  VALIDATING:        "bg-blue-50 text-blue-600",
  VALIDATION_FAILED: "bg-red-50 text-red-600",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  updatedAt: string;
  createdAt: string;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubmissionsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
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
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  // Derive stat counts from loaded data
  const accepted  = invoices.filter((i) => i.status === "ACCEPTED").length;
  const inQueue   = invoices.filter((i) => ["QUEUED", "SUBMITTING", "VALIDATING"].includes(i.status)).length;
  const rejected  = invoices.filter((i) => ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(i.status)).length;

  return (
    <>
      <Topbar title="Submissions" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total",     value: total,    cls: "text-dark" },
            { label: "Accepted",  value: accepted,  cls: "text-green-700" },
            { label: "In queue",  value: inQueue,   cls: "text-amber-600" },
            { label: "Rejected",  value: rejected,  cls: rejected > 0 ? "text-red-600" : "text-dark" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-white rounded-xl border border-border p-5">
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">{label}</p>
              {loading ? (
                <Sk className="h-8 w-12" />
              ) : (
                <p className={`text-3xl font-bold ${cls}`}>{value}</p>
              )}
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex border-b border-border px-4">
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-muted text-sm">No submissions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["IRN", "Buyer", "Status", "Last updated"].map((col, i) => (
                      <th key={col}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i === 3 ? "text-right" : "text-left"}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}
                      className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                      <td className="px-6 py-3">
                        <Link href={`/invoices/${inv.id}`}
                          className="text-sm font-mono text-green hover:underline">
                          {inv.platformIrn?.slice(0, 24) ?? inv.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {inv.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted text-right">
                        {formatDateTime(inv.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
