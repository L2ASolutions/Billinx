import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";
import type { InvoiceDetail } from "./types";

interface SendToBuyerModalProps {
  open: boolean;
  invoice: InvoiceDetail;
  sentToBuyer: boolean;
  sendingToBuyer: boolean;
  sendToBuyerError: string;
  onClose: () => void;
  onSend: () => void;
}

export function SendToBuyerModal({
  open,
  invoice,
  sentToBuyer,
  sendingToBuyer,
  sendToBuyerError,
  onClose,
  onSend,
}: SendToBuyerModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Send invoice to buyer</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {sentToBuyer ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-dark">Invoice sent to {invoice.buyerName}</p>
            </div>
          ) : (
            <>
              <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Invoice</span>
                  <span className="font-mono text-dark text-xs">{invoice.platformIrn}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Buyer</span>
                  <span className="text-dark font-medium">{invoice.buyerName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Amount</span>
                  <span className="text-dark font-medium">{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
                </div>
              </div>
              <p className="text-sm text-muted">
                The FIRS-certified invoice document including the QR verification code will be sent to the buyer.
              </p>
              {sendToBuyerError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {sendToBuyerError}
                </div>
              )}
            </>
          )}
        </div>
        {!sentToBuyer && (
          <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={sendingToBuyer} onClick={onSend}>
              Send invoice
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
