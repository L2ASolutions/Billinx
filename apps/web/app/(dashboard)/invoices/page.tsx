"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  invoiceType: string;
  firsConfirmedIrn?: string;
  rejectionCode?: string;
  paymentStatus?: string;
  isOverdue?: boolean;
  paymentDueDate?: string;
  createdAt: string;
}

interface BulkBatchStatus {
  batchId: string;
  total: number;
  queued: number;
  processing: number;
  accepted: number;
  rejected: number;
  failed: number;
  percentComplete: number;
  status: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "ALL",      label: "All" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "PENDING",  label: "Pending" },
  { key: "REJECTED", label: "Rejected" },
  { key: "DRAFT",    label: "Draft" },
  { key: "OVERDUE",  label: "Overdue" },
] as const;

type StatusTab = typeof STATUS_TABS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED:          "bg-green-50 text-green-700",
  REJECTED:          "bg-red-50 text-red-600",
  DRAFT:             "bg-gray-100 text-gray-600",
  QUEUED:            "bg-blue-50 text-blue-600",
  SUBMITTING:        "bg-amber-50 text-amber-700",
  SUBMITTED:         "bg-blue-50 text-blue-700",
  VALIDATION_FAILED: "bg-red-50 text-red-600",
  SUBMISSION_FAILED: "bg-red-50 text-red-600",
  DEAD_LETTERED:     "bg-red-100 text-red-700",
  CANCELLED:         "bg-gray-100 text-gray-500",
  VALIDATING:        "bg-blue-50 text-blue-600",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID:    "bg-green-50 text-green-700",
  PARTIAL: "bg-blue-50 text-blue-600",
  UNPAID:  "bg-amber-50 text-amber-700",
  OVERDUE: "bg-red-50 text-red-600",
};

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────

function BulkUploadModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BulkBatchStatus | null>(null);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".csv")) setFile(f);
    else setError("Please drop a .csv file");
  }

  async function handleUpload() {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const res = await invoiceApi.bulkUploadCsv(file) as { batchId?: string };
      if (res?.batchId) {
        setBatchId(res.batchId);
        pollBatch(res.batchId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function pollBatch(id: string) {
    intervalRef.current = setInterval(async () => {
      try {
        const status = await invoiceApi.getBulkStatus(id) as BulkBatchStatus;
        setBatchStatus(status);
        if (status.percentComplete >= 100 || ["COMPLETED", "FAILED"].includes(status.status)) {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }, 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Import CSV</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {!batchId ? (
            <>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
              )}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragging ? "border-green bg-green-light" : "border-border hover:border-green/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" className="mx-auto text-muted mb-3">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {file ? (
                  <p className="text-sm font-medium text-dark">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-dark">Drop your CSV file here</p>
                    <p className="text-xs text-muted mt-1">or click to browse — max 500 invoices, 5 MB</p>
                  </>
                )}
              </div>
              <div className="p-3 bg-surface rounded-lg border border-border">
                <p className="text-xs font-medium text-dark mb-1">Required CSV columns:</p>
                <p className="text-xs text-muted font-mono">
                  seller_tin, seller_name, buyer_name, issue_date, subtotal, vat_amount, total_amount
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-medium text-dark">Processing batch…</p>
              </div>
              {batchStatus && (
                <>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className="bg-green h-3 rounded-full transition-all duration-500"
                      style={{ width: `${batchStatus.percentComplete}%` }} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: "Total",    value: batchStatus.total,    color: "text-dark" },
                      { label: "Accepted", value: batchStatus.accepted, color: "text-green-600" },
                      { label: "Rejected", value: batchStatus.rejected, color: "text-red-600" },
                    ].map((s) => (
                      <div key={s.label} className="p-3 bg-surface rounded-lg border border-border">
                        <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-muted">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-sm text-muted">{batchStatus.percentComplete}% complete</p>
                  {batchStatus.percentComplete >= 100 && (
                    <div className="p-3 bg-green-light border border-green/20 rounded-lg text-sm text-green-700 text-center">
                      Batch completed! {batchStatus.accepted} invoices accepted.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>{batchId ? "Close" : "Cancel"}</Button>
          {!batchId && (
            <Button loading={uploading} disabled={!file} onClick={handleUpload}>
              Upload &amp; Import
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface InvoiceCounts {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  draft: number;
  overdue: number;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [counts, setCounts] = useState<InvoiceCounts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (activeTab === "PENDING") {
        params.status = "QUEUED,SUBMITTING,VALIDATING";
      } else if (activeTab === "OVERDUE") {
        params.isOverdue = "true";
      } else if (activeTab !== "ALL") {
        params.status = activeTab;
      }
      if (search) params.search = search;
      const res = await invoiceApi.list(params);
      setInvoices(res.data as Invoice[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, search]);

  useEffect(() => { load(); }, [load]);

  // Load counts for all tabs
  useEffect(() => {
    Promise.all([
      invoiceApi.list({ limit: 1 }),
      invoiceApi.list({ limit: 1, status: "ACCEPTED" }),
      invoiceApi.list({ limit: 1, status: "REJECTED,SUBMISSION_FAILED,DEAD_LETTERED,VALIDATION_FAILED" }),
      invoiceApi.list({ limit: 1, status: "QUEUED,SUBMITTING,VALIDATING" }),
      invoiceApi.list({ limit: 1, status: "DRAFT" }),
      invoiceApi.list({ limit: 1, isOverdue: "true" }),
    ]).then(([all, acc, rej, pend, draft, ov]) => {
      setCounts({
        total: all.total, accepted: acc.total, rejected: rej.total,
        pending: pend.total, draft: draft.total, overdue: ov.total,
      });
    }).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / 20);

  const TAB_COUNTS: Record<StatusTab, number> = {
    ALL:      counts?.total ?? 0,
    ACCEPTED: counts?.accepted ?? 0,
    PENDING:  counts?.pending ?? 0,
    REJECTED: counts?.rejected ?? 0,
    DRAFT:    counts?.draft ?? 0,
    OVERDUE:  counts?.overdue ?? 0,
  };

  return (
    <>
      <div className="bg-white border-b border-border px-6 py-5 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark">Invoices</h1>
          {counts && (
            <p className="text-sm text-muted mt-0.5">
              {counts.total} total · {counts.accepted} accepted · {counts.rejected} rejected · {counts.pending} pending
            </p>
          )}
        </div>
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant="secondary" onClick={() => setShowBulk(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" className="mr-1.5 inline">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import CSV
          </Button>
          <Link href="/invoices/new">
            <Button size="sm">+ Create invoice</Button>
          </Link>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* Filter tabs + search */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 border-b border-border">
            <div className="flex">
              {STATUS_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); setPage(1); }}
                  className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === key
                      ? "border-green text-green"
                      : "border-transparent text-muted hover:text-dark"
                  }`}
                >
                  {label}{counts ? ` (${TAB_COUNTS[key]})` : ""}
                </button>
              ))}
            </div>
            <div className="py-2 w-56">
              <Input
                placeholder="Search IRN, buyer…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="px-6 py-4 space-y-2">
              {[0,1,2,3,4,5].map(i => <SkeletonTableRow key={i} />)}
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" className="text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
              </div>
              <p className="text-muted text-sm">No invoices found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Invoice", "Buyer", "Date", "FIRS Status", "IRN", "Payment", "Amount", ""].map((col, i) => (
                      <th key={col + i}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i === 6 ? "text-right" : "text-left"}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}
                      className={`border-b border-border last:border-0 transition-colors ${
                        inv.isOverdue ? "bg-red-50/30 hover:bg-red-50/50" : "hover:bg-surface"
                      }`}>
                      {/* Invoice # */}
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/invoices/${inv.id}`}
                            className="text-sm font-mono text-green hover:underline">
                            {inv.id.slice(0, 8)}…
                          </Link>
                          {inv.isOverdue && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                              Overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted mt-0.5">{inv.invoiceType}</p>
                      </td>
                      {/* Buyer */}
                      <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                      {/* Date */}
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">{formatDate(inv.createdAt)}</td>
                      {/* FIRS Status */}
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {(inv.status ?? '').replace(/_/g, " ")}
                        </span>
                      </td>
                      {/* IRN / rejection reason */}
                      <td className="px-6 py-3">
                        {["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(inv.status) ? (
                          <span className="text-xs text-red-600 italic truncate block max-w-[140px]" title={(inv as any).rejectionCode ?? "Rejected"}>
                            {(inv as any).rejectionCode ?? "Rejected"}
                          </span>
                        ) : inv.firsConfirmedIrn ? (
                          <span className="text-xs font-mono text-green-700 truncate block max-w-[120px]">
                            {inv.firsConfirmedIrn.slice(0, 16)}…
                          </span>
                        ) : inv.platformIrn ? (
                          <span className="text-xs font-mono text-muted truncate block max-w-[120px]">
                            {inv.platformIrn.slice(0, 16)}…
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      {/* Payment */}
                      <td className="px-6 py-3">
                        {inv.paymentStatus ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[inv.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>
                            {inv.paymentStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      {/* Amount */}
                      <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                        {formatCurrency(inv.totalAmount, inv.currency)}
                      </td>
                      {/* Actions — continue editing DRAFT invoices */}
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        {inv.status === "DRAFT" && (
                          <button
                            onClick={() => router.push(`/invoices/new?id=${inv.id}`)}
                            className="text-xs font-medium text-green hover:text-green-dark hover:underline transition-colors"
                          >
                            Continue →
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Showing {invoices.length} of {total}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} />}
    </>
  );
}
