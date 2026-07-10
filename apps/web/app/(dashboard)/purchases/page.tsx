"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { incomingInvoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingInvoice {
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
  rejectionReason?: string;
  supplierBankName?: string;
  supplierBankAccount?: string;
  supplierBankAccName?: string;
  hasAttachment?: boolean;
  createdAt: string;
}

interface AddInvoiceForm {
  supplierName: string;
  supplierTin: string;
  supplierEmail: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: string;
  vatAmount: string;
  currency: string;
  description: string;
  supplierBankName: string;
  supplierBankAccount: string;
  supplierBankAccName: string;
}

const EMPTY_FORM: AddInvoiceForm = {
  supplierName: "",
  supplierTin: "",
  supplierEmail: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  invoiceAmount: "",
  vatAmount: "0",
  currency: "NGN",
  description: "",
  supplierBankName: "",
  supplierBankAccount: "",
  supplierBankAccName: "",
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "ALL",       label: "All" },
  { key: "RECEIVED",  label: "Received" },
  { key: "VALIDATED", label: "Validated" },
  { key: "APPROVED",  label: "Approved" },
  { key: "PAID",      label: "Paid" },
  { key: "REJECTED",  label: "Rejected" },
] as const;

type StatusTab = typeof STATUS_TABS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  RECEIVED:  "bg-gray-100 text-gray-600",
  VALIDATED: "bg-blue-50 text-blue-600",
  APPROVED:  "bg-green-50 text-green-700",
  REJECTED:  "bg-red-50 text-red-600",
  PAID:      "bg-emerald-50 text-emerald-700",
};

// ── Bank Details Section ──────────────────────────────────────────────────────

function BankDetailsSection({ form, f }: { form: AddInvoiceForm; f: (field: keyof AddInvoiceForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void }) {
  const [open, setOpen] = useState(false);
  const inp = "w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-dark hover:bg-surface transition-colors"
      >
        <span>Supplier bank details (optional)</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border bg-surface/40">
          <p className="text-xs text-muted pt-3">Add these to display payment details when you need to pay this invoice.</p>
          <div>
            <label className="block text-xs font-medium text-dark mb-1">Bank name</label>
            <input className={inp} placeholder="e.g. GTBank" value={form.supplierBankName} onChange={f("supplierBankName")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark mb-1">Account number</label>
            <input className={inp} placeholder="e.g. 0123456789" value={form.supplierBankAccount} onChange={f("supplierBankAccount")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark mb-1">Account name</label>
            <input className={inp} placeholder="e.g. Acme Supplies Ltd" value={form.supplierBankAccName} onChange={f("supplierBankAccName")} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick Pay Modal ───────────────────────────────────────────────────────────

const PAYMENT_PROVIDERS = [
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CASH",          label: "Cash" },
  { value: "CHEQUE",        label: "Cheque" },
  { value: "OTHER",         label: "Other" },
];

function QuickPayModal({ invoice, onClose, onPaid }: { invoice: IncomingInvoice; onClose: () => void; onPaid: () => void }) {
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
      setSuccess(form.sendReceipt && invoice.supplierEmail ? `Payment recorded. Receipt sent to ${invoice.supplierEmail}.` : "Payment recorded.");
      setTimeout(() => { onPaid(); onClose(); }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-dark">Pay Invoice</h2>
            <p className="text-sm text-muted mt-0.5">{invoice.supplierName} · {formatCurrency(invoice.invoiceAmount, invoice.currency)}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-dark mt-0.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">{success}</div>}
          {invoice.supplierBankAccount && (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-2 text-sm">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Transfer to</p>
              {invoice.supplierBankName && <div className="flex justify-between"><span className="text-muted">Bank</span><span className="font-medium">{invoice.supplierBankName}</span></div>}
              <div className="flex justify-between"><span className="text-muted">Account</span><span className="font-mono font-medium">{invoice.supplierBankAccount}</span></div>
              {invoice.supplierBankAccName && <div className="flex justify-between"><span className="text-muted">Account name</span><span className="font-medium">{invoice.supplierBankAccName}</span></div>}
              <div className="flex justify-between"><span className="text-muted">Amount</span><span className="font-semibold text-green">{formatCurrency(invoice.invoiceAmount, invoice.currency)}</span></div>
            </div>
          )}
          {invoice.supplierBankAccount && (
            <div className="flex items-center gap-3"><div className="flex-1 h-px bg-border"/><span className="text-xs text-muted shrink-0">Then confirm your payment below</span><div className="flex-1 h-px bg-border"/></div>
          )}
          <div><label className="block text-sm font-medium text-dark mb-1">Amount paid (₦)</label><input type="number" step="0.01" min="0.01" required className={inp} value={form.amount} onChange={(e) => setForm(f => ({...f, amount: e.target.value}))} /></div>
          <div><label className="block text-sm font-medium text-dark mb-1">Payment method</label><select className={inp + " bg-white"} value={form.provider} onChange={(e) => setForm(f => ({...f, provider: e.target.value}))}>{PAYMENT_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-dark mb-1">Payment reference</label><input required className={inp} placeholder="e.g. TRF-2026-001" value={form.reference} onChange={(e) => setForm(f => ({...f, reference: e.target.value}))} /></div>
          <div><label className="block text-sm font-medium text-dark mb-1">Payment date</label><input type="date" required className={inp} value={form.paidAt} onChange={(e) => setForm(f => ({...f, paidAt: e.target.value}))} /></div>
          <div><label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label><input className={inp} placeholder="Any notes" value={form.notes} onChange={(e) => setForm(f => ({...f, notes: e.target.value}))} /></div>
          {invoice.supplierEmail && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={form.sendReceipt} onChange={(e) => setForm(f => ({...f, sendReceipt: e.target.checked}))} />
              <span className="text-sm text-dark">Send confirmation to supplier<span className="block text-xs text-muted">{invoice.supplierEmail}</span></span>
            </label>
          )}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={submitting} disabled={!form.amount || !form.reference || Boolean(success)}>Confirm Payment</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Invoice Modal ─────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AddInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<AddInvoiceForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const f =
    (field: keyof AddInvoiceForm) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  function handleFile(file: File) {
    setFileError("");
    const ALLOWED = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (!ALLOWED.includes(file.type)) {
      setFileError("Only PDF, JPG and PNG files accepted");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("File must be under 10MB");
      return;
    }
    setUploadFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      const created = await incomingInvoiceApi.create({
        supplierName: form.supplierName,
        supplierTin: form.supplierTin,
        supplierEmail: form.supplierEmail || undefined,
        invoiceNumber: form.invoiceNumber,
        invoiceDate: new Date(form.invoiceDate).toISOString(),
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        invoiceAmount: parseFloat(form.invoiceAmount),
        vatAmount: parseFloat(form.vatAmount) || 0,
        currency: form.currency,
        description: form.description || undefined,
        supplierBankName: form.supplierBankName || undefined,
        supplierBankAccount: form.supplierBankAccount || undefined,
        supplierBankAccName: form.supplierBankAccName || undefined,
      }) as { id: string };

      if (uploadFile) {
        try {
          await incomingInvoiceApi.uploadAttachment(created.id, uploadFile);
        } catch {
          setError("Invoice saved but document upload failed. You can upload it from the invoice detail.");
          onCreated();
          onClose();
          return;
        }
      }

      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    form.supplierName &&
    form.supplierTin &&
    form.invoiceNumber &&
    form.invoiceDate &&
    form.invoiceAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-dark">Add invoice</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-dark transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Upload zone */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">
              Invoice document <span className="text-muted font-normal">(optional)</span>
            </label>
            <p className="text-xs text-muted mb-2">Upload the original paper or digital invoice for your records</p>

            {uploadFile ? (
              <div className="border border-green-200 bg-green-50 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600 shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="text-sm text-dark font-medium truncate">{uploadFile.name}</span>
                  <span className="text-xs text-muted shrink-0">{formatFileSize(uploadFile.size)} · Ready to upload</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadFile(null)}
                  className="text-xs text-muted hover:text-red-500 ml-3 shrink-0 font-medium"
                >
                  Remove ×
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  fileError
                    ? "border-red-300 bg-red-50"
                    : dragOver
                    ? "border-green bg-green-50"
                    : "border-gray-300 hover:border-green hover:bg-green-50"
                }`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <p className="text-sm text-dark">Drag and drop your invoice here</p>
                <p className="text-xs text-muted mt-1">or click to browse</p>
                <p className="text-xs text-muted mt-2">PDF, JPG or PNG · Max 10MB</p>
              </div>
            )}

            {fileError && (
              <p className="text-xs text-red-600 mt-1">{fileError}</p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="border-t border-border" />

          <Input
            label="Supplier name *"
            value={form.supplierName}
            onChange={f("supplierName")}
            placeholder="e.g. Acme Supplies Ltd"
          />
          <Input
            label="Supplier TIN *"
            value={form.supplierTin}
            onChange={f("supplierTin")}
            placeholder="e.g. 12345678-0001"
          />
          <Input
            label="Supplier email (optional)"
            type="email"
            value={form.supplierEmail}
            onChange={f("supplierEmail")}
            placeholder="supplier@company.com"
          />
          <Input
            label="Invoice number *"
            value={form.invoiceNumber}
            onChange={f("invoiceNumber")}
            placeholder="e.g. INV-2026-001"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Invoice date *"
              type="date"
              value={form.invoiceDate}
              onChange={f("invoiceDate")}
            />
            <Input
              label="Due date"
              type="date"
              value={form.dueDate}
              onChange={f("dueDate")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Invoice amount (₦) *"
              type="number"
              value={form.invoiceAmount}
              onChange={f("invoiceAmount")}
              placeholder="0.00"
            />
            <Input
              label="VAT amount (₦)"
              type="number"
              value={form.vatAmount}
              onChange={f("vatAmount")}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">
              Currency
            </label>
            <select
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.currency}
              onChange={f("currency")}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
              rows={2}
              value={form.description}
              onChange={f("description")}
              placeholder="Optional description"
            />
          </div>

          {/* Supplier bank details */}
          <BankDetailsSection form={form} f={f} />
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Add invoice
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [payInvoice, setPayInvoice] = useState<IncomingInvoice | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (activeTab !== "ALL") params.status = activeTab;
      const res = await incomingInvoiceApi.list(
        params as Parameters<typeof incomingInvoiceApi.list>[0],
      );
      setInvoices(res.data as IncomingInvoice[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load invoices",
      );
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab]);

  useEffect(() => {
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleValidate(id: string) {
    setActionLoading(id);
    try {
      await incomingInvoiceApi.validate(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Validate failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      await incomingInvoiceApi.approve(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    const reason = prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionLoading(id);
    try {
      await incomingInvoiceApi.reject(id, reason);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <Topbar
        title="Purchase Invoices"
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Add invoice
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        <p className="text-sm text-muted -mt-2">
          Invoices received from your suppliers
        </p>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Filter tabs */}
          <div className="flex border-b border-border overflow-x-auto">
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setActiveTab(key);
                  setPage(1);
                }}
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

          {/* Table */}
          {loading ? (
            <div className="px-6 py-4 space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <SkeletonTableRow key={i} />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-muted"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div>
                <p className="text-dark font-medium">
                  No incoming invoices yet
                </p>
                <p className="text-sm text-muted mt-1">
                  Add your first supplier invoice
                </p>
              </div>
              <Button size="sm" onClick={() => setShowAdd(true)}>
                Add invoice
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Invoice #",
                      "Supplier",
                      "Date",
                      "Due Date",
                      "Amount",
                      "VAT",
                      "Status",
                      "Doc",
                      "",
                    ].map((col, i) => (
                      <th
                        key={col + i}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${
                          i === 4 || i === 5 ? "text-right" : "text-left"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-border last:border-0 hover:bg-surface transition-colors"
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/purchases/${inv.id}`}
                          className="text-sm font-mono text-green hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-sm text-dark">{inv.supplierName}</p>
                        <p className="text-xs text-muted">TIN: {inv.supplierTin}</p>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                        {formatDate(inv.invoiceDate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                        {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                        {formatCurrency(inv.invoiceAmount, inv.currency)}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted text-right">
                        {formatCurrency(inv.vatAmount, inv.currency)}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center">
                        {inv.hasAttachment && (
                          <span title="Document attached" className="text-gray-400">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline">
                              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                            </svg>
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/purchases/${inv.id}`}
                            className="text-xs font-medium text-green hover:underline"
                          >
                            View
                          </Link>
                          {inv.status === "RECEIVED" && (
                            <button
                              onClick={() => handleValidate(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            >
                              Validate
                            </button>
                          )}
                          {inv.status === "VALIDATED" && (
                            <button
                              onClick={() => handleApprove(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-green hover:text-green-dark disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          {inv.status === "APPROVED" && (
                            <button
                              onClick={() => setPayInvoice(inv)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-semibold text-white bg-green hover:bg-green-dark disabled:opacity-50 px-2 py-0.5 rounded-md"
                            >
                              Pay
                            </button>
                          )}
                          {["RECEIVED", "VALIDATED", "APPROVED"].includes(
                            inv.status,
                          ) && (
                            <button
                              onClick={() => handleReject(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Reject
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              Showing {invoices.length} of {total}
            </span>
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

      {showAdd && (
        <AddInvoiceModal
          onClose={() => setShowAdd(false)}
          onCreated={load}
        />
      )}
      {payInvoice && (
        <QuickPayModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onPaid={load}
        />
      )}
    </>
  );
}
