import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { InvoiceDetail, PaymentRecord } from "./types";

const PROVIDER_BADGE: Record<string, string> = {
  MANUAL:        "bg-gray-100 text-gray-600",
  BANK_TRANSFER: "bg-blue-50 text-blue-700",
  PAYSTACK:      "bg-green-50 text-green-700",
  FLUTTERWAVE:   "bg-orange-50 text-orange-700",
};

interface PaymentTrackingCardProps {
  invoice: InvoiceDetail;
  payments: PaymentRecord[];
  paymentsLoading: boolean;
  canRecordPayment: boolean;
  amountOutstanding: number;
  collectedPct: number;
  onOpenPaymentModal: () => void;
}

export function PaymentTrackingCard({
  invoice,
  payments,
  paymentsLoading,
  canRecordPayment,
  amountOutstanding,
  collectedPct,
  onOpenPaymentModal,
}: PaymentTrackingCardProps) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-dark">Payment tracking</h2>
        {canRecordPayment && (
          <Button size="sm" onClick={onOpenPaymentModal}>
            Record payment
          </Button>
        )}
      </div>

      {/* 3-column totals */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[
          { label: "Total payable",    value: formatCurrency(invoice.totalAmount, invoice.currency) },
          { label: "Amount received",  value: formatCurrency(invoice.amountPaid ?? 0, invoice.currency) },
          { label: "Outstanding",      value: formatCurrency(Math.max(0, amountOutstanding), invoice.currency) },
        ].map(({ label, value }) => (
          <div key={label} className="text-center p-3 bg-surface rounded-lg border border-border">
            <p className="text-xs text-muted mb-1">{label}</p>
            <p className="text-sm font-bold text-dark">{value}</p>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="w-full bg-gray-100 rounded-full h-2 mb-1.5">
          <div className="bg-green h-2 rounded-full transition-all" style={{ width: `${Math.min(100, collectedPct)}%` }} />
        </div>
        <p className="text-xs text-muted">
          {collectedPct}% collected
          {invoice.paymentDueDate && ` · Due: ${formatDate(invoice.paymentDueDate)}`}
        </p>
      </div>

      {/* Payment history */}
      <h3 className="text-sm font-semibold text-dark mb-3">Payment history</h3>
      {paymentsLoading ? (
        <div className="space-y-2 py-2">
          {[0,1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-muted mb-3">No payments recorded yet.</p>
          {canRecordPayment && (
            <Button size="sm" onClick={onOpenPaymentModal}>
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
  );
}
