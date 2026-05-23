"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const PAYMENT_STATUS = ["ALL", "UNPAID", "OVERDUE", "PARTIAL", "PAID"] as const;

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID: "bg-green-50 text-green-700",
  PARTIAL: "bg-blue-50 text-blue-600",
  UNPAID: "bg-yellow-50 text-yellow-700",
  OVERDUE: "bg-red-50 text-red-600",
};

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

interface InvoiceRow {
  id: string;
  platformIrn: string;
  buyerName: string;
  totalAmount: number;
  currency: string;
  status: string;
  paymentStatus?: string;
  paymentDueDate?: string;
  isOverdue?: boolean;
  createdAt: string;
}

interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-dark"}`}>{value}</p>
    </div>
  );
}

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Record payment modal
  const [recordFor, setRecordFor] = useState<InvoiceRow | null>(null);
  const [form, setForm] = useState<RecordPaymentForm>({
    amount: "",
    provider: "MANUAL",
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (search) params.search = search;
      // Map payment filter to status params
      if (filter === "PAID") params.paymentStatus = "PAID";
      else if (filter === "UNPAID") params.paymentStatus = "UNPAID";
      else if (filter === "OVERDUE") params.isOverdue = "true";
      else if (filter === "PARTIAL") params.paymentStatus = "PARTIAL";
      const res = await invoiceApi.list(params);
      setInvoices(res.data as InvoiceRow[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page, filter, search]);

  useEffect(() => { load(); }, [load]);

  // Compute metrics from loaded invoices
  const totalBilled = invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
  const overdueCount = invoices.filter((i) => i.isOverdue).length;

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

  return (
    <>
      <Topbar title="Payments" />

      <div className="p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total Billed" value={formatCurrency(totalBilled)} />
          <MetricCard
            label="Overdue Invoices"
            value={overdueCount.toString()}
            color={overdueCount > 0 ? "text-red-600" : "text-dark"}
          />
          <MetricCard label="Total Invoices" value={total.toString()} />
          <MetricCard label="This Page" value={invoices.length.toString()} />
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border">
            {PAYMENT_STATUS.map((s) => (
              <button
                key={s}
                onClick={() => { setFilter(s); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filter === s ? "bg-white shadow text-dark" : "text-muted hover:text-dark"
                }`}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="flex-1 max-w-xs">
            <Input
              placeholder="Search by IRN, buyer..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border">
          {loading ? (
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <p className="text-muted text-sm">No invoices found for this filter.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Invoice #</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Buyer</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Due Date</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Payment</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className={`border-b border-border last:border-0 transition-colors ${
                      inv.isOverdue ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-surface"
                    }`}
                  >
                    <td className="px-6 py-3">
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline">
                        {inv.platformIrn ? inv.platformIrn.slice(0, 16) + "…" : inv.id.slice(0, 8) + "…"}
                      </Link>
                      {inv.isOverdue && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                          OVERDUE
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                    <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">
                      {inv.paymentDueDate ? formatDate(inv.paymentDueDate) : "—"}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600`}>
                        {inv.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {inv.paymentStatus ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[inv.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>
                          {inv.paymentStatus}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {inv.status === "ACCEPTED" && inv.paymentStatus !== "PAID" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRecordFor(inv);
                            setForm({
                              amount: String(inv.totalAmount),
                              provider: "MANUAL",
                              reference: "",
                              paidAt: new Date().toISOString().slice(0, 10),
                              notes: "",
                            });
                            setSubmitError("");
                          }}
                        >
                          Record Payment
                        </Button>
                      )}
                    </td>
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
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {recordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Record Payment</h2>
              <button onClick={() => setRecordFor(null)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
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
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Provider</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reference</label>
                <Input
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Transaction / receipt reference"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Payment Date</label>
                <Input
                  type="date"
                  value={form.paidAt}
                  onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setRecordFor(null)}>Cancel</Button>
              <Button
                loading={submitting}
                disabled={!form.amount || !form.reference}
                onClick={handleRecordPayment}
              >
                Record Payment
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
