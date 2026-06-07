"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  buyer?: { email?: string; partyName?: string };
  totalAmount: number;
  amountPaid?: number;
  currency: string;
  status: string;
  invoiceType: string;
  firsConfirmedIrn?: string;
  paymentStatus?: string;
  isOverdue?: boolean;
  dueDate?: string;
  paymentDueDate?: string;
  createdAt: string;
}

interface IncomingInvoice {
  id: string;
  supplierName?: string;
  supplierEmail?: string;
  supplierTin?: string;
  platformIrn?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  totalAmount?: number;
  currency?: string;
  status: string;
  paymentStatus?: string;
  createdAt: string;
}

interface BulkBatchStatus {
  batchId: string;
  total: number;
  accepted: number;
  rejected: number;
  percentComplete: number;
  status: string;
}

// ── Combined status pill logic ────────────────────────────────────────────────

function sentStatusPill(inv: Invoice) {
  if (inv.paymentStatus === "PAID") {
    return { label: "Paid", cls: "bg-green-100 text-green-800" };
  }
  if (inv.paymentStatus === "PARTIAL") {
    return { label: "Part paid", cls: "bg-teal-50 text-teal-700" };
  }
  if (inv.isOverdue) {
    return { label: "Overdue", cls: "bg-red-100 text-red-800" };
  }
  if (inv.status === "ACCEPTED") {
    return { label: "Accepted", cls: "bg-green-50 text-green-700" };
  }
  if (inv.status === "SUBMITTING") {
    return { label: "Submitting", cls: "bg-blue-100 text-blue-800" };
  }
  if (inv.status === "QUEUED" || inv.status === "VALIDATING") {
    return { label: "Pending", cls: "bg-amber-100 text-amber-800" };
  }
  if (["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(inv.status)) {
    return { label: "Rejected", cls: "bg-red-100 text-red-800" };
  }
  if (inv.status === "DRAFT") {
    return { label: "Draft", cls: "bg-gray-100 text-gray-600" };
  }
  if (inv.status === "CANCELLED" || inv.status === "CANCELLATION_REQUESTED") {
    return { label: "Cancelled", cls: "bg-gray-100 text-gray-500" };
  }
  return { label: inv.status.replace(/_/g, " "), cls: "bg-gray-100 text-gray-600" };
}

function receivedStatusPill(inv: IncomingInvoice) {
  if (inv.paymentStatus === "PAID" || inv.status === "PAID") {
    return { label: "Paid", cls: "bg-emerald-100 text-emerald-800" };
  }
  if (inv.status === "APPROVED") {
    return { label: "Approved", cls: "bg-green-50 text-green-700" };
  }
  if (inv.status === "VALIDATED") {
    return { label: "Validated", cls: "bg-blue-100 text-blue-800" };
  }
  if (inv.status === "RECEIVED") {
    return { label: "To review", cls: "bg-amber-100 text-amber-800" };
  }
  if (inv.status === "REJECTED") {
    return { label: "Rejected", cls: "bg-red-100 text-red-800" };
  }
  return { label: inv.status, cls: "bg-gray-100 text-gray-600" };
}

// ── Due date cell ─────────────────────────────────────────────────────────────

function DueDateCell({ dueDate, isOverdue }: { dueDate?: string; isOverdue?: boolean }) {
  if (!dueDate) return <span className="text-sm text-muted">—</span>;

  const due = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000);

  if (isOverdue || diffDays < 0) {
    const days = Math.abs(diffDays);
    return (
      <div>
        <span className="text-sm text-red-600 font-medium">{formatDate(dueDate)}</span>
        <p className="text-xs text-red-500 mt-0.5">{days} day{days !== 1 ? "s" : ""} ago</p>
      </div>
    );
  }
  if (diffDays === 0) {
    return (
      <div>
        <span className="text-sm text-amber-600 font-medium">{formatDate(dueDate)}</span>
        <p className="text-xs text-amber-500 mt-0.5">Due today</p>
      </div>
    );
  }
  return <span className="text-sm text-dark">{formatDate(dueDate)}</span>;
}

// ── Amount cell ───────────────────────────────────────────────────────────────

function AmountCell({ inv }: { inv: Invoice }) {
  const paid = inv.amountPaid ?? 0;
  const isPart = inv.paymentStatus === "PARTIAL" && paid > 0;
  const outstanding = Math.max(0, inv.totalAmount - paid);

  function shortK(n: number) {
    if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
    return formatCurrency(n, inv.currency);
  }

  return (
    <div className="text-right">
      <p className="text-sm font-semibold text-dark">{formatCurrency(inv.totalAmount, inv.currency)}</p>
      {isPart && (
        <p className="text-xs text-muted mt-0.5">{shortK(paid)} paid · {shortK(outstanding)} due</p>
      )}
    </div>
  );
}

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
        intervalRef.current = setInterval(async () => {
          try {
            const status = await invoiceApi.getBulkStatus(res.batchId!) as BulkBatchStatus;
            setBatchStatus(status);
            if (status.percentComplete >= 100 || ["COMPLETED", "FAILED"].includes(status.status)) {
              if (intervalRef.current) clearInterval(intervalRef.current);
            }
          } catch {
            if (intervalRef.current) clearInterval(intervalRef.current);
          }
        }, 2000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
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
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
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
          {!batchId && <Button loading={uploading} disabled={!file} onClick={handleUpload}>Upload &amp; Import</Button>}
        </div>
      </div>
    </div>
  );
}

// ── Sent panel ────────────────────────────────────────────────────────────────

type SentTab = "ALL" | "ATTENTION" | "ACCEPTED" | "PAID";

const SENT_TABS: { key: SentTab; label: string }[] = [
  { key: "ALL",       label: "All" },
  { key: "ATTENTION", label: "Needs attention" },
  { key: "ACCEPTED",  label: "Accepted" },
  { key: "PAID",      label: "Paid" },
];

interface DashboardStats {
  total: number;
  accepted: number;
  rejectedAll?: number;
  rejected?: number;
  pending?: number;
  firsAwaiting?: number;
  draft?: number;
  overdue?: number;
  overdueCount?: number;
}

function SentPanel() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<SentTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (activeTab === "ACCEPTED") params.status = "ACCEPTED";
      else if (activeTab === "PAID") params.paymentStatus = "PAID";
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

  // "Needs attention" — one call per status (backend only accepts a single status value)
  const loadAttention = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const base: Record<string, string | number> = { page, limit: 20 };
      if (search) base.search = search;

      const [rejRes, sfRes, dlRes, vfRes, overdueRes] = await Promise.all([
        invoiceApi.list({ ...base, status: "REJECTED" }),
        invoiceApi.list({ ...base, status: "SUBMISSION_FAILED" }),
        invoiceApi.list({ ...base, status: "DEAD_LETTERED" }),
        invoiceApi.list({ ...base, status: "VALIDATION_FAILED" }),
        invoiceApi.list({ ...base, isOverdue: "true" }),
      ]);

      const seen = new Set<string>();
      const merged: Invoice[] = [];
      for (const inv of [
        ...(rejRes.data as Invoice[]),
        ...(sfRes.data as Invoice[]),
        ...(dlRes.data as Invoice[]),
        ...(vfRes.data as Invoice[]),
        ...(overdueRes.data as Invoice[]),
      ]) {
        if (!seen.has(inv.id)) { seen.add(inv.id); merged.push(inv); }
      }
      setInvoices(merged);
      setTotal(merged.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (activeTab === "ATTENTION") loadAttention();
    else load();
  }, [activeTab, load, loadAttention]);

  useEffect(() => {
    invoiceApi.stats().then((s: any) => setStats(s)).catch(() => {});
  }, []);

  const attentionCount = stats
    ? (stats.rejectedAll ?? stats.rejected ?? 0) + (stats.overdue ?? stats.overdueCount ?? 0) + (stats.firsAwaiting ?? stats.pending ?? 0)
    : 0;

  const tabCounts: Record<SentTab, number | null> = {
    ALL:       stats?.total ?? null,
    ATTENTION: attentionCount || null,
    ACCEPTED:  stats?.accepted ?? null,
    PAID:      null,
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="p-6 space-y-4">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

      {/* Attention banner */}
      {attentionCount > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => { setActiveTab("ATTENTION"); setPage(1); }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="font-semibold text-amber-800">{attentionCount} invoice{attentionCount !== 1 ? "s" : ""} need attention</span>
          <span className="text-amber-600">→</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {/* Tab bar + search */}
        <div className="flex items-center justify-between px-4 border-b border-border">
          <div className="flex">
            {SENT_TABS.map(({ key, label }) => {
              const count = tabCounts[key];
              return (
                <button key={key}
                  onClick={() => { setActiveTab(key); setPage(1); }}
                  className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === key ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                  }`}
                >
                  {label}
                  {count !== null && count > 0 && (
                    <span className={`inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5 py-0.5 leading-none ${
                      key === "ATTENTION" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="py-2 w-52">
            <Input placeholder="Search customer, IRN…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="px-6 py-4 space-y-2">
            {[0,1,2,3,4,5].map(i => <SkeletonTableRow key={i} />)}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-14 text-center">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            {activeTab === "ALL" && (stats?.total ?? 0) === 0 ? (
              <>
                <p className="font-semibold text-dark mb-1">No invoices yet</p>
                <p className="text-sm text-muted mb-5">Create your first invoice and submit it to FIRS in minutes.</p>
                <div className="flex items-center justify-center gap-3">
                  <Link href="/invoices/new"><Button size="sm">Create invoice →</Button></Link>
                </div>
                <p className="text-xs text-muted mt-4">
                  Not sure what to include?{" "}
                  <button onClick={() => setShowSample(true)} className="text-green hover:underline font-medium">
                    View a sample invoice →
                  </button>
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">No invoices found.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Invoice</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden sm:table-cell">Due date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Amount</th>
                  <th className="px-5 py-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const pill = sentStatusPill(inv);
                  const dueDate = inv.paymentDueDate ?? inv.dueDate;
                  const buyerEmail = inv.buyer?.email;
                  return (
                    <tr key={inv.id}
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                      className="border-b border-border last:border-0 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      {/* Invoice */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-dark leading-tight">{formatInvoiceNumber(inv)}</p>
                        <p className="text-xs text-muted mt-0.5">{formatDate(inv.createdAt)}</p>
                      </td>
                      {/* Customer */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-dark truncate max-w-[160px]" title={inv.buyerName}>
                          {inv.buyerName || "—"}
                        </p>
                        {buyerEmail && (
                          <p className="text-xs text-muted truncate max-w-[160px] mt-0.5">{buyerEmail}</p>
                        )}
                      </td>
                      {/* Due date */}
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <DueDateCell dueDate={dueDate} isOverdue={inv.isOverdue} />
                      </td>
                      {/* Status pill */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${pill.cls}`}>
                          {pill.label}
                        </span>
                      </td>
                      {/* Amount */}
                      <td className="px-5 py-3.5">
                        <AmountCell inv={inv} />
                      </td>
                      {/* Actions */}
                      <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-0.5 justify-end">
                          {inv.status === "ACCEPTED" && <CopyPayLinkButton invoiceId={inv.id} />}
                          <DuplicateButton invoiceId={inv.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} />}
      {showSample && <SampleInvoiceModal onClose={() => setShowSample(false)} />}
    </div>
  );
}

// ── Received panel ────────────────────────────────────────────────────────────

type ReceivedTab = "ALL" | "TO_REVIEW" | "APPROVED" | "PAID";

const RECEIVED_TABS: { key: ReceivedTab; label: string }[] = [
  { key: "ALL",       label: "All" },
  { key: "TO_REVIEW", label: "To review" },
  { key: "APPROVED",  label: "Approved" },
  { key: "PAID",      label: "Paid" },
];

function ReceivedPanel() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<ReceivedTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toReviewCount, setToReviewCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Parameters<typeof incomingInvoiceApi.list>[0] = { page, limit: 20 };
      if (activeTab === "TO_REVIEW") params.status = "RECEIVED";
      else if (activeTab === "APPROVED") params.status = "APPROVED";
      else if (activeTab === "PAID") params.status = "PAID";
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
    incomingInvoiceApi.stats().then((s: any) => setToReviewCount(s.received ?? 0)).catch(() => {});
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
      incomingInvoiceApi.stats().then((s: any) => setToReviewCount(s.received ?? 0)).catch(() => {});
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
        {/* Tab bar */}
        <div className="flex items-center justify-between px-4 border-b border-border">
          <div className="flex">
            {RECEIVED_TABS.map(({ key, label }) => (
              <button key={key}
                onClick={() => { setActiveTab(key); setPage(1); }}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === key ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                }`}
              >
                {label}
                {key === "TO_REVIEW" && toReviewCount !== null && toReviewCount > 0 && (
                  <span className="inline-flex items-center justify-center text-xs font-bold rounded-full px-1.5 py-0.5 leading-none bg-red-100 text-red-700">
                    {toReviewCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="px-6 py-4 space-y-2">
            {[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-14 text-center">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
              </svg>
            </div>
            <p className="font-semibold text-dark mb-1">No received invoices</p>
            <p className="text-sm text-muted mb-5">Add invoices you receive from suppliers to track what you owe.</p>
            <Link href="/incoming-invoices">
              <Button size="sm" variant="secondary">Add invoice →</Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Invoice</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Supplier</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden sm:table-cell">Due date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Amount</th>
                  <th className="px-5 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const pill = receivedStatusPill(inv);
                  return (
                    <tr key={inv.id}
                      onClick={() => router.push(`/incoming-invoices/${inv.id}`)}
                      className="border-b border-border last:border-0 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      {/* Invoice */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-dark leading-tight">
                          {formatInvoiceNumber({ platformIrn: inv.invoiceNumber ?? inv.platformIrn, id: inv.id })}
                        </p>
                        <p className="text-xs text-muted mt-0.5">{formatDate(inv.createdAt)}</p>
                      </td>
                      {/* Supplier */}
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-dark truncate max-w-[160px]" title={inv.supplierName}>
                          {inv.supplierName ?? "—"}
                        </p>
                        {inv.supplierEmail && (
                          <p className="text-xs text-muted truncate max-w-[160px] mt-0.5">{inv.supplierEmail}</p>
                        )}
                      </td>
                      {/* Due date */}
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <DueDateCell dueDate={inv.dueDate} />
                      </td>
                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${pill.cls}`}>
                          {pill.label}
                        </span>
                      </td>
                      {/* Amount */}
                      <td className="px-5 py-3.5 text-right">
                        <p className="text-sm font-semibold text-dark">
                          {inv.totalAmount != null ? formatCurrency(inv.totalAmount, inv.currency ?? "NGN") : "—"}
                        </p>
                      </td>
                      {/* Next action only */}
                      <td className="px-3 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {inv.status === "RECEIVED" && (
                          <button
                            disabled={actionLoading === inv.id + "validate"}
                            onClick={(e) => doAction(inv.id, "validate", e)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            Validate
                          </button>
                        )}
                        {inv.status === "VALIDATED" && (
                          <button
                            disabled={actionLoading === inv.id + "approve"}
                            onClick={(e) => doAction(inv.id, "approve", e)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {inv.status === "APPROVED" && (
                          <Link
                            href={`/incoming-invoices/${inv.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                          >
                            Pay →
                          </Link>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Showing {invoices.length} of {total}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
            <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
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
  const [sentTotal, setSentTotal] = useState<number | null>(null);
  const [receivedTotal, setReceivedTotal] = useState<number | null>(null);

  useEffect(() => {
    invoiceApi.stats().then((s: any) => setSentTotal(s.total ?? 0)).catch(() => {});
    incomingInvoiceApi.stats().then((s: any) => setReceivedTotal(s.total ?? 0)).catch(() => {});
  }, []);

  function setTopTab(t: "sent" | "received") {
    router.push(`/invoices?tab=${t}`);
  }

  return (
    <>
      <div className="bg-white border-b border-border px-6 pt-5 pb-0 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark">Invoices</h1>
          <p className="text-sm text-muted mt-0.5 mb-3">
            {topTab === "sent" ? "Invoices you have sent to buyers" : "Invoices received from suppliers"}
          </p>
          <div className="flex gap-0 -mb-px">
            {(["sent", "received"] as const).map((t) => {
              const count = t === "sent" ? sentTotal : receivedTotal;
              return (
                <button
                  key={t}
                  onClick={() => setTopTab(t)}
                  className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                    topTab === t ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                  }`}
                >
                  {t === "sent" ? "Sent" : "Received"}
                  {count !== null && (
                    <span className="text-xs font-medium text-muted">({count})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          {topTab === "sent" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => document.dispatchEvent(new CustomEvent("open-bulk"))}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5 inline">
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
