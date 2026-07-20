import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";
import type { InvoiceDetail, RecordPaymentForm } from "./types";

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

interface RecordPaymentModalProps {
  open: boolean;
  invoice: InvoiceDetail | null;
  form: RecordPaymentForm;
  submitting: boolean;
  error: string;
  onFormChange: (form: RecordPaymentForm) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function RecordPaymentModal({
  open,
  invoice,
  form,
  submitting,
  error,
  onFormChange,
  onClose,
  onSubmit,
}: RecordPaymentModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Record payment</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}
          {invoice?.whtApplicable && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm space-y-1">
              <div className="flex justify-between text-amber-800">
                <span>Invoice total</span>
                <span>{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-amber-700">
                <span>WHT deducted</span>
                <span>-{formatCurrency(invoice.whtAmount ?? 0, invoice.currency)}</span>
              </div>
              <div className="flex justify-between font-semibold text-amber-900 border-t border-amber-200 pt-1">
                <span>Cash received</span>
                <span>{formatCurrency(invoice.expectedCash ?? 0, invoice.currency)}</span>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Amount (NGN)</label>
            <input type="number"
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.amount}
              onChange={(e) => onFormChange({ ...form, amount: e.target.value })}
            />
          </div>
          {invoice?.whtApplicable && (
            <div>
              <label className="block text-sm font-medium text-dark mb-1">WHT deducted by buyer (NGN)</label>
              <input type="number"
                className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                value={form.whtDeducted}
                onChange={(e) => onFormChange({ ...form, whtDeducted: e.target.value })}
                placeholder="0.00"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Provider</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.provider}
              onChange={(e) => onFormChange({ ...form, provider: e.target.value })}
            >
              {PROVIDERS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Reference</label>
            <input
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.reference}
              onChange={(e) => onFormChange({ ...form, reference: e.target.value })}
              placeholder="Transaction reference"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Payment date</label>
            <input type="date"
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.paidAt}
              onChange={(e) => onFormChange({ ...form, paidAt: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
            <textarea
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
              rows={2}
              value={form.notes}
              onChange={(e) => onFormChange({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={submitting} disabled={!form.amount || !form.reference}
            onClick={onSubmit}>
            Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}
