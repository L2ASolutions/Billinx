"use client";

import { useEffect, useState, useCallback } from "react";
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

// ── Payment status cell ───────────────────────────────────────────────────────

function PaymentStatusCell({ inv }: { inv: InvoiceRow }) {
  if (inv.paymentStatus === "PAID") {
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
  if (inv.paymentStatus === "PARTIAL") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        Partial
      </span>
    );
  }
  if (inv.paymentDueDate) {
    const due = new Date(inv.paymentDueDate);
    const today = new Date(new Date().toDateString());
    if (inv.isOverdue || due < today) {
      const days = Math.max(1, Math.round((today.getTime() - due.getTime()) / 86400000));
      return <span className="text-sm text-red-600 font-medium">Overdue {days}d</span>;
    }
    return <span className="text-sm text-muted">Due {formatDate(inv.paymentDueDate)}</span>;
  }
  if (inv.isOverdue) {
    return <span className="text-sm text-red-600 font-medium">Overdue</span>;
  }
  return <span className="text-sm text-muted">Unpaid</span>;
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

  // Derive metrics from loaded page (best-effort approximation for the top cards)
  // Use netAmount (post-credit-note) when available, else fall back to totalAmount.
  const effectiveAmount = (i: InvoiceRow) =>
    i.hasCreditNote ? Math.max(0, i.netAmount ?? Number(i.totalAmount ?? 0)) : Number(i.totalAmount ?? 0);
  const totalBilled = invoices.reduce((s, i) => s + effectiveAmount(i), 0);
  const totalCollected = invoices.reduce((s, i) => s + Number(i.amountPaid ?? 0), 0);
  const totalOutstanding = invoices.reduce((s, i) => {
    if (i.paymentStatus === "PAID") return s;
    return s + Math.max(0, effectiveAmount(i) - Number(i.amountPaid ?? 0));
  }, 0);
  const overdueCount = invoices.filter((i) => i.isOverdue).length;
  const overdueAmount = invoices
    .filter((i) => i.isOverdue)
    .reduce((s, i) => s + Math.max(0, effectiveAmount(i) - Number(i.amountPaid ?? 0)), 0);

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

  // Collection rate progress bar width
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
            {/* 4 metric cards */}
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

            {/* Filter tabs + search */}
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
                <div className="p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="1.8" className="text-muted">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                      <line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                  </div>
                  <p className="text-muted text-sm">No invoices found for this filter.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {["Invoice", "Buyer", "Amount", "Outstanding", "Status", ""].map((col, i) => (
                          <th key={col}
                            className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${[2, 3].includes(i) ? "text-right" : "text-left"}`}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const net = inv.hasCreditNote
                          ? Math.max(0, inv.netAmount ?? Number(inv.totalAmount ?? 0))
                          : Number(inv.totalAmount ?? 0);
                        const outstanding = inv.paymentStatus === "PAID"
                          ? 0
                          : Math.max(0, net - Number(inv.amountPaid ?? 0));
                        return (
                        <tr key={inv.id}
                          className={`border-b border-border last:border-0 transition-colors ${
                            inv.isOverdue ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-surface"
                          }`}>
                          <td className="px-6 py-3">
                            <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline block break-all">
                              {inv.platformIrn ?? inv.id.slice(0, 8) + "…"}
                            </Link>
                            {inv.isOverdue && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                                OVERDUE
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-sm text-dark max-w-[120px] truncate" title={inv.buyerName}>{inv.buyerName}</td>
                          <td className="px-6 py-3 text-sm font-medium text-dark text-right">
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
                          <td className="px-6 py-3 text-sm text-right">
                            <span className={outstanding === 0 ? "text-green-700 font-medium" : "text-dark font-medium"}>
                              {formatCurrency(outstanding, inv.currency)}
                            </span>
                          </td>
                          <td className="px-6 py-3">
                            <PaymentStatusCell inv={inv} />
                          </td>
                          <td className="px-6 py-3 text-right">
                            {inv.status === "ACCEPTED" && inv.paymentStatus !== "PAID" && (
                              <Button size="sm" variant="secondary" onClick={() => {
                                setRecordFor(inv);
                                setForm({
                                  amount: String(outstanding > 0 ? outstanding : net),
                                  provider: "MANUAL", reference: "",
                                  paidAt: new Date().toISOString().slice(0, 10), notes: "",
                                });
                                setSubmitError("");
                              }}>
                                Record payment
                              </Button>
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

          {/* ── Right column (30%) ────────────────────────────────────────── */}
          <div className="w-72 shrink-0 space-y-4">
            {/* Collection Summary */}
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
                      { label: "Paid in full",       value: paymentStats?.paidInFull ?? 0,    cls: "text-green-700" },
                      { label: "Partially paid",     value: paymentStats?.partiallyPaid ?? 0, cls: "text-blue-600" },
                      { label: "Unpaid (not due)",   value: paymentStats?.unpaidNotDue ?? 0,  cls: "text-muted" },
                      { label: "Overdue",            value: paymentStats?.overdue ?? 0,       cls: "text-red-600" },
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

            {/* Payment Providers */}
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
