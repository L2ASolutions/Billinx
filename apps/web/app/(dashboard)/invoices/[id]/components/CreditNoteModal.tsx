import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";
import type { InvoiceDetail } from "./types";

interface CreditNoteFormState {
  adjustmentReason: string;
  adjustedAmount: string;
  transactionDate: string;
}

interface CreditNoteModalProps {
  open: boolean;
  invoice: InvoiceDetail;
  form: CreditNoteFormState;
  submitting: boolean;
  error: string;
  success: boolean;
  onFormChange: (form: CreditNoteFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function CreditNoteModal({
  open,
  invoice,
  form,
  submitting,
  error,
  success,
  onFormChange,
  onClose,
  onSubmit,
}: CreditNoteModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Issue credit note</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-dark">Credit note recorded successfully</p>
              <p className="text-xs text-muted text-center">This adjustment will appear in your VAT Schedule B report.</p>
            </div>
          ) : (
            <>
              <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Original invoice</span>
                  <span className="font-mono text-dark text-xs">{invoice.platformIrn}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Customer</span>
                  <span className="text-dark font-medium">{invoice.buyerName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Original amount</span>
                  <span className="text-dark font-medium">{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Adjustment reason *</label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.adjustmentReason}
                  onChange={(e) => onFormChange({ ...form, adjustmentReason: e.target.value })}
                  placeholder="e.g. Returned goods, pricing error…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Adjusted amount ({invoice.currency}) *</label>
                <input
                  type="number"
                  min={0}
                  max={invoice.totalAmount}
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.adjustedAmount}
                  onChange={(e) => onFormChange({ ...form, adjustedAmount: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Transaction date *</label>
                <input
                  type="date"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.transactionDate}
                  onChange={(e) => onFormChange({ ...form, transactionDate: e.target.value })}
                />
              </div>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
        {!success && (
          <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              loading={submitting}
              disabled={!form.adjustmentReason.trim() || !form.adjustedAmount || !form.transactionDate}
              onClick={onSubmit}
            >
              Issue credit note
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
