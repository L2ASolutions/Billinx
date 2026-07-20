import { formatCurrency } from "@/lib/utils";
import type { CreditNoteRecord } from "./types";

export function CreditNotesSection({ creditNotes, currency, totalAmount }: {
  creditNotes: CreditNoteRecord[];
  currency: string;
  totalAmount: number;
}) {
  const totalAdjustment = creditNotes.reduce(
    (sum, cn) => sum + (cn.originalAmount - cn.adjustedAmount),
    0,
  );
  const netInvoiceValue = Math.max(0, totalAmount - totalAdjustment);

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="font-semibold text-dark mb-4">Credit Notes</h2>
      <div className="space-y-3">
        {creditNotes.map((cn, i) => {
          const adjustment = cn.originalAmount - cn.adjustedAmount;
          return (
            <div key={cn.id} className="p-4 bg-surface rounded-lg border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-dark">#{i + 1}</span>
                <span className="text-sm text-muted">
                  {new Date(cn.transactionDate).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </span>
              </div>
              <p className="text-sm text-dark">{cn.adjustmentReason}</p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <p className="text-xs text-muted mb-0.5">Original</p>
                  <p className="text-sm font-medium text-dark">{formatCurrency(cn.originalAmount, currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-0.5">Adjustment</p>
                  <p className="text-sm font-medium text-red-600">−{formatCurrency(adjustment, currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-0.5">Net</p>
                  <p className="text-sm font-medium text-green-700">{formatCurrency(cn.adjustedAmount, currency)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-dark">Net invoice value after adjustments</span>
          <span className="text-base font-bold text-dark">{formatCurrency(netInvoiceValue, currency)}</span>
        </div>
      </div>
    </div>
  );
}
