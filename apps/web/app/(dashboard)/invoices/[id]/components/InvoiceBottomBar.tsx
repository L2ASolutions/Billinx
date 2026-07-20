import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface InvoiceBottomBarProps {
  isAccepted: boolean;
  isRejected: boolean;
  canRecordPayment: boolean;
  duplicating: boolean;
  pdfDownloading: boolean;
  onOpenSendModal: () => void;
  onDuplicate: () => void;
  onDownloadPdf: () => void;
  onOpenPaymentModal: () => void;
  onCreateCorrected: () => void;
}

export function InvoiceBottomBar({
  isAccepted,
  isRejected,
  canRecordPayment,
  duplicating,
  pdfDownloading,
  onOpenSendModal,
  onDuplicate,
  onDownloadPdf,
  onOpenPaymentModal,
  onCreateCorrected,
}: InvoiceBottomBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border px-6 py-3 flex items-center gap-3 flex-wrap z-20">
      <Link href="/invoices" className="text-sm font-medium text-muted hover:text-dark transition-colors">
        ← Sales Invoices
      </Link>
      <div className="flex-1" />
      {isAccepted && (
        <>
          <button
            onClick={onOpenSendModal}
            className="text-sm font-medium text-muted hover:text-dark transition-colors"
          >
            Send to buyer
          </button>
          <Button variant="secondary" size="sm" loading={duplicating} onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="secondary" size="sm" loading={pdfDownloading} onClick={onDownloadPdf}>
            Download PDF
          </Button>
          {canRecordPayment && (
            <Button size="sm" onClick={onOpenPaymentModal}>
              Record payment
            </Button>
          )}
        </>
      )}
      {isRejected && (
        <>
          <Button variant="secondary" size="sm" loading={pdfDownloading} onClick={onDownloadPdf}>
            Download rejection report
          </Button>
          <Button size="sm" onClick={onCreateCorrected}>
            Create corrected invoice
          </Button>
        </>
      )}
    </div>
  );
}
