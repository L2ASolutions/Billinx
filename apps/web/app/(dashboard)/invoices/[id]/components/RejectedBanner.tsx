import { Button } from "@/components/ui/Button";
import type { InvoiceDetail } from "./types";

const REJECTION_FIXES: Record<string, string> = {
  "INVALID_TIN":           "Verify the buyer or seller TIN is in the format 12345678-0001 and is registered with FIRS.",
  "MISSING_HSN":           "Add the HSN/HS code for each line item. This is required for all B2B invoices.",
  "VAT_MISMATCH":          "Recalculate VAT — the VAT amount must equal the subtotal × the declared VAT rate.",
  "DUPLICATE_IRN":         "This invoice was already submitted. Check your submission history before resubmitting.",
  "INVALID_ISSUE_DATE":    "The issue date cannot be in the future. Update it to today's date or earlier.",
  "INVALID_CURRENCY":      "Only NGN, USD, EUR, and GBP are supported. Update the currency field.",
  "MISSING_BUYER_ADDRESS": "Buyer address is required for B2B invoices. Add the buyer's registered address.",
};

export function RejectedBanner({ invoice, onCorrect }: { invoice: InvoiceDetail; onCorrect: () => void }) {
  const code = invoice.rejectionCode ?? "";
  const reason = invoice.rejectionReason ?? invoice.errorMessage
    ?? invoice.submissionAttempts?.find((a) => a.errorMessage)?.errorMessage
    ?? "No details provided by FIRS.";
  const fix = REJECTION_FIXES[code];

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" className="text-red-600">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-red-700">FIRS Rejected</span>
            {code && (
              <span className="px-2 py-0.5 rounded bg-red-100 text-xs font-mono text-red-600">
                {code}
              </span>
            )}
          </div>
          <p className="text-sm text-red-700 leading-relaxed">{reason}</p>
        </div>
      </div>

      {fix && (
        <div className="bg-white border border-red-100 rounded-lg p-4">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">How to fix</p>
          <p className="text-sm text-dark leading-relaxed">{fix}</p>
        </div>
      )}

      <div className="pt-1">
        <Button onClick={onCorrect}>
          Create corrected invoice
        </Button>
      </div>
    </div>
  );
}
