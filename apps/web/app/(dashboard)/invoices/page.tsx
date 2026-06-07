"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { invoiceApi, incomingInvoiceApi, invalidateCache } from "@/lib/api";
import { formatCurrency, formatDate, formatInvoiceNumber } from "@/lib/utils";
import { SampleInvoiceModal } from "@/components/invoice/SampleInvoiceModal";

// ── Copy pay-link button ──────────────────────────────────────────────────────

function CopyPayLinkButton({ invoiceId }: { invoiceId: string }) {
  const [copied, setCopied] = useState(false);
  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/pay/${invoiceId}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      title={copied ? "Copied!" : "Copy payment link"}
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-green-50 text-muted hover:text-green transition-colors"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        /* Link2 — chain link icon, clearly represents a URL/link */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
          <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      )}
    </button>
  );
}

function DuplicateButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function handleDuplicate(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await invoiceApi.duplicate(invoiceId) as { id: string };
      router.push(`/invoices/${res.id}?duplicated=true`);
    } catch {
      alert("Failed to duplicate invoice.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={handleDuplicate}
      disabled={loading}
      title="Duplicate invoice"
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-amber-50 text-muted hover:text-amber-600 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
        </svg>
      ) : (
        /* Files icon — two overlapping document pages, clearly "duplicate a file" */
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7a2 2 0 0 1 2-2h9l5 5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
          <path d="M14 2v5h5"/>
          <path d="M7 13h6"/>
          <path d="M7 17h4"/>
        </svg>
      )}
    </button>
  );
}

async function sendReminder(invoiceId: string, e: React.MouseEvent) {
  e.stopPropagation();
  try {
    await invoiceApi.sendReminder(invoiceId);
    alert("Payment reminder sent.");
  } catch {
    alert("Failed to send reminder.");
  }
}

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

interface IncomingInvoice {
  id: string;
  supplierName?: string;
  supplierTin?: string;
  platformIrn?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  vatAmount?: number;
  currency?: string;
  status: string;
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

const INCOMING_STATUS_TABS = [
  { key: "ALL",       label: "All" },
  { key: "RECEIVED",  label: "Received" },
  { key: "VALIDATED", label: "Validated" },
  { key: "APPROVED",  label: "Approved" },
  { key: "PAID",      label: "Paid" },
  { key: "REJECTED",  label: "Rejected" },
] as const;

type IncomingStatusTab = typeof INCOMING_STATUS_TABS[number]["key"];

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

const INCOMING_STATUS_COLORS: Record<string, string> = {
  RECEIVED:  "bg-gray-100 text-gray-600",
  VALIDATED: "bg-blue-50 text-blue-700",
  APPROVED:  "bg-green-50 text-green-700",
  PAID:      "bg-emerald-100 text-emerald-800",
  REJECTED:  "bg-red-50 text-red-600",
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
                  strokeWidth="1.5" className="text-muted mx-auto mb-3">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="text-sm text-muted">{file ? file.name : "Drop a CSV file here or click to browse"}</p>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {batchStatus && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Total",    value: batchStatus.total,    color: "text-dark" },
                      { label: "Accepted", value: batchStatus.accepted, color: "text-green-700" },
                      { label: "Rejected", value: batchStatus.rejected, color: "text-red-600" },
                    ].map((s) => (
                      <div key={s.label} className="text-center p-3 bg-surface rounded-lg">
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

// ── Sent invoices panel ───────────────────────────────────────────────────────

interface InvoiceCounts {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  draft: number;
  overdue: number;
}

function SentPanel() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [counts, setCounts] = useState<InvoiceCounts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (activeTab === "PENDING") params.status = "QUEUED,SUBMITTING,VALIDATING";
      else if (activeTab === "OVERDUE") params.isOverdue = "true";
      else if (activeTab !== "ALL") params.status = activeTab;
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

  useEffect(() => {
    invoiceApi.stats().then((s: any) => {
      setCounts({
        total:    s.total    ?? 0,
        accepted: s.accepted ?? 0,
        rejected: s.rejectedAll ?? s.rejected ?? 0,
        pending:  s.firsAwaiting ?? s.pending ?? 0,
        draft:    s.draft    ?? 0,
        overdue:  s.overdue  ?? s.overdueCount ?? 0,
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
    <div className="p-6 space-y-4">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b border-border">
          <div className="flex">
            {STATUS_TABS.map(({ key, label }) => (
              <button key={key}
                onClick={() => { setActiveTab(key); setPage(1); }}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                }`}
              >
                {label}{counts ? ` (${TAB_COUNTS[key]})` : ""}
              </button>
            ))}
          </div>
          <div className="py-2 w-56">
            <Input placeholder="Search IRN, buyer…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

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
            {activeTab === "ALL" && counts?.total === 0 ? (
              <>
                <p className="text-dark font-semibold mb-1">No invoices yet</p>
                <p className="text-muted text-sm mb-4">Create your first FIRS-compliant invoice</p>
                <Link href="/invoices/new">
                  <Button size="sm">Create invoice</Button>
                </Link>
                <p className="text-muted text-xs mt-4">
                  Not sure what to include?{" "}
                  <button
                    onClick={() => setShowSample(true)}
                    className="text-green hover:underline font-medium"
                  >
                    View a sample invoice →
                  </button>
                </p>
              </>
            ) : (
              <p className="text-muted text-sm">No invoices found.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Invoice", "Buyer", "Date", "FIRS Status", "IRN / Ref", "Payment", "Amount", ""].map((col, i) => (
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
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className={`border-b border-border last:border-0 cursor-pointer transition-colors ${
                      inv.isOverdue ? "bg-red-50/30 hover:bg-red-50/60" : "hover:bg-surface"
                    }`}
                  >
                    {/* Invoice # */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-dark">
                          {formatInvoiceNumber(inv)}
                        </span>
                        {inv.isOverdue && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">Overdue</span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5">{formatDate(inv.createdAt)}</p>
                    </td>
                    {/* Buyer */}
                    <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                    {/* Date — now shown under invoice number; this col = invoice type */}
                    <td className="px-6 py-3 text-xs text-muted">{inv.invoiceType?.replace(/_/g, " ") ?? "—"}</td>
                    {/* FIRS Status */}
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {(inv.status ?? '').replace(/_/g, " ")}
                      </span>
                    </td>
                    {/* IRN / rejection */}
                    <td className="px-6 py-3">
                      {["REJECTED","SUBMISSION_FAILED","DEAD_LETTERED","VALIDATION_FAILED"].includes(inv.status) ? (
                        <span className="text-xs text-red-600 italic font-mono">{inv.rejectionCode ?? "Rejected"}</span>
                      ) : (inv.firsConfirmedIrn ?? inv.platformIrn) ? (
                        <span className="text-xs font-mono text-muted truncate block max-w-[130px]"
                          title={inv.firsConfirmedIrn ?? inv.platformIrn}>
                          {(inv.firsConfirmedIrn ?? inv.platformIrn)!.slice(0, 16)}…
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
                    {/* Actions */}
                    <td className="px-6 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1 justify-end">
                        {inv.status === "ACCEPTED" && <CopyPayLinkButton invoiceId={inv.id} />}
                        {inv.status === "ACCEPTED" && <DuplicateButton invoiceId={inv.id} />}
                        {inv.status === "DRAFT" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); router.push(`/invoices/new?id=${inv.id}`); }}
                            className="text-xs font-medium text-green hover:text-green-dark hover:underline transition-colors"
                          >
                            Continue →
                          </button>
                        )}
                        {inv.isOverdue && inv.status === "ACCEPTED" && (
                          <button
                            onClick={(e) => sendReminder(inv.id, e)}
                            className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline transition-colors ml-1"
                          >
                            Send reminder
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} />}
      {showSample && <SampleInvoiceModal onClose={() => setShowSample(false)} />}
    </div>
  );
}

// ── Received invoices panel ───────────────────────────────────────────────────

function ReceivedPanel() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<IncomingStatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [receivedCount, setReceivedCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Parameters<typeof incomingInvoiceApi.list>[0] = { page, limit: 20 };
      if (activeTab !== "ALL") params.status = activeTab;
      const res = await incomingInvoiceApi.list(params);
      setInvoices(res.data as IncomingInvoice[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load received invoices");
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    incomingInvoiceApi.stats().then((s) => setReceivedCount(s.received ?? 0)).catch(() => {});
  }, []);

  async function doAction(id: string, action: "validate" | "approve" | "reject", e: React.MouseEvent) {
    e.stopPropagation();
    setActionLoading(id + action);
    try {
      if (action === "validate") await incomingInvoiceApi.validate(id);
      else if (action === "approve") await incomingInvoiceApi.approve(id);
      else await incomingInvoiceApi.reject(id, "Rejected by reviewer");
      invalidateCache('/v1/incoming-invoices/stats');
      await load();
      incomingInvoiceApi.stats().then((s) => setReceivedCount(s.received ?? 0)).catch(() => {});
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-4">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b border-border">
          <div className="flex">
            {INCOMING_STATUS_TABS.map(({ key, label }) => (
              <button key={key}
                onClick={() => { setActiveTab(key); setPage(1); }}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                }`}
              >
                {label}
                {key === "RECEIVED" && receivedCount !== null && receivedCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5 py-0.5 leading-none bg-amber-100 text-amber-700">
                    {receivedCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-4 space-y-2">
            {[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" className="text-muted">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              </svg>
            </div>
            <p className="text-muted text-sm mb-3">No received invoices yet.</p>
            <Link href="/incoming-invoices">
              <Button size="sm" variant="secondary">View in full →</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Invoice #", "Supplier", "Date", "Due", "Amount", "VAT", "Status", "Actions"].map((col, i) => (
                    <th key={col + i}
                      className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i >= 4 && i <= 5 ? "text-right" : "text-left"}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}
                    onClick={() => router.push(`/incoming-invoices/${inv.id}`)}
                    className="border-b border-border last:border-0 cursor-pointer hover:bg-surface transition-colors"
                  >
                    <td className="px-6 py-3">
                      <span className="text-sm font-semibold text-dark">
                        {formatInvoiceNumber({ platformIrn: inv.platformIrn, id: inv.id })}
                      </span>
                      <p className="text-xs text-muted mt-0.5">{formatDate(inv.createdAt)}</p>
                    </td>
                    <td className="px-6 py-3 text-sm text-dark">{inv.supplierName ?? "—"}</td>
                    <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                      {inv.issueDate ? formatDate(inv.issueDate) : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                      {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                      {inv.totalAmount != null ? formatCurrency(inv.totalAmount, inv.currency ?? "NGN") : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm text-muted text-right">
                      {inv.vatAmount != null ? formatCurrency(inv.vatAmount, inv.currency ?? "NGN") : "—"}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${INCOMING_STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1.5">
                        {inv.status === "RECEIVED" && (
                          <button
                            disabled={actionLoading === inv.id + "validate"}
                            onClick={(e) => doAction(inv.id, "validate", e)}
                            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                          >
                            Validate
                          </button>
                        )}
                        {inv.status === "VALIDATED" && (
                          <>
                            <button
                              disabled={actionLoading === inv.id + "approve"}
                              onClick={(e) => doAction(inv.id, "approve", e)}
                              className="text-xs font-medium text-green hover:underline disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              disabled={actionLoading === inv.id + "reject"}
                              onClick={(e) => doAction(inv.id, "reject", e)}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {inv.status === "APPROVED" && (
                          <Link
                            href={`/incoming-invoices/${inv.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-green hover:underline"
                          >
                            Mark paid →
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const topTab = (searchParams.get("tab") ?? "sent") as "sent" | "received";
  const [sentPending, setSentPending] = useState<number | null>(null);
  const [receivedCount, setReceivedCount] = useState<number | null>(null);

  useEffect(() => {
    invoiceApi.stats().then((s: any) => setSentPending(s.firsAwaiting ?? s.pending ?? 0)).catch(() => {});
    incomingInvoiceApi.stats().then((s: any) => setReceivedCount(s.received ?? 0)).catch(() => {});
  }, []);

  function setTopTab(t: "sent" | "received") {
    router.push(`/invoices?tab=${t}`);
  }

  const headerTitle = topTab === "sent" ? "Sent Invoices" : "Received Invoices";
  const headerSub   = topTab === "sent"
    ? "Invoices you have sent to buyers"
    : "Invoices received from suppliers";

  return (
    <>
      <div className="bg-white border-b border-border px-6 pt-5 pb-0 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark">{headerTitle}</h1>
          <p className="text-sm text-muted mt-0.5 mb-3">{headerSub}</p>
          {/* Top-level Sent / Received tabs */}
          <div className="flex gap-0 -mb-px">
            {(["sent", "received"] as const).map((t) => {
              const badge = t === "sent" ? sentPending : receivedCount;
              return (
                <button
                  key={t}
                  onClick={() => setTopTab(t)}
                  className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                    topTab === t
                      ? "border-green text-green"
                      : "border-transparent text-muted hover:text-dark"
                  }`}
                >
                  {t === "sent" ? "Sent" : "Received"}
                  {badge !== null && badge > 0 && (
                    <span className={`ml-1.5 inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5 py-0.5 leading-none ${
                      t === "received" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"
                    }`}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          {topTab === "sent" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => {
                const panel = document.getElementById("bulk-trigger");
                panel?.click();
              }}>
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
            </>
          ) : (
            <Link href="/incoming-invoices">
              <Button size="sm" variant="secondary">View all received →</Button>
            </Link>
          )}
        </div>
      </div>

      {topTab === "sent" ? <SentPanel /> : <ReceivedPanel />}
    </>
  );
}
