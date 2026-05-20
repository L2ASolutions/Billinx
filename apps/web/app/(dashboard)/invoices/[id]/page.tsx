"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-50 text-green-700 border-green/20",
  REJECTED: "bg-red-50 text-red-600 border-red-200",
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
  QUEUED: "bg-blue-50 text-blue-600 border-blue-200",
  SUBMITTING: "bg-yellow-50 text-yellow-700 border-yellow-200",
  VALIDATION_FAILED: "bg-red-50 text-red-600 border-red-200",
  SUBMISSION_FAILED: "bg-red-50 text-red-600 border-red-200",
  DEAD_LETTERED: "bg-red-100 text-red-700 border-red-300",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

interface InvoiceDetail {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  status: string;
  invoiceType: string;
  invoiceKind: string;
  currency: string;
  totalAmount: number;
  taxAmount: number;
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
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-36 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => setInvoice(data as InvoiceDetail))
      .catch(() => setError("Invoice not found"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCancel() {
    if (!confirm("Cancel this invoice?")) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(id, "Cancelled by user");
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
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

  const canCancel = ["DRAFT", "QUEUED", "VALIDATION_FAILED"].includes(invoice.status);

  return (
    <>
      <Topbar
        title="Invoice Detail"
        actions={
          <div className="flex gap-2">
            <Link href="/invoices"><Button variant="secondary" size="sm">← Back</Button></Link>
            {canCancel && (
              <Button variant="danger" size="sm" loading={cancelling} onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted mb-1">Platform IRN</p>
              <p className="font-mono text-sm text-dark">{invoice.platformIrn}</p>
              {invoice.firsConfirmedIrn && (
                <>
                  <p className="text-xs text-muted mt-2 mb-1">FIRS Confirmed IRN</p>
                  <p className="font-mono text-sm text-green">{invoice.firsConfirmedIrn}</p>
                </>
              )}
            </div>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_COLORS[invoice.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {invoice.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Invoice info */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice Details</h2>
            <dl className="space-y-3">
              <Row label="Type" value={`${invoice.invoiceType} (${invoice.invoiceKind})`} />
              <Row label="Issue Date" value={formatDateTime(invoice.issueDate)} />
              <Row label="Currency" value={invoice.currency} />
              <Row label="Total Amount" value={formatCurrency(invoice.totalAmount, invoice.currency)} />
              <Row label="Tax Amount" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
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
                    <td className="px-6 py-3 text-sm text-dark">{item.description}</td>
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
    </>
  );
}
