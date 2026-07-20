import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface InvoiceHeaderProps {
  pageTitle: string;
  pageSubtitle?: string;
  invoiceId: string;
  isDraft: boolean;
  isAccepted: boolean;
  isRejected: boolean;
  canRecordPayment: boolean;
  canSendReminder: boolean;
  canCancel: boolean;
  canViewNrsPayload: boolean;
  payLinkCopied: boolean;
  pdfDownloading: boolean;
  nrsPayloadDownloading: boolean;
  duplicating: boolean;
  sendingReminder: boolean;
  onDownloadNrsPayload: () => void;
  onCopyPaymentLink: () => void;
  onDownloadPdf: () => void;
  onDuplicate: () => void;
  onCreateCorrected: () => void;
  onOpenPaymentModal: () => void;
  onSendReminder: () => void;
  onOpenCancelConfirm: () => void;
}

export function InvoiceHeader({
  pageTitle,
  pageSubtitle,
  invoiceId,
  isDraft,
  isAccepted,
  isRejected,
  canRecordPayment,
  canSendReminder,
  canCancel,
  canViewNrsPayload,
  payLinkCopied,
  pdfDownloading,
  nrsPayloadDownloading,
  duplicating,
  sendingReminder,
  onDownloadNrsPayload,
  onCopyPaymentLink,
  onDownloadPdf,
  onDuplicate,
  onCreateCorrected,
  onOpenPaymentModal,
  onSendReminder,
  onOpenCancelConfirm,
}: InvoiceHeaderProps) {
  return (
    <div className="bg-white border-b border-border px-6 py-4 flex items-start justify-between sticky top-0 z-10">
      <div>
        <h1 className="text-lg font-bold text-dark">{pageTitle}</h1>
        {pageSubtitle && <p className="text-xs text-muted mt-0.5 font-mono">{pageSubtitle}</p>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Link href="/invoices"><Button variant="secondary" size="sm">← Sales Invoices</Button></Link>
        {canViewNrsPayload && (
          <Button variant="secondary" size="sm" loading={nrsPayloadDownloading} onClick={onDownloadNrsPayload}>
            Download NRS Payload
          </Button>
        )}
        {isDraft && (
          <Link href={`/invoices/new?id=${invoiceId}`}>
            <Button size="sm" variant="secondary">Edit draft →</Button>
          </Link>
        )}
        {isAccepted && (
          <>
            <Button variant="secondary" size="sm" onClick={onCopyPaymentLink}>
              {payLinkCopied ? "Copied!" : "Copy payment link"}
            </Button>
            <Button variant="secondary" size="sm" loading={pdfDownloading} onClick={onDownloadPdf}>
              Download PDF
            </Button>
            <Button variant="secondary" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
          </>
        )}
        {isRejected && (
          <Button size="sm" onClick={onCreateCorrected}>
            Create corrected invoice
          </Button>
        )}
        {canRecordPayment && (
          <Button size="sm" onClick={onOpenPaymentModal}>
            Record payment
          </Button>
        )}
        {canSendReminder && (
          <Button variant="secondary" size="sm" loading={sendingReminder} onClick={onSendReminder}>
            Send reminder
          </Button>
        )}
        {canCancel && (
          <Button variant="danger" size="sm" onClick={onOpenCancelConfirm}>
            Cancel invoice
          </Button>
        )}
      </div>
    </div>
  );
}
