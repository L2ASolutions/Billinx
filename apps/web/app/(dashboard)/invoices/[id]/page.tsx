"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-50 text-green-700 border-green/20",
  REJECTED: "bg-red-50 text-red-600 border-red-200",
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
  QUEUED: "bg-blue-50 text-blue-600 border-blue-200",
  SUBMITTING: "bg-yellow-50 text-yellow-700 border-yellow-200",
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  VALIDATION_FAILED: "bg-red-50 text-red-600 border-red-200",
  SUBMISSION_FAILED: "bg-red-50 text-red-600 border-red-200",
  DEAD_LETTERED: "bg-red-100 text-red-700 border-red-300",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID: "bg-green-50 text-green-700",
  PARTIAL: "bg-blue-50 text-blue-600",
  UNPAID: "bg-yellow-50 text-yellow-700",
  OVERDUE: "bg-red-50 text-red-600",
};

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  paymentReference: string;
  paidAt: string;
  notes?: string;
}

interface InvoiceDetail {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  qrCodeBase64?: string;
  status: string;
  invoiceType: string;
  invoiceKind: string;
  currency: string;
  totalAmount: number;
  taxAmount: number;
  amountPaid?: number;
  paymentStatus?: string;
  paymentDueDate?: string;
  isOverdue?: boolean;
  sellerName: string;
  sellerTin: string;
  buyerName: string;
  buyerTin?: string;
  issueDate: string;
  createdAt: string;
  updatedAt: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    vatRate: number;
    vatAmount: number;
    hsnCode?: string;
  }>;
  stateHistory: Array<{
    fromStatus: string;
    toStatus: string;
    createdAt: string;
    reason?: string;
  }>;
  submissionAttempts?: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    createdAt: string;
    errorMessage?: string;
  }>;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-36 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [xmlDownloading, setXmlDownloading] = useState(false);

  // Payments
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState<RecordPaymentForm>({
    amount: "",
    provider: "MANUAL",
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const loadPayments = useCallback(async (invoiceId: string) => {
    setPaymentsLoading(true);
    try {
      const res = await invoiceApi.listPayments(invoiceId) as { data: PaymentRecord[] };
      setPayments(res.data ?? []);
    } catch {
      // Payments are optional — don't surface error
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => {
        setInvoice(data as InvoiceDetail);
        if ((data as InvoiceDetail).status === "ACCEPTED") {
          loadPayments(id);
        }
      })
      .catch(() => setError("Invoice not found"))
      .finally(() => setLoading(false));
  }, [id, loadPayments]);

  async function handleCancel() {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(id, cancelReason);
      setShowCancelConfirm(false);
      // Reload invoice
      const updated = await invoiceApi.get(id);
      setInvoice(updated as InvoiceDetail);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDownloadXml() {
    setXmlDownloading(true);
    try {
      const { blob, filename } = await invoiceApi.getXml(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `invoice-${id}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setXmlDownloading(false);
    }
  }

  async function handleRecordPayment() {
    if (!invoice) return;
    setPaymentError("");
    setPaymentSubmitting(true);
    try {
      await invoiceApi.recordPayment(invoice.id, {
        amount: parseFloat(paymentForm.amount),
        provider: paymentForm.provider,
        reference: paymentForm.reference,
        paidAt: new Date(paymentForm.paidAt).toISOString(),
        notes: paymentForm.notes || undefined,
      });
      setShowPaymentModal(false);
      // Reload invoice + payments
      const updated = await invoiceApi.get(id) as InvoiceDetail;
      setInvoice(updated);
      loadPayments(id);
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-12 flex justify-center">
          <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (error || !invoice) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-6">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        </div>
      </>
    );
  }

  const canCancel = ["DRAFT", "QUEUED", "VALIDATION_FAILED", "ACCEPTED"].includes(invoice.status);
  const canRecordPayment = invoice.status === "ACCEPTED" && invoice.paymentStatus !== "PAID";
  const amountOutstanding = invoice.totalAmount - (invoice.amountPaid ?? 0);

  return (
    <>
      <Topbar
        title="Invoice Detail"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/invoices"><Button variant="secondary" size="sm">← Back</Button></Link>
            <Button variant="secondary" size="sm" loading={xmlDownloading} onClick={handleDownloadXml}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5 inline">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download XML
            </Button>
            {canRecordPayment && (
              <Button size="sm" onClick={() => {
                setPaymentForm({
                  amount: String(amountOutstanding > 0 ? amountOutstanding : invoice.totalAmount),
                  provider: "MANUAL",
                  reference: "",
                  paidAt: new Date().toISOString().slice(0, 10),
                  notes: "",
                });
                setPaymentError("");
                setShowPaymentModal(true);
              }}>
                Record Payment
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" size="sm" onClick={() => setShowCancelConfirm(true)}>
                Cancel Invoice
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[invoice.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                  {invoice.status.replace(/_/g, " ")}
                </span>
                {invoice.isOverdue && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 border border-red-200">
                    OVERDUE
                  </span>
                )}
                {invoice.paymentStatus && (
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border border-transparent ${PAYMENT_STATUS_COLORS[invoice.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>
                    Payment: {invoice.paymentStatus}
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs text-muted mb-0.5">Platform IRN</p>
                <p className="font-mono text-sm text-dark">{invoice.platformIrn}</p>
              </div>
              {invoice.firsConfirmedIrn && (
                <div className="mt-2">
                  <p className="text-xs text-muted mb-0.5">FIRS Confirmed IRN</p>
                  <p className="font-mono text-sm text-green-700 font-semibold">{invoice.firsConfirmedIrn}</p>
                </div>
              )}
            </div>
            {/* QR Code */}
            {invoice.qrCodeBase64 && invoice.status === "ACCEPTED" && (
              <div className="shrink-0">
                <p className="text-xs text-muted mb-1 text-center">QR Code</p>
                <div className="p-2 bg-white border border-border rounded-lg">
                  <Image
                    src={`data:image/png;base64,${invoice.qrCodeBase64}`}
                    alt="Invoice QR Code"
                    width={100}
                    height={100}
                    className="block"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Invoice info */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice Details</h2>
            <dl className="space-y-3">
              <Row label="Type" value={`${invoice.invoiceType} (${invoice.invoiceKind})`} />
              <Row label="Issue Date" value={formatDateTime(invoice.issueDate)} />
              <Row label="Due Date" value={invoice.paymentDueDate ? formatDate(invoice.paymentDueDate) : undefined} />
              <Row label="Currency" value={invoice.currency} />
              <Row label="Total Amount" value={formatCurrency(invoice.totalAmount, invoice.currency)} />
              <Row label="Tax Amount" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
              {invoice.amountPaid != null && (
                <Row label="Amount Paid" value={formatCurrency(invoice.amountPaid, invoice.currency)} />
              )}
              {invoice.paymentStatus && amountOutstanding > 0 && (
                <Row label="Outstanding" value={formatCurrency(amountOutstanding, invoice.currency)} />
              )}
            </dl>
          </div>

          {/* Parties */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Parties</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted mb-1">Seller</p>
                <p className="text-sm font-medium text-dark">{invoice.sellerName}</p>
                <p className="text-xs text-muted">TIN: {invoice.sellerTin}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1">Buyer</p>
                <p className="text-sm font-medium text-dark">{invoice.buyerName}</p>
                {invoice.buyerTin && <p className="text-xs text-muted">TIN: {invoice.buyerTin}</p>}
              </div>
            </div>
          </div>
        </div>

        {/* Line items */}
        {invoice.lineItems?.length > 0 && (
          <div className="bg-white rounded-xl border border-border">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Line Items</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Description</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Qty</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Unit Price</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">VAT</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-6 py-3">
                      <p className="text-sm text-dark">{item.description}</p>
                      {item.hsnCode && <p className="text-xs text-muted">HSN: {item.hsnCode}</p>}
                    </td>
                    <td className="px-6 py-3 text-sm text-dark text-right">{item.quantity}</td>
                    <td className="px-6 py-3 text-sm text-dark text-right">{formatCurrency(item.unitPrice, invoice.currency)}</td>
                    <td className="px-6 py-3 text-sm text-muted text-right">{item.vatRate}%</td>
                    <td className="px-6 py-3 text-sm font-medium text-dark text-right">{formatCurrency(item.totalPrice, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Payment history */}
        {invoice.status === "ACCEPTED" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Payment History</h2>
            {paymentsLoading ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted mb-3">No payments recorded yet.</p>
                {canRecordPayment && (
                  <Button size="sm" onClick={() => setShowPaymentModal(true)}>Record First Payment</Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-dark">{formatCurrency(p.amount, p.currency)}</span>
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{p.provider.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        Ref: <span className="font-mono">{p.paymentReference}</span> · {formatDate(p.paidAt)}
                      </p>
                      {p.notes && <p className="text-xs text-muted mt-0.5 italic">{p.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Submission history */}
        {invoice.submissionAttempts && invoice.submissionAttempts.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Submission History</h2>
            <div className="space-y-2">
              {invoice.submissionAttempts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-border">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${a.status === "SUCCESS" ? "bg-green" : "bg-red-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-dark">Attempt #{a.attemptNumber}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${a.status === "SUCCESS" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {a.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                    {a.errorMessage && <p className="text-xs text-red-500 mt-1 truncate">{a.errorMessage}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State history */}
        {invoice.stateHistory?.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Status History</h2>
            <div className="space-y-3">
              {invoice.stateHistory.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-muted w-40 shrink-0">{formatDateTime(h.createdAt)}</span>
                  <span className="text-muted">{h.fromStatus.replace(/_/g, " ")}</span>
                  <span className="text-muted">→</span>
                  <span className="text-dark font-medium">{h.toStatus.replace(/_/g, " ")}</span>
                  {h.reason && <span className="text-muted">— {h.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Cancel Invoice</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                This will request cancellation of the invoice. If already accepted, a cancellation request will be submitted to FIRS.
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reason for cancellation *</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancellation..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>Back</Button>
              <Button
                variant="danger"
                loading={cancelling}
                disabled={!cancelReason.trim()}
                onClick={handleCancel}
              >
                Confirm Cancellation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Record Payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {paymentError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{paymentError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Amount (NGN)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Provider</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.provider}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reference</label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Transaction reference"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Payment Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.paidAt}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paidAt: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>Cancel</Button>
              <Button
                loading={paymentSubmitting}
                disabled={!paymentForm.amount || !paymentForm.reference}
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
