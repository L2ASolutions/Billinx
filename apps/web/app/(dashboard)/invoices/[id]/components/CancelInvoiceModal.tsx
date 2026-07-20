import { Button } from "@/components/ui/Button";

interface CancelInvoiceModalProps {
  open: boolean;
  cancelReason: string;
  cancelling: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelInvoiceModal({
  open,
  cancelReason,
  cancelling,
  onReasonChange,
  onClose,
  onConfirm,
}: CancelInvoiceModalProps) {
  if (!open) return null;

  return (
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
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Enter reason for cancellation…"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Back</Button>
          <Button variant="danger" loading={cancelling} disabled={!cancelReason.trim()} onClick={onConfirm}>
            Confirm cancellation
          </Button>
        </div>
      </div>
    </div>
  );
}
