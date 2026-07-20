import { Button } from "@/components/ui/Button";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Row } from "./Row";
import { AcceptedBanner } from "./AcceptedBanner";
import { RejectedBanner } from "./RejectedBanner";
import { OverdueBanner } from "./OverdueBanner";
import type { InvoiceDetail } from "./types";

interface InvoiceStatusBannersProps {
  invoice: InvoiceDetail;
  isAccepted: boolean;
  isRejected: boolean;
  showDuplicatedBanner: boolean;
  onDismissDuplicatedBanner: () => void;
  payLinkCopied: boolean;
  onCopyPaymentLink: () => void;
  onCreateCreditNote: () => void;
  onCreateCorrected: () => void;
}

export function InvoiceStatusBanners({
  invoice,
  isAccepted,
  isRejected,
  showDuplicatedBanner,
  onDismissDuplicatedBanner,
  payLinkCopied,
  onCopyPaymentLink,
  onCreateCreditNote,
  onCreateCorrected,
}: InvoiceStatusBannersProps) {
  return (
    <>
      {/* Duplicated banner */}
      {showDuplicatedBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" className="text-amber-600 shrink-0 mt-0.5">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-800">Invoice duplicated</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Update the buyer details and dates, then submit when ready.
              </p>
            </div>
          </div>
          <button
            onClick={onDismissDuplicatedBanner}
            className="text-amber-500 hover:text-amber-700 shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Overdue banner */}
      {invoice.isOverdue && <OverdueBanner dueDate={invoice.paymentDueDate} />}

      {/* Accepted banner */}
      {isAccepted && <AcceptedBanner invoice={invoice} />}

      {/* Create credit note — accepted standard / credit-note invoices */}
      {isAccepted && ["STANDARD", "CREDIT_NOTE"].includes(invoice.invoiceType) && (
        <div className="bg-white rounded-xl border border-border px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-dark">Need to issue a credit note?</p>
            <p className="text-sm text-muted mt-0.5">
              Records a sales adjustment for VAT Schedule B reporting.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onCreateCreditNote}>
            Issue credit note
          </Button>
        </div>
      )}

      {/* FIRS details (accepted) */}
      {isAccepted && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">FIRS details</h2>
          <dl className="space-y-3">
            <Row label="Invoice Reference Number (IRN)" value={invoice.platformIrn} />
            {invoice.firsConfirmedIrn && <Row label="FIRS Reference" value={invoice.firsConfirmedIrn} />}
            {invoice.csid && <Row label="CSID" value={invoice.csid} />}
            {invoice.acceptedAt && <Row label="Accepted at" value={`${formatDateTime(invoice.acceptedAt)} WAT`} />}
            <Row label="Access point" value="Interswitch NRS" />
          </dl>
        </div>
      )}

      {/* Payment link — accepted invoices */}
      {isAccepted && (
        <div className="bg-white rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-dark">Payment link</h2>
          </div>
          <p className="text-xs text-muted mb-3">Share with buyer to receive payment online</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface border border-border font-mono text-xs text-muted truncate select-all">
              {typeof window !== "undefined" ? `${window.location.origin}/pay/${invoice.id}` : `/pay/${invoice.id}`}
            </div>
            <button
              onClick={onCopyPaymentLink}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green text-white text-xs font-medium hover:bg-green-dark transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {payLinkCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* WHT information — accepted invoices with WHT */}
      {isAccepted && invoice.whtApplicable && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
          <h2 className="font-semibold text-amber-900 mb-4">WHT Information</h2>
          <dl className="space-y-3">
            <Row label="WHT Rate" value={`${invoice.whtRate ?? 5}%`} />
            <Row label="Expected WHT deduction" value={formatCurrency(invoice.whtAmount ?? 0, invoice.currency)} />
            <Row label="Expected cash collection" value={formatCurrency(invoice.expectedCash ?? 0, invoice.currency)} />
          </dl>
          <p className="text-xs text-amber-700 mt-3">The buyer will deduct WHT at source and remit to FIRS. You will receive the net cash amount.</p>
        </div>
      )}

      {/* Rejected banner */}
      {isRejected && <RejectedBanner invoice={invoice} onCorrect={onCreateCorrected} />}
    </>
  );
}
