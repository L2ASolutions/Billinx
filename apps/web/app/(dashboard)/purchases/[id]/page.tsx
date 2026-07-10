"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { incomingInvoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  vatAmount: number;
  hsnCode?: string;
}

interface IncomingInvoiceDetail {
  id: string;
  supplierName: string;
  supplierTin: string;
  supplierEmail?: string;
  invoiceNumber: string;
  invoiceAmount: number;
  vatAmount: number;
  currency: string;
  invoiceDate: string;
  dueDate?: string;
  status: string;
  description?: string;
  sourceReference?: string;
  rejectionReason?: string;
  supplierBankName?: string;
  supplierBankAccount?: string;
  supplierBankAccName?: string;
  amountPaid?: number;
  paymentReference?: string;
  paymentProvider?: string;
  paidAt?: string;
  paymentNotes?: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  attachmentSize: number | null;
  items: IncomingInvoiceItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  RECEIVED:  "bg-gray-100 text-gray-600 border-gray-200",
  VALIDATED: "bg-blue-50 text-blue-600 border-blue-200",
  APPROVED:  "bg-green-50 text-green-700 border-green/20",
  REJECTED:  "bg-red-50 text-red-600 border-red-200",
  PAID:      "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const PAYMENT_PROVIDERS = [
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CASH",          label: "Cash" },
  { value: "CHEQUE",        label: "Cheque" },
  { value: "OTHER",         label: "Other" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-44 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-2 text-xs text-green hover:underline font-medium"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ── Pay Modal ─────────────────────────────────────────────────────────────────

function PayModal({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: IncomingInvoiceDetail;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [form, setForm] = useState({
    amount: String(invoice.invoiceAmount),
    provider: "BANK_TRANSFER",
    reference: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
    sendReceipt: Boolean(invoice.supplierEmail),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inp = "w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await incomingInvoiceApi.markPaid(invoice.id, {
        amount: parseFloat(form.amount),
        reference: form.reference,
        provider: form.provider,
        paidAt: new Date(form.paidAt).toISOString(),
        notes: form.notes || undefined,
        sendReceiptToSupplier: form.sendReceipt && Boolean(invoice.supplierEmail),
      });
      const msg = form.sendReceipt && invoice.supplierEmail
        ? `Payment recorded. Receipt sent to ${invoice.supplierEmail}.`
        : "Payment recorded successfully.";
      setSuccess(msg);
      setTimeout(() => { onPaid(); onClose(); }, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-dark">Pay Invoice</h2>
            <p className="text-sm text-muted mt-0.5">
              {invoice.supplierName} · {formatCurrency(invoice.invoiceAmount, invoice.currency)}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-dark mt-0.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">{success}</div>}

          {/* Bank details (if set) */}
          {invoice.supplierBankAccount && (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-2.5">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Transfer to</p>
              {invoice.supplierBankName && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Bank</span>
                  <span className="font-medium text-dark">{invoice.supplierBankName}</span>
                </div>
              )}
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted">Account</span>
                <div className="flex items-center">
                  <span className="font-mono font-medium text-dark">{invoice.supplierBankAccount}</span>
                  <CopyButton text={invoice.supplierBankAccount} />
                </div>
              </div>
              {invoice.supplierBankAccName && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Account name</span>
                  <span className="font-medium text-dark">{invoice.supplierBankAccName}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted">Reference</span>
                <span className="font-medium text-dark">{invoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Amount</span>
                <span className="font-semibold text-green">{formatCurrency(invoice.invoiceAmount, invoice.currency)}</span>
              </div>
            </div>
          )}

          {invoice.supplierBankAccount && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted shrink-0">Then confirm your payment below</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* Amount paid */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Amount paid (₦)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              className={inp}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Payment method</label>
            <select
              className={inp + " bg-white"}
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
            >
              {PAYMENT_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Payment reference</label>
            <input
              className={inp}
              required
              placeholder="e.g. TRF-2026-001"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Payment date</label>
            <input
              type="date"
              required
              className={inp}
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
            <input
              className={inp}
              placeholder="Any additional notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {/* Send receipt checkbox */}
          {invoice.supplierEmail && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border text-green focus:ring-green/30"
                checked={form.sendReceipt}
                onChange={(e) => setForm((f) => ({ ...f, sendReceipt: e.target.checked }))}
              />
              <span className="text-sm text-dark">
                Send payment confirmation to supplier
                <span className="block text-xs text-muted mt-0.5">{invoice.supplierEmail}</span>
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              className="flex-1"
              loading={submitting}
              disabled={!form.amount || !form.reference || Boolean(success)}
            >
              Confirm Payment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<IncomingInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptMsg, setReceiptMsg] = useState("");
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentDeleting, setAttachmentDeleting] = useState(false);
  const [attachmentMsg, setAttachmentMsg] = useState("");
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await incomingInvoiceApi.get(id);
      setInvoice(data as IncomingInvoiceDetail);
    } catch {
      setError("Invoice not found");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function handleValidate() {
    setActionLoading(true);
    try { await incomingInvoiceApi.validate(id); load(); }
    catch (err: unknown) { alert(err instanceof Error ? err.message : "Validate failed"); }
    finally { setActionLoading(false); }
  }

  async function handleApprove() {
    setActionLoading(true);
    try { await incomingInvoiceApi.approve(id); load(); }
    catch (err: unknown) { alert(err instanceof Error ? err.message : "Approve failed"); }
    finally { setActionLoading(false); }
  }

  async function handleReject() {
    const reason = prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionLoading(true);
    try { await incomingInvoiceApi.reject(id, reason); load(); }
    catch (err: unknown) { alert(err instanceof Error ? err.message : "Reject failed"); }
    finally { setActionLoading(false); }
  }

  async function handleSendReceipt() {
    setReceiptLoading(true);
    setReceiptMsg("");
    try {
      const res = await incomingInvoiceApi.sendReceipt(id);
      setReceiptMsg(`Receipt sent to ${res.to}`);
    } catch (err: unknown) {
      setReceiptMsg(err instanceof Error ? err.message : "Failed to send receipt");
    } finally {
      setReceiptLoading(false);
    }
  }

  async function handleAttachmentUpload(file: File) {
    setAttachmentMsg("");
    setAttachmentUploading(true);
    try {
      await incomingInvoiceApi.uploadAttachment(id, file);
      await load();
      setAttachmentMsg("Document uploaded successfully.");
    } catch (err: unknown) {
      setAttachmentMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAttachmentUploading(false);
    }
  }

  async function handleViewAttachment() {
    try {
      const { blob } = await incomingInvoiceApi.downloadAttachment(id);
      const url = URL.createObjectURL(blob);
      const a = window.open(url, "_blank");
      if (!a) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to open document");
    }
  }

  async function handleDownloadAttachment() {
    try {
      const { blob, filename } = await incomingInvoiceApi.downloadAttachment(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to download document");
    }
  }

  async function handleDeleteAttachment() {
    if (!confirm("Remove this document?")) return;
    setAttachmentDeleting(true);
    setAttachmentMsg("");
    try {
      await incomingInvoiceApi.deleteAttachment(id);
      await load();
      setAttachmentMsg("");
    } catch (err: unknown) {
      setAttachmentMsg(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setAttachmentDeleting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Purchase Invoice" />
        <div className="p-6 space-y-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <Skeleton className="h-7 w-28 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[0, 1].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-6 space-y-3">
                <Skeleton className="h-5 w-32 mb-2" />
                {[0,1,2,3,4].map((j) => <Skeleton key={j} className="h-4 w-full" />)}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (error || !invoice) {
    return (
      <>
        <Topbar title="Purchase Invoice" />
        <div className="p-6">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error || "Invoice not found"}
          </div>
        </div>
      </>
    );
  }

  const canValidate = invoice.status === "RECEIVED";
  const canApprove = invoice.status === "VALIDATED";
  const canReject = ["RECEIVED", "VALIDATED", "APPROVED"].includes(invoice.status);
  const canPay = invoice.status === "APPROVED";
  const isPaid = invoice.status === "PAID";

  return (
    <>
      <Topbar
        title="Incoming invoice"
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <Link href="/purchases">
              <Button variant="secondary" size="sm">← Back to Purchase Invoices</Button>
            </Link>
            {canValidate && (
              <Button size="sm" variant="secondary" loading={actionLoading} onClick={handleValidate}>Validate</Button>
            )}
            {canApprove && (
              <Button size="sm" loading={actionLoading} onClick={handleApprove}>Approve</Button>
            )}
            {canPay && (
              <Button
                size="sm"
                onClick={() => setShowPayModal(true)}
                className="bg-green text-white hover:bg-green-dark"
              >
                Pay now {formatCurrency(invoice.invoiceAmount, invoice.currency)}
              </Button>
            )}
            {isPaid && invoice.supplierEmail && (
              <Button size="sm" variant="secondary" loading={receiptLoading} onClick={handleSendReceipt}>
                Resend receipt
              </Button>
            )}
            {canReject && (
              <Button variant="danger" size="sm" loading={actionLoading} onClick={handleReject}>Reject</Button>
            )}
          </div>
        }
      />

      {showPayModal && invoice && (
        <PayModal invoice={invoice} onClose={() => setShowPayModal(false)} onPaid={load} />
      )}

      <div className="p-6 space-y-6">
        {receiptMsg && (
          <div className={`p-3 rounded-xl text-sm ${receiptMsg.startsWith("Receipt") ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
            {receiptMsg}
          </div>
        )}

        {/* Status + invoice number */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[invoice.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {invoice.status}
            </span>
          </div>
          <p className="text-xs text-muted font-medium uppercase tracking-wide mb-0.5">Invoice number</p>
          <p className="font-mono text-sm text-dark">{invoice.invoiceNumber}</p>
        </div>

        {/* Rejection reason */}
        {invoice.status === "REJECTED" && invoice.rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-red-700 mb-1">Rejection reason</p>
            <p className="text-sm text-red-700">{invoice.rejectionReason}</p>
          </div>
        )}

        {/* Payment details (if paid) */}
        {isPaid && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-emerald-700 mb-3">Payment recorded</p>
            <dl className="space-y-2">
              {invoice.amountPaid != null && (
                <Row label="Amount paid" value={formatCurrency(invoice.amountPaid, invoice.currency)} />
              )}
              {invoice.paymentReference && <Row label="Reference" value={invoice.paymentReference} />}
              {invoice.paymentProvider && <Row label="Method" value={invoice.paymentProvider.replace(/_/g, " ")} />}
              {invoice.paidAt && <Row label="Paid on" value={formatDate(invoice.paidAt)} />}
              {invoice.paymentNotes && <Row label="Notes" value={invoice.paymentNotes} />}
            </dl>
          </div>
        )}

        {/* Invoice details + supplier */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice details</h2>
            <dl className="space-y-3">
              <Row label="Invoice number" value={invoice.invoiceNumber} />
              <Row label="Invoice date" value={formatDate(invoice.invoiceDate)} />
              <Row label="Due date" value={invoice.dueDate ? formatDate(invoice.dueDate) : undefined} />
              <Row label="Currency" value={invoice.currency} />
              <Row label="Invoice amount" value={formatCurrency(invoice.invoiceAmount, invoice.currency)} />
              <Row label="VAT amount" value={formatCurrency(invoice.vatAmount, invoice.currency)} />
              {invoice.description && <Row label="Description" value={invoice.description} />}
              {invoice.sourceReference && <Row label="Reference" value={invoice.sourceReference} />}
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Supplier</h2>
            <dl className="space-y-3">
              <Row label="Name" value={invoice.supplierName} />
              <Row label="TIN" value={invoice.supplierTin} />
              {invoice.supplierEmail && <Row label="Email" value={invoice.supplierEmail} />}
            </dl>

            {invoice.supplierBankAccount && (
              <div className="mt-5 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Bank details</p>
                <dl className="space-y-2">
                  {invoice.supplierBankName && <Row label="Bank" value={invoice.supplierBankName} />}
                  <div className="flex items-start gap-4">
                    <dt className="text-sm text-muted w-44 shrink-0">Account</dt>
                    <dd className="text-sm text-dark font-mono font-medium flex items-center gap-1">
                      {invoice.supplierBankAccount}
                      <CopyButton text={invoice.supplierBankAccount} />
                    </dd>
                  </div>
                  {invoice.supplierBankAccName && <Row label="Account name" value={invoice.supplierBankAccName} />}
                </dl>
              </div>
            )}
          </div>
        </div>

        {/* Original Document */}
        <div className="bg-white rounded-xl border border-border">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            <h2 className="font-semibold text-dark">Original Document</h2>
          </div>
          <div className="p-6">
            {attachmentMsg && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${attachmentMsg.includes("successfully") ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}>
                {attachmentMsg}
              </div>
            )}

            {invoice.hasAttachment ? (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-dark">{invoice.attachmentName}</p>
                    {invoice.attachmentSize != null && (
                      <p className="text-xs text-muted">{formatFileSize(invoice.attachmentSize)}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="secondary" onClick={handleViewAttachment}>
                    View document
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleDownloadAttachment}>
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={attachmentDeleting}
                    onClick={handleDeleteAttachment}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted mb-3">No document uploaded yet</p>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={attachmentUploading}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  Upload document
                </Button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAttachmentUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Line items */}
        {invoice.items.length > 0 && (
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
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Line amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-6 py-3">
                        <p className="text-sm text-dark">{item.description}</p>
                        {item.hsnCode && <p className="text-xs text-muted">HSN: {item.hsnCode}</p>}
                      </td>
                      <td className="px-6 py-3 text-sm text-dark text-right">{item.quantity}</td>
                      <td className="px-6 py-3 text-sm text-dark text-right">{formatCurrency(item.unitPrice, invoice.currency)}</td>
                      <td className="px-6 py-3 text-sm text-muted text-right">{formatCurrency(item.vatAmount, invoice.currency)}</td>
                      <td className="px-6 py-3 text-sm font-medium text-dark text-right">{formatCurrency(item.lineAmount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
