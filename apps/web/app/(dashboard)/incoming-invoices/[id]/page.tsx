"use client";

import { useEffect, useState, useCallback } from "react";
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
  items: IncomingInvoiceItem[];
  createdAt: string;
  updatedAt: string;
}

interface MarkPaidForm {
  amount: string;
  reference: string;
  provider: string;
  paidAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  RECEIVED:  "bg-gray-100 text-gray-600 border-gray-200",
  VALIDATED: "bg-blue-50 text-blue-600 border-blue-200",
  APPROVED:  "bg-green-50 text-green-700 border-green/20",
  REJECTED:  "bg-red-50 text-red-600 border-red-200",
  PAID:      "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IncomingInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<IncomingInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [paidForm, setPaidForm] = useState<MarkPaidForm>({
    amount: "",
    reference: "",
    provider: "MANUAL",
    paidAt: new Date().toISOString().slice(0, 10),
  });
  const [paidError, setPaidError] = useState("");
  const [paidSubmitting, setPaidSubmitting] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

  async function handleValidate() {
    setActionLoading(true);
    try {
      await incomingInvoiceApi.validate(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Validate failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove() {
    setActionLoading(true);
    try {
      await incomingInvoiceApi.approve(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    const reason = prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionLoading(true);
    try {
      await incomingInvoiceApi.reject(id, reason);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMarkPaid() {
    setPaidError("");
    setPaidSubmitting(true);
    try {
      await incomingInvoiceApi.markPaid(id, {
        amount: parseFloat(paidForm.amount),
        reference: paidForm.reference,
        provider: paidForm.provider,
        paidAt: new Date(paidForm.paidAt).toISOString(),
      });
      setShowMarkPaid(false);
      load();
    } catch (err: unknown) {
      setPaidError(err instanceof Error ? err.message : "Failed to mark as paid");
    } finally {
      setPaidSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Incoming invoice" />
        <div className="p-6 space-y-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <Skeleton className="h-7 w-28 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-32 mb-2" />
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-24 mb-2" />
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !invoice) {
    return (
      <>
        <Topbar title="Incoming invoice" />
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
  const canMarkPaid = invoice.status === "APPROVED";

  return (
    <>
      <Topbar
        title="Incoming invoice"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href="/incoming-invoices">
              <Button variant="secondary" size="sm">
                ← Back
              </Button>
            </Link>
            {canValidate && (
              <Button
                size="sm"
                variant="secondary"
                loading={actionLoading}
                onClick={handleValidate}
              >
                Validate
              </Button>
            )}
            {canApprove && (
              <Button size="sm" loading={actionLoading} onClick={handleApprove}>
                Approve
              </Button>
            )}
            {canMarkPaid && (
              <Button
                size="sm"
                onClick={() => {
                  setPaidForm({
                    amount: String(invoice.invoiceAmount),
                    reference: "",
                    provider: "MANUAL",
                    paidAt: new Date().toISOString().slice(0, 10),
                  });
                  setPaidError("");
                  setShowMarkPaid(true);
                }}
              >
                Mark as paid
              </Button>
            )}
            {canReject && (
              <Button
                variant="danger"
                size="sm"
                loading={actionLoading}
                onClick={handleReject}
              >
                Reject
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Status header */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${
                STATUS_COLORS[invoice.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
              }`}
            >
              {invoice.status}
            </span>
          </div>
          <p className="text-xs text-muted font-medium uppercase tracking-wide mb-0.5">
            Invoice number
          </p>
          <p className="font-mono text-sm text-dark">{invoice.invoiceNumber}</p>
        </div>

        {/* Rejection reason */}
        {invoice.status === "REJECTED" && invoice.rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-red-700 mb-1">
              Rejection reason
            </p>
            <p className="text-sm text-red-700">{invoice.rejectionReason}</p>
          </div>
        )}

        {/* Invoice details + supplier */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice details</h2>
            <dl className="space-y-3">
              <Row label="Invoice number" value={invoice.invoiceNumber} />
              <Row label="Invoice date" value={formatDate(invoice.invoiceDate)} />
              <Row
                label="Due date"
                value={invoice.dueDate ? formatDate(invoice.dueDate) : undefined}
              />
              <Row label="Currency" value={invoice.currency} />
              <Row
                label="Invoice amount"
                value={formatCurrency(invoice.invoiceAmount, invoice.currency)}
              />
              <Row
                label="VAT amount"
                value={formatCurrency(invoice.vatAmount, invoice.currency)}
              />
              {invoice.description && (
                <Row label="Description" value={invoice.description} />
              )}
              {invoice.sourceReference && (
                <Row label="Reference" value={invoice.sourceReference} />
              )}
            </dl>
          </div>

          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Supplier</h2>
            <dl className="space-y-3">
              <Row label="Name" value={invoice.supplierName} />
              <Row label="TIN" value={invoice.supplierTin} />
            </dl>
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
                    <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                      Description
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                      Qty
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                      Unit price
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                      VAT
                    </th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                      Line amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-6 py-3">
                        <p className="text-sm text-dark">{item.description}</p>
                        {item.hsnCode && (
                          <p className="text-xs text-muted">
                            HSN: {item.hsnCode}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm text-dark text-right">
                        {item.quantity}
                      </td>
                      <td className="px-6 py-3 text-sm text-dark text-right">
                        {formatCurrency(item.unitPrice, invoice.currency)}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted text-right">
                        {formatCurrency(item.vatAmount, invoice.currency)}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                        {formatCurrency(item.lineAmount, invoice.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Mark as paid modal */}
      {showMarkPaid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Mark as paid</h2>
              <button
                onClick={() => setShowMarkPaid(false)}
                className="text-muted hover:text-dark"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {paidError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {paidError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">
                  Amount (NGN)
                </label>
                <input
                  type="number"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paidForm.amount}
                  onChange={(e) =>
                    setPaidForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">
                  Provider
                </label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paidForm.provider}
                  onChange={(e) =>
                    setPaidForm((f) => ({ ...f, provider: e.target.value }))
                  }
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">
                  Reference
                </label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paidForm.reference}
                  onChange={(e) =>
                    setPaidForm((f) => ({ ...f, reference: e.target.value }))
                  }
                  placeholder="Transaction reference"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">
                  Payment date
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paidForm.paidAt}
                  onChange={(e) =>
                    setPaidForm((f) => ({ ...f, paidAt: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => setShowMarkPaid(false)}
              >
                Cancel
              </Button>
              <Button
                loading={paidSubmitting}
                disabled={!paidForm.amount || !paidForm.reference}
                onClick={handleMarkPaid}
              >
                Mark as paid
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
