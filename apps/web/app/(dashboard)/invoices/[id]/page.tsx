"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED:          "bg-green-50 text-green-700 border-green/20",
  REJECTED:          "bg-red-50 text-red-600 border-red-200",
  DRAFT:             "bg-gray-100 text-gray-600 border-gray-200",
  QUEUED:            "bg-blue-50 text-blue-600 border-blue-200",
  SUBMITTING:        "bg-amber-50 text-amber-700 border-amber-200",
  SUBMITTED:         "bg-blue-50 text-blue-700 border-blue-200",
  VALIDATION_FAILED: "bg-red-50 text-red-600 border-red-200",
  SUBMISSION_FAILED: "bg-red-50 text-red-600 border-red-200",
  DEAD_LETTERED:     "bg-red-100 text-red-700 border-red-300",
  CANCELLED:         "bg-gray-100 text-gray-500 border-gray-200",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID:    "bg-green-50 text-green-700",
  PARTIAL: "bg-blue-50 text-blue-600",
  UNPAID:  "bg-amber-50 text-amber-700",
  OVERDUE: "bg-red-50 text-red-600",
};

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

const PROVIDER_BADGE: Record<string, string> = {
  MANUAL:        "bg-gray-100 text-gray-600",
  BANK_TRANSFER: "bg-blue-50 text-blue-700",
  PAYSTACK:      "bg-green-50 text-green-700",
  FLUTTERWAVE:   "bg-orange-50 text-orange-700",
};

const REJECTION_FIXES: Record<string, string> = {
  "INVALID_TIN":           "Verify the buyer or seller TIN is in the format 12345678-0001 and is registered with FIRS.",
  "MISSING_HSN":           "Add the HSN/HS code for each line item. This is required for all B2B invoices.",
  "VAT_MISMATCH":          "Recalculate VAT — the VAT amount must equal the subtotal × the declared VAT rate.",
  "DUPLICATE_IRN":         "This invoice was already submitted. Check your submission history before resubmitting.",
  "INVALID_ISSUE_DATE":    "The issue date cannot be in the future. Update it to today's date or earlier.",
  "INVALID_CURRENCY":      "Only NGN, USD, EUR, and GBP are supported. Update the currency field.",
  "MISSING_BUYER_ADDRESS": "Buyer address is required for B2B invoices. Add the buyer's registered address.",
};

// ── Types ─────────────────────────────────────────────────────────────────────

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
  csid?: string;
  acceptedAt?: string;
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
  rejectionReason?: string;
  rejectionCode?: string;
  errorMessage?: string;
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

interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

// ── Accepted banner ───────────────────────────────────────────────────────────

function AcceptedBanner({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="bg-green-50 border border-green/20 rounded-xl p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" className="text-green-600 shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold text-green-700">FIRS Accepted</span>
            {invoice.acceptedAt && (
              <span className="text-xs text-green-600">{formatDateTime(invoice.acceptedAt)}</span>
            )}
          </div>
          {invoice.firsConfirmedIrn && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">FIRS IRN</p>
              <p className="font-mono text-sm text-green-800 font-semibold break-all">
                {invoice.firsConfirmedIrn}
              </p>
            </div>
          )}
          {invoice.csid && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">CSID</p>
              <p className="font-mono text-sm text-green-800 break-all">{invoice.csid}</p>
            </div>
          )}
          {!invoice.firsConfirmedIrn && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">Platform IRN</p>
              <p className="font-mono text-sm text-green-800 break-all">{invoice.platformIrn}</p>
            </div>
          )}
        </div>
        {invoice.qrCodeBase64 && (
          <div className="shrink-0">
            <p className="text-xs text-green-600 mb-1 text-center font-medium uppercase tracking-wide">QR Code</p>
            <div className="p-2 bg-white border border-green/20 rounded-lg">
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
  );
}

// ── Rejected banner ───────────────────────────────────────────────────────────

function RejectedBanner({ invoice, onCorrect }: { invoice: InvoiceDetail; onCorrect: () => void }) {
  const code = invoice.rejectionCode ?? "";
  const reason = invoice.rejectionReason ?? invoice.errorMessage
    ?? invoice.submissionAttempts?.find((a) => a.errorMessage)?.errorMessage
    ?? "No details provided by FIRS.";
  const fix = REJECTION_FIXES[code];

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" className="text-red-600">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-red-700">FIRS Rejected</span>
            {code && (
              <span className="px-2 py-0.5 rounded bg-red-100 text-xs font-mono text-red-600">
                {code}
              </span>
            )}
          </div>
          <p className="text-sm text-red-700 leading-relaxed">{reason}</p>
        </div>
      </div>

      {fix && (
        <div className="bg-white border border-red-100 rounded-lg p-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">How to fix</p>
          <p className="text-sm text-dark leading-relaxed">{fix}</p>
        </div>
      )}

      <div className="pt-1">
        <Button onClick={onCorrect}>
          Create corrected invoice
        </Button>
      </div>
    </div>
  );
}

// ── Overdue banner ────────────────────────────────────────────────────────────

function OverdueBanner({ dueDate }: { dueDate?: string }) {
  const daysOverdue = dueDate
    ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
    : 0;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" className="text-red-600 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <p className="text-sm font-medium text-red-700">
        Payment overdue{daysOverdue > 0 ? ` by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}` : ""}
        {dueDate ? ` — due ${formatDate(dueDate)}` : ""}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [xmlDownloading, setXmlDownloading] = useState(false);

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState<RecordPaymentForm>({
    amount: "", provider: "MANUAL", reference: "",
    paidAt: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const loadPayments = useCallback(async (invoiceId: string) => {
    setPaymentsLoading(true);
    try {
      const res = await invoiceApi.listPayments(invoiceId) as { data: PaymentRecord[] };
      setPayments(res.data ?? []);
    } catch {
      // payments are optional
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => {
        setInvoice(data as InvoiceDetail);
        if ((data as InvoiceDetail).status === "ACCEPTED") loadPayments(id);
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
      const updated = await invoiceApi.get(id) as InvoiceDetail;
      setInvoice(updated);
      loadPayments(id);
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  function handleCreateCorrected() {
    if (!invoice) return;
    // Pre-fill /invoices/new with originalIrn pointing to this rejected invoice
    window.location.href = `/invoices/new?originalIrn=${encodeURIComponent(invoice.platformIrn)}&type=${invoice.invoiceType}`;
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

  const isAccepted = invoice.status === "ACCEPTED";
  const isDraft = invoice.status === "DRAFT";
  const isRejected = ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(invoice.status);
  const canCancel = ["DRAFT", "QUEUED", "VALIDATION_FAILED", "ACCEPTED"].includes(invoice.status);
  // Show Record payment for any ACCEPTED invoice that is not fully PAID.
  const canRecordPayment = isAccepted && invoice.paymentStatus !== "PAID";
  const amountOutstanding = invoice.totalAmount - (invoice.amountPaid ?? 0);

  return (
    <>
      <Topbar
        title="Invoice detail"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/invoices"><Button variant="secondary" size="sm">← Back</Button></Link>
            {isDraft && (
              <Link href={`/invoices/new?id=${invoice.id}`}>
                <Button size="sm" variant="secondary">Edit draft →</Button>
              </Link>
            )}
            {isAccepted && (
              <Button variant="secondary" size="sm" loading={xmlDownloading} onClick={handleDownloadXml}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" className="mr-1.5 inline">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download XML
              </Button>
            )}
            {canRecordPayment && (
              <Button size="sm" onClick={() => {
                setPaymentForm({
                  amount: String(amountOutstanding > 0 ? amountOutstanding : invoice.totalAmount),
                  provider: "MANUAL", reference: "",
                  paidAt: new Date().toISOString().slice(0, 10), notes: "",
                });
                setPaymentError("");
                setShowPaymentModal(true);
              }}>
                Record payment
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" size="sm" onClick={() => setShowCancelConfirm(true)}>
                Cancel invoice
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Status header */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[invoice.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {(invoice.status ?? '').replace(/_/g, " ")}
            </span>
            {invoice.paymentStatus && (
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${PAYMENT_STATUS_COLORS[invoice.paymentStatus] ?? "bg-gray-100 text-gray-600"}`}>
                {invoice.paymentStatus}
              </span>
            )}
          </div>
          <div>
            <p className="text-xs text-muted mb-0.5 font-medium uppercase tracking-wide">Platform IRN</p>
            <p className="font-mono text-sm text-dark">{invoice.platformIrn}</p>
          </div>
        </div>

        {/* Overdue banner — show above accepted details if overdue */}
        {invoice.isOverdue && <OverdueBanner dueDate={invoice.paymentDueDate} />}

        {/* Accepted details */}
        {isAccepted && <AcceptedBanner invoice={invoice} />}

        {/* Rejected details */}
        {isRejected && <RejectedBanner invoice={invoice} onCorrect={handleCreateCorrected} />}

        {/* Invoice info + parties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice details</h2>
            <dl className="space-y-3">
              <Row label="Type" value={`${invoice.invoiceType} (${invoice.invoiceKind})`} />
              <Row label="Issue date" value={formatDateTime(invoice.issueDate)} />
              <Row label="Due date" value={invoice.paymentDueDate ? formatDate(invoice.paymentDueDate) : undefined} />
              <Row label="Currency" value={invoice.currency} />
              <Row label="Total amount" value={formatCurrency(invoice.totalAmount, invoice.currency)} />
              <Row label="Tax amount" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
              {invoice.amountPaid != null && (
                <Row label="Amount paid" value={formatCurrency(invoice.amountPaid, invoice.currency)} />
              )}
              {invoice.paymentStatus && amountOutstanding > 0 && (
                <Row label="Outstanding" value={formatCurrency(amountOutstanding, invoice.currency)} />
              )}
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Parties</h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Seller</p>
                <p className="text-sm font-medium text-dark">{invoice.sellerName}</p>
                <p className="text-xs text-muted">TIN: {invoice.sellerTin}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Buyer</p>
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
              <h2 className="font-semibold text-dark">Line items</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Description</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Qty</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Unit price</th>
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
          </div>
        )}

        {/* Payment tracking — accepted invoices only */}
        {isAccepted && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-dark">Payment history</h2>
              {canRecordPayment && (
                <Button size="sm" onClick={() => {
                  setPaymentForm({
                    amount: String(amountOutstanding > 0 ? amountOutstanding : invoice.totalAmount),
                    provider: "MANUAL", reference: "",
                    paidAt: new Date().toISOString().slice(0, 10), notes: "",
                  });
                  setPaymentError("");
                  setShowPaymentModal(true);
                }}>
                  Record payment
                </Button>
              )}
            </div>
            {paymentsLoading ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted mb-3">No payments recorded yet.</p>
                {canRecordPayment && (
                  <Button size="sm" onClick={() => setShowPaymentModal(true)}>
                    Record first payment
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-dark">{formatCurrency(p.amount, p.currency)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PROVIDER_BADGE[p.provider] ?? "bg-gray-100 text-gray-600"}`}>
                          {p.provider === "BANK_TRANSFER" ? "Bank Transfer" : p.provider.charAt(0) + p.provider.slice(1).toLowerCase()}
                        </span>
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
            <h2 className="font-semibold text-dark mb-4">Submission history</h2>
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
                    {a.errorMessage && <p className="text-xs text-red-500 mt-1">{a.errorMessage}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State history */}
        {invoice.stateHistory?.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Status history</h2>
            <div className="space-y-3">
              {invoice.stateHistory.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-muted w-40 shrink-0">{formatDateTime(h.createdAt)}</span>
                  <span className="text-muted">{(h.fromStatus ?? '').replace(/_/g, " ")}</span>
                  <span className="text-muted">→</span>
                  <span className="text-dark font-medium">{(h.toStatus ?? '').replace(/_/g, " ")}</span>
                  {h.reason && <span className="text-muted">— {h.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cancel modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Cancel invoice</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                If already accepted, a cancellation request will be submitted to FIRS.
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reason *</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancellation…"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>Back</Button>
              <Button variant="danger" loading={cancelling} disabled={!cancelReason.trim()} onClick={handleCancel}>
                Confirm cancellation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Record payment modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Record payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {paymentError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{paymentError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Amount (NGN)</label>
                <input type="number"
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
                <label className="block text-sm font-medium text-dark mb-1">Payment date</label>
                <input type="date"
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
              <Button loading={paymentSubmitting} disabled={!paymentForm.amount || !paymentForm.reference}
                onClick={handleRecordPayment}>
                Record payment
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
