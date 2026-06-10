"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDate, formatPaymentMethod } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_TABS = [
  { key: "ALL",     label: "All" },
  { key: "UNPAID",  label: "Unpaid" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "PAID",    label: "Paid" },
  { key: "PARTIAL", label: "Partial" },
] as const;

type PaymentTab = typeof PAYMENT_TABS[number]["key"];

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

const PROVIDER_DOTS: Record<string, string> = {
  BANK_TRANSFER: "bg-blue-500",
  PAYSTACK:      "bg-green-500",
  FLUTTERWAVE:   "bg-orange-500",
  MANUAL:        "bg-gray-400",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  amountPaid?: number;
  currency: string;
  status: string;
  paymentStatus?: string;
  paymentDueDate?: string;
  paidAt?: string;
  isOverdue?: boolean;
  hasCreditNote?: boolean;
  netAmount?: number;
  createdAt: string;
}

interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
}

interface PaymentStats {
  totalBilled: number;
  totalCollected: number;
  collectionRate: number;
  paidInFull: number;
  partiallyPaid: number;
  unpaidNotDue: number;
  overdue: number;
  providerBreakdown: Array<{ provider: string; total: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function effectiveAmount(inv: InvoiceRow) {
  return inv.hasCreditNote
    ? Math.max(0, inv.netAmount ?? Number(inv.totalAmount ?? 0))
    : Number(inv.totalAmount ?? 0);
}

function calcRemaining(inv: InvoiceRow) {
  if (inv.paymentStatus === "PAID") return 0;
  return Math.max(0, effectiveAmount(inv) - Number(inv.amountPaid ?? 0));
}

function isRowOverdue(inv: InvoiceRow) {
  if (inv.paymentStatus === "PAID" || calcRemaining(inv) === 0) return false;
  if (inv.isOverdue) return true;
  if (!inv.paymentDueDate) return false;
  return new Date(inv.paymentDueDate) < new Date(new Date().toDateString());
}

// ── FIRS status pill ──────────────────────────────────────────────────────────

function FirsStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACCEPTED:               { label: "Accepted",   cls: "bg-green-50 text-green-700" },
    DRAFT:                  { label: "Draft",      cls: "bg-gray-100 text-gray-500" },
    REJECTED:               { label: "Rejected",   cls: "bg-red-50 text-red-600" },
    VALIDATION_FAILED:      { label: "Rejected",   cls: "bg-red-50 text-red-600" },
    SUBMISSION_FAILED:      { label: "Rejected",   cls: "bg-red-50 text-red-600" },
    VALIDATING:             { label: "Pending",    cls: "bg-amber-50 text-amber-700" },
    QUEUED:                 { label: "Pending",    cls: "bg-amber-50 text-amber-700" },
    SUBMITTING:             { label: "Pending",    cls: "bg-amber-50 text-amber-700" },
    DEAD_LETTERED:          { label: "Failed",     cls: "bg-gray-100 text-gray-500" },
    CANCELLED:              { label: "Cancelled",  cls: "bg-gray-100 text-gray-500" },
    CANCELLATION_REQUESTED: { label: "Cancelling", cls: "bg-gray-100 text-gray-500" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ── Smart payment status cell ─────────────────────────────────────────────────

function PaymentStatusCell({ inv }: { inv: InvoiceRow }) {
  const remaining = calcRemaining(inv);

  if (inv.paymentStatus === "PAID" || remaining === 0) {
    return (
      <div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
          Paid
        </span>
        {inv.paidAt && (
          <p className="text-xs text-muted mt-0.5">{formatDate(inv.paidAt)}</p>
        )}
      </div>
    );
  }

  if (inv.paymentStatus === "PARTIAL" || Number(inv.amountPaid ?? 0) > 0) {
    return (
      <div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
          Partial
        </span>
        <p className="text-xs text-muted mt-0.5">{formatCurrency(remaining, inv.currency)} remaining</p>
      </div>
    );
  }

  if (inv.status === "ACCEPTED") {
    if (inv.paymentDueDate) {
      const due = new Date(inv.paymentDueDate);
      const today = new Date(new Date().toDateString());
      if (inv.isOverdue || due < today) {
        const days = Math.max(1, Math.round((today.getTime() - due.getTime()) / 86400000));
        return <span className="text-sm text-red-600 font-medium">{days} day{days !== 1 ? "s" : ""} overdue</span>;
      }
      return <span className="text-sm text-muted">Due {formatDate(inv.paymentDueDate)}</span>;
    }
    if (inv.isOverdue) {
      return <span className="text-sm text-red-600 font-medium">Overdue</span>;
    }
  } else if (inv.paymentDueDate) {
    const due = new Date(inv.paymentDueDate);
    const today = new Date(new Date().toDateString());
    if (due >= today) {
      return <span className="text-sm text-muted">Due {formatDate(inv.paymentDueDate)}</span>;
    }
  }

  return null;
}

// ── Actions cell ──────────────────────────────────────────────────────────────

function ActionsCell({
  inv,
  remainingAmount,
  onRecord,
}: {
  inv: InvoiceRow;
  remainingAmount: number;
  onRecord: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const canRecord =
    inv.status === "ACCEPTED" &&
    inv.paymentStatus !== "PAID" &&
    remainingAmount > 0;

  function copyPaymentLink() {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${inv.id}`).catch(() => {});
    setOpen(false);
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canRecord && (
        <button
          onClick={onRecord}
          className="text-xs font-medium text-dark border border-border rounded-md px-2.5 py-1.5 hover:bg-surface transition-colors whitespace-nowrap"
        >
          Record payment
        </button>
      )}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1.5 rounded-md text-muted hover:text-dark hover:bg-surface transition-colors"
          aria-label="More actions"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg border border-border shadow-lg z-20 py-1">
            <Link
              href={`/invoices/${inv.id}`}
              className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-dark hover:bg-surface transition-colors"
              onClick={() => setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              View invoice
            </Link>
            <button
              onClick={copyPaymentLink}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-dark hover:bg-surface transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Copy payment link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Per-tab empty state ───────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: PaymentTab }) {
  const states: Record<PaymentTab, { check: boolean; title: string; body: string }> = {
    ALL:     { check: false, title: "No invoices found",    body: "No invoices match your search." },
    UNPAID:  { check: true,  title: "All invoices paid",    body: "No unpaid invoices at the moment." },
    OVERDUE: { check: true,  title: "Nothing overdue",      body: "All accepted invoices are within their payment terms." },
    PAID:    { check: false, title: "No paid invoices yet", body: "Payments you record will appear here." },
    PARTIAL: { check: false, title: "No partial payments",  body: "Invoices with partial payments will appear here." },
  };
  const { check, title, body } = states[tab];
  return (
    <div className="p-12 text-center">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${check ? "bg-green-50" : "bg-surface"}`}>
        {check ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
        )}
      </div>
      <p className="font-medium text-dark text-sm mb-1">{title}</p>
      <p className="text-muted text-sm">{body}</p>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<PaymentTab>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [recordFor, setRecordFor] = useState<InvoiceRow | null>(null);
  const [form, setForm] = useState<RecordPaymentForm>({
    amount: "", provider: "MANUAL", reference: "",
    paidAt: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (search) params.search = search;
      if (activeTab === "PAID")    params.paymentStatus = "PAID";
      else if (activeTab === "UNPAID")  params.paymentStatus = "UNPAID";
      else if (activeTab === "OVERDUE") params.isOverdue = "true";
      else if (activeTab === "PARTIAL") params.paymentStatus = "PARTIAL";
      const res = await invoiceApi.list(params);
      setInvoices(res.data as InvoiceRow[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setStatsLoading(true);
    invoiceApi.paymentStats()
      .then((s) => setPaymentStats(s as PaymentStats))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const totalBilled = invoices.reduce((s, i) => s + effectiveAmount(i), 0);
  const totalCollected = invoices.reduce((s, i) => s + Number(i.amountPaid ?? 0), 0);
  const totalOutstanding = invoices.reduce((s, i) => {
    if (i.paymentStatus === "PAID") return s;
    return s + Math.max(0, effectiveAmount(i) - Number(i.amountPaid ?? 0));
  }, 0);
  const overdueCount = invoices.filter(isRowOverdue).length;
  const overdueAmount = invoices
    .filter(isRowOverdue)
    .reduce((s, i) => s + calcRemaining(i), 0);

  async function handleRecordPayment() {
    if (!recordFor) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      await invoiceApi.recordPayment(recordFor.id, {
        amount: parseFloat(form.amount),
        provider: form.provider,
        reference: form.reference,
        paidAt: new Date(form.paidAt).toISOString(),
        notes: form.notes || undefined,
      });
      setRecordFor(null);
      load();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.ceil(total / 20);
  const collectionRate = paymentStats?.collectionRate ?? 0;

  return (
    <>
      <Topbar title="Payments" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        <div className="flex gap-6 items-start">
          {/* ── Left column (70%) ─────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-6">

            {/* 4 metric cards — unchanged */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total billed",    value: formatCurrency(totalBilled),     cls: "text-dark" },
                { label: "Collected",       value: formatCurrency(totalCollected),   cls: "text-green-700" },
                { label: "Outstanding",     value: formatCurrency(totalOutstanding), cls: "text-dark" },
                { label: "Overdue",         value: formatCurrency(overdueAmount),    cls: overdueCount > 0 ? "text-red-600" : "text-dark" },
              ].map(({ label, value, cls }) => (
                <div key={label} className="bg-white rounded-xl border border-border p-5">
                  <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">{label}</p>
                  {loading ? <Sk className="h-8 w-24" /> : <p className={`text-2xl font-bold ${cls}`}>{value}</p>}
                </div>
              ))}
            </div>

            {/* Overdue alert banner */}
            {!loading && overdueCount > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" className="text-red-600 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <p className="text-sm font-medium text-red-700">
                  {overdueCount} invoice{overdueCount !== 1 ? "s" : ""} overdue — {formatCurrency(overdueAmount)} outstanding
                </p>
                <button
                  onClick={() => { setActiveTab("OVERDUE"); setPage(1); }}
                  className="ml-auto text-sm font-medium text-red-600 hover:underline shrink-0"
                >
                  View overdue →
                </button>
              </div>
            )}

            {/* Filter tabs + search — unchanged */}
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 border-b border-border">
                <div className="flex">
                  {PAYMENT_TABS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => { setActiveTab(key); setPage(1); }}
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
                <div className="py-2 w-52">
                  <Input
                    placeholder="Search IRN, buyer…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  />
                </div>
              </div>

              {loading ? (
                <div className="px-6 py-4 space-y-2">
                  {[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}
                </div>
              ) : invoices.length === 0 ? (
                <EmptyState tab={activeTab} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left w-[35%]">Client &amp; Invoice</th>
                        <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-right">Amount</th>
                        <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left">Payment Status</th>
                        <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left">FIRS</th>
                        <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide text-right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const net = effectiveAmount(inv);
                        const remaining = calcRemaining(inv);
                        const isPaid = inv.paymentStatus === "PAID" || remaining === 0;
                        const overdue = isRowOverdue(inv);

                        return (
                          <tr
                            key={inv.id}
                            className={`border-b border-border last:border-0 transition-colors ${
                              isPaid
                                ? "opacity-75 hover:opacity-100 hover:bg-surface"
                                : overdue
                                ? "border-l-2 border-l-red-200 hover:bg-surface"
                                : "hover:bg-surface"
                            }`}
                          >
                            {/* Col 1: Client & Invoice */}
                            <td className="px-6 py-3.5">
                              {inv.buyerName ? (
                                <p className="text-sm text-dark">{inv.buyerName}</p>
                              ) : (
                                <p className="text-sm text-muted italic">No buyer</p>
                              )}
                              <p className="text-xs text-muted mt-0.5">
                                {inv.platformIrn ?? inv.id} · {formatDate(inv.createdAt)}
                              </p>
                            </td>

                            {/* Col 2: Amount — credit note display preserved exactly */}
                            <td className="px-6 py-3.5 text-sm font-medium text-dark text-right">
                              {inv.hasCreditNote ? (
                                <div>
                                  <span>{formatCurrency(net, inv.currency)}</span>
                                  <div className="flex items-center justify-end gap-1 mt-0.5">
                                    <span
                                      className="px-1 rounded text-xs font-medium bg-gray-100 text-gray-500"
                                      title="Credit note issued"
                                    >
                                      CN
                                    </span>
                                    <s className="text-xs text-muted tabular-nums">
                                      {formatCurrency(inv.totalAmount, inv.currency)}
                                    </s>
                                  </div>
                                </div>
                              ) : (
                                formatCurrency(inv.totalAmount, inv.currency)
                              )}
                            </td>

                            {/* Col 3: Payment Status */}
                            <td className="px-6 py-3.5">
                              <PaymentStatusCell inv={inv} />
                            </td>

                            {/* Col 4: FIRS Status */}
                            <td className="px-6 py-3.5">
                              <FirsStatusPill status={inv.status} />
                            </td>

                            {/* Col 5: Actions */}
                            <td className="px-4 py-3.5">
                              <ActionsCell
                                inv={inv}
                                remainingAmount={remaining}
                                onRecord={() => {
                                  setRecordFor(inv);
                                  setForm({
                                    amount: String(remaining > 0 ? remaining : net),
                                    provider: "MANUAL", reference: "",
                                    paidAt: new Date().toISOString().slice(0, 10), notes: "",
                                  });
                                  setSubmitError("");
                                }}
                              />
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
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Right column — Collection Summary sidebar, unchanged ───────── */}
          <div className="w-72 shrink-0 space-y-4">
            <div className="bg-white rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-dark mb-4">Collection summary</h3>
              {statsLoading ? (
                <div className="space-y-3">
                  <Sk className="h-3 w-full" />
                  <Sk className="h-4 w-full" />
                  <Sk className="h-3 w-3/4" />
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-muted mb-1.5">
                      <span>{collectionRate}% collected</span>
                      <span>{formatCurrency(paymentStats?.totalCollected ?? 0)} of {formatCurrency(paymentStats?.totalBilled ?? 0)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-green h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, collectionRate)}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2 mt-4">
                    {[
                      { label: "Paid in full",     value: paymentStats?.paidInFull ?? 0,    cls: "text-green-700" },
                      { label: "Partially paid",   value: paymentStats?.partiallyPaid ?? 0, cls: "text-blue-600" },
                      { label: "Unpaid (not due)", value: paymentStats?.unpaidNotDue ?? 0,  cls: "text-muted" },
                      { label: "Overdue",          value: paymentStats?.overdue ?? 0,       cls: "text-red-600" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{label}</span>
                        <span className={`font-medium ${cls}`}>{value} invoice{value !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-dark mb-4">Payment providers</h3>
              {statsLoading ? (
                <div className="space-y-2">
                  {[0,1,2,3].map(i => <Sk key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(paymentStats?.providerBreakdown ?? PROVIDERS.map(p => ({ provider: p, total: 0 }))).map(({ provider, total }) => (
                    <div key={provider} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${PROVIDER_DOTS[provider] ?? "bg-gray-400"}`} />
                        <span className="text-dark">{formatPaymentMethod(provider)}</span>
                      </div>
                      <span className="font-medium text-dark">{formatCurrency(total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Record Payment Modal */}
      {recordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Record payment</h2>
              <button onClick={() => setRecordFor(null)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-surface rounded-lg border border-border text-sm">
                <span className="text-muted">Invoice: </span>
                <span className="font-mono text-dark">{recordFor.platformIrn?.slice(0, 20) ?? recordFor.id}</span>
                <span className="ml-3 text-muted">Buyer: </span>
                <span className="text-dark">{recordFor.buyerName}</span>
              </div>
              {submitError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{submitError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Amount (NGN)</label>
                <Input type="number" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Provider</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}>
                  {PROVIDERS.map((p) => <option key={p} value={p}>{formatPaymentMethod(p)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reference</label>
                <Input value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Transaction / receipt reference" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Payment date</label>
                <Input type="date" value={form.paidAt}
                  onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setRecordFor(null)}>Cancel</Button>
              <Button loading={submitting} disabled={!form.amount || !form.reference} onClick={handleRecordPayment}>
                Record payment
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
