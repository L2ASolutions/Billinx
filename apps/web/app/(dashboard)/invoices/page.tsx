"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
  DRAFT: "bg-gray-100 text-gray-600",
  QUEUED: "bg-blue-50 text-blue-600",
  SUBMITTING: "bg-yellow-50 text-yellow-700",
  VALIDATION_FAILED: "bg-red-50 text-red-600",
  SUBMISSION_FAILED: "bg-red-50 text-red-600",
  DEAD_LETTERED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  VALIDATING: "bg-blue-50 text-blue-600",
};

const STATUS_OPTIONS = [
  "ALL", "DRAFT", "VALIDATING", "QUEUED", "SUBMITTING",
  "ACCEPTED", "REJECTED", "VALIDATION_FAILED", "SUBMISSION_FAILED",
  "DEAD_LETTERED", "CANCELLED",
];

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  invoiceType: string;
  createdAt: string;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (status !== "ALL") params.status = status;
      if (search) params.search = search;
      const res = await invoiceApi.list(params);
      setInvoices(res.data as Invoice[]);
      setTotal(res.total);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load invoices";
      console.error("[Invoices] load error:", err);
      setError(msg);
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <Topbar
        title="Invoices"
        actions={
          <Link href="/invoices/new">
            <Button size="sm">+ New Invoice</Button>
          </Link>
        }
      />

      <div className="p-6 space-y-4">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <Input
              placeholder="Search by IRN, buyer name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <div>
            <select
              className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border">
          {loading ? (
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-muted text-sm">
              No invoices found.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">IRN</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Type</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Buyer</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-6 py-3">
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline">
                        {inv.platformIrn ? inv.platformIrn.slice(0, 20) + "…" : inv.id.slice(0, 8) + "…"}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{inv.invoiceType}</td>
                    <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                    <td className="px-6 py-3 text-sm text-dark font-medium">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {inv.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{formatDate(inv.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Showing {invoices.length} of {total}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="px-3 py-1.5 text-dark">
                {page} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
