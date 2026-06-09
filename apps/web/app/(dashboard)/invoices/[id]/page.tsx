"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { invoiceApi } from "@/lib/api";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED:          "bg-green-50 text-green-700 border-green/20",
  REJECTED:          "bg-red-50 text-red-600 border-red-200",
  DRAFT:             "bg-gray-100 text-gray-600 border-gray-200",
  QUEUED:            "bg-blue-50 text-blue-600 border-blue-200",
  SUBMITTING:        "bg-amber-50 text-amber-700 border-amber-200",
  SUBMITTED:         "bg-blue-50 text-blue-700 border-blue-200",
  VALIDATION_FAILED: "bg-red-50 text-red-600 border-red-200",
  SUBMISSION_FAILED: "bg-red-50 text-red-600 border-red-200",
  DEAD_LETTERED:     "bg-red-100 text-red-700 border-red-300",
  CANCELLED:         "bg-gray-100 text-gray-500 border-gray-200",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PAID:    "bg-green-50 text-green-700",
  PARTIAL: "bg-blue-50 text-blue-600",
  UNPAID:  "bg-amber-50 text-amber-700",
  OVERDUE: "bg-red-50 text-red-600",
};

const PROVIDERS = ["MANUAL", "PAYSTACK", "FLUTTERWAVE", "BANK_TRANSFER"] as const;

const PROVIDER_BADGE: Record<string, string> = {
  MANUAL:        "bg-gray-100 text-gray-600",
  BANK_TRANSFER: "bg-blue-50 text-blue-700",
  PAYSTACK:      "bg-green-50 text-green-700",
  FLUTTERWAVE:   "bg-orange-50 text-orange-700",
};

const REJECTION_FIXES: Record<string, string> = {
  "INVALID_TIN":           "Verify the buyer or seller TIN is in the format 12345678-0001 and is registered with FIRS.",
  "MISSING_HSN":           "Add the HSN/HS code for each line item. This is required for all B2B invoices.",
  "VAT_MISMATCH":          "Recalculate VAT — the VAT amount must equal the subtotal × the declared VAT rate.",
  "DUPLICATE_IRN":         "This invoice was already submitted. Check your submission history before resubmitting.",
  "INVALID_ISSUE_DATE":    "The issue date cannot be in the future. Update it to today's date or earlier.",
  "INVALID_CURRENCY":      "Only NGN, USD, EUR, and GBP are supported. Update the currency field.",
  "MISSING_BUYER_ADDRESS": "Buyer address is required for B2B invoices. Add the buyer's registered address.",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  paymentReference: string;
  paidAt: string;
  notes?: string;
}

interface CreditNoteRecord {
  id: string;
  originalAmount: number;
  adjustedAmount: number;
  adjustmentReason: string;
  customerName: string;
  customerTin?: string;
  transactionDate: string;
  createdBy: string;
}

interface InvoiceDetail {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  csid?: string;
  acceptedAt?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  status: string;
  invoiceType: string;
  invoiceKind: string;
  currency: string;
  totalAmount: number;
  taxAmount: number;
  amountPaid?: number;
  paymentStatus?: string;
  paymentDueDate?: string;
  isOverdue?: boolean;
  sellerName: string;
  sellerTin: string;
  sellerAddress?: string;
  buyerName: string;
  buyerTin?: string;
  buyerAddress?: string;
  issueDate: string;
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  rejectionCode?: string;
  errorMessage?: string;
  whtApplicable?: boolean;
  whtRate?: number;
  whtAmount?: number;
  expectedCash?: number;
  creditNotes?: CreditNoteRecord[];
  hasCreditNote?: boolean;
  netAmount?: number;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    vatRate: number;
    vatAmount: number;
    hsnCode?: string;
  }>;
  stateHistory: Array<{
    fromStatus: string;
    toStatus: string;
    createdAt: string;
    reason?: string;
  }>;
  submissionAttempts?: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    createdAt: string;
    errorMessage?: string;
  }>;
}

interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
  whtDeducted: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}

// ── Credit notes section ──────────────────────────────────────────────────────

function CreditNotesSection({ creditNotes, currency, totalAmount }: {
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

// ── Accepted banner ───────────────────────────────────────────────────────────

function AcceptedBanner({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="bg-green-50 border border-green/20 rounded-xl p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" className="text-green-600 shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold text-green-700">FIRS Accepted</span>
            {invoice.acceptedAt && (
              <span className="text-xs text-green-600">{formatDateTime(invoice.acceptedAt)}</span>
            )}
          </div>
          <div>
            <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">Invoice Reference Number (IRN)</p>
            <p className="font-mono text-sm text-green-800 font-semibold break-all">{invoice.platformIrn}</p>
          </div>
          {invoice.firsConfirmedIrn && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">FIRS Reference</p>
              <p className="font-mono text-sm text-green-800 break-all">{invoice.firsConfirmedIrn}</p>
            </div>
          )}
          {invoice.csid && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">CSID</p>
              <p className="font-mono text-sm text-green-800 break-all">{invoice.csid}</p>
            </div>
          )}
        </div>
        {(invoice.qrCode ?? invoice.qrCodeBase64) && invoice.status === 'ACCEPTED' && (
          <div className="shrink-0">
            <p className="text-xs text-green-600 mb-1 text-center font-medium uppercase tracking-wide">QR Code</p>
            <div className="p-2 bg-white border border-green/20 rounded-lg">
              {(() => {
                const raw = invoice.qrCode ?? invoice.qrCodeBase64!;
                const src = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="FIRS QR Code" width={150} height={150} className="block" />
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rejected banner ───────────────────────────────────────────────────────────

function RejectedBanner({ invoice, onCorrect }: { invoice: InvoiceDetail; onCorrect: () => void }) {
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

// ── Overdue banner ────────────────────────────────────────────────────────────

function OverdueBanner({ dueDate }: { dueDate?: string }) {
  const daysOverdue = dueDate
    ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
    : 0;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" className="text-red-600 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <p className="text-sm font-medium text-red-700">
        Payment overdue{daysOverdue > 0 ? ` by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}` : ""}
        {dueDate ? ` — due ${formatDate(dueDate)}` : ""}
      </p>
    </div>
  );
}

// ── Submission progress ───────────────────────────────────────────────────────

type StepState = "done" | "active" | "pending" | "failed";

interface ProgressStep {
  label: string;
  state: StepState;
}

function stepIcon(state: StepState) {
  if (state === "done") {
    return (
      <span className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
        <svg className="animate-spin text-blue-600" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
      <span className="w-2 h-2 rounded-full bg-gray-400" />
    </span>
  );
}

function getSteps(status: string): ProgressStep[] {
  const done = (label: string): ProgressStep => ({ label, state: "done" });
  const active = (label: string): ProgressStep => ({ label, state: "active" });
  const pending = (label: string): ProgressStep => ({ label, state: "pending" });
  const failed = (label: string): ProgressStep => ({ label, state: "failed" });

  if (status === "QUEUED") {
    return [
      done("Invoice validated internally"),
      active("Payload signed with ECDSA key"),
      pending("Transmitting to FIRS MBS..."),
      pending("Awaiting IRN from FIRS"),
      pending("Recording to audit log"),
    ];
  }
  if (status === "SUBMITTING") {
    return [
      done("Invoice validated internally"),
      done("Payload signed with ECDSA key"),
      active("Transmitting to FIRS MBS..."),
      pending("Awaiting IRN from FIRS"),
      pending("Recording to audit log"),
    ];
  }
  if (status === "ACCEPTED") {
    return [
      done("Invoice validated internally"),
      done("Payload signed with ECDSA key"),
      done("Transmitting to FIRS MBS..."),
      done("Awaiting IRN from FIRS"),
      done("Recording to audit log"),
    ];
  }
  // REJECTED / SUBMISSION_FAILED
  return [
    done("Invoice validated internally"),
    done("Payload signed with ECDSA key"),
    done("Transmitting to FIRS MBS..."),
    failed("Awaiting IRN from FIRS"),
    pending("Recording to audit log"),
  ];
}

function SubmissionProgress({ invoice, onCorrect }: { invoice: InvoiceDetail; onCorrect: () => void }) {
  const steps = getSteps(invoice.status);
  const isAccepted = invoice.status === "ACCEPTED";
  const isRejected = ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED"].includes(invoice.status);
  const rejectionReason = invoice.rejectionReason ?? invoice.errorMessage
    ?? invoice.submissionAttempts?.find((a) => a.errorMessage)?.errorMessage;

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-dark mb-1">Submitting to FIRS</h2>
        <p className="text-sm text-muted font-mono">
          {invoice.platformIrn} · {invoice.buyerName}
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-white border border-border">
            {stepIcon(step.state)}
            <span className={`text-sm font-medium ${
              step.state === "done" ? "text-green-700" :
              step.state === "active" ? "text-blue-700" :
              step.state === "failed" ? "text-red-600" :
              "text-muted"
            }`}>
              {step.label}
            </span>
            {step.state === "active" && (
              <span className="ml-auto flex gap-1">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${d * 150}ms` }} />
                ))}
              </span>
            )}
          </div>
        ))}
      </div>

      {isAccepted && (
        <div className="bg-green-50 border border-green/20 rounded-xl p-6 space-y-4 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-green-800 text-lg">Invoice accepted by FIRS</p>
            <p className="text-sm text-green-700 mt-1">Your invoice has been validated and an IRN has been issued. It is now legally valid.</p>
          </div>
          <div className="bg-white rounded-lg border border-green/20 p-4 text-left space-y-3">
            <div>
              <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-0.5">Invoice Reference Number (IRN)</p>
              <p className="font-mono text-sm font-bold text-green-900 break-all">{invoice.platformIrn}</p>
            </div>
            {invoice.firsConfirmedIrn && (
              <div>
                <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-0.5">FIRS Reference</p>
                <p className="font-mono text-sm text-green-800 break-all">{invoice.firsConfirmedIrn}</p>
              </div>
            )}
            {invoice.csid && (
              <div>
                <p className="text-xs text-green-600 font-medium uppercase tracking-wide mb-0.5">CSID</p>
                <p className="font-mono text-xs text-green-800 break-all">{invoice.csid}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-green-600">Redirecting to invoice in a moment…</p>
        </div>
      )}

      {isRejected && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-red-800">Invoice rejected by FIRS</p>
              {rejectionReason && <p className="text-sm text-red-700 mt-1">{rejectionReason}</p>}
            </div>
          </div>
          <Button onClick={onCorrect}>Create corrected invoice →</Button>
        </div>
      )}

      {!isAccepted && !isRejected && (
        <p className="text-center text-xs text-muted mt-4">
          Checking status automatically every 2 seconds…
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDuplicated = searchParams.get("duplicated") === "true";
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [xmlDownloading, setXmlDownloading] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState<RecordPaymentForm>({
    amount: "", provider: "MANUAL", reference: "",
    paidAt: new Date().toISOString().slice(0, 10), notes: "", whtDeducted: "",
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const [payLinkCopied, setPayLinkCopied] = useState(false);
  const [payLinkToast, setPayLinkToast] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendingToBuyer, setSendingToBuyer] = useState(false);
  const [sendToBuyerError, setSendToBuyerError] = useState("");
  const [sentToBuyer, setSentToBuyer] = useState(false);
  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({
    adjustmentReason: "",
    adjustedAmount: "",
    transactionDate: new Date().toISOString().split("T")[0],
  });
  const [creditNoteSubmitting, setCreditNoteSubmitting] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState("");
  const [creditNoteSuccess, setCreditNoteSuccess] = useState(false);
  const [showingProgress, setShowingProgress] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPayments = useCallback(async (invoiceId: string) => {
    setPaymentsLoading(true);
    try {
      const res = await invoiceApi.listPayments(invoiceId) as { data: PaymentRecord[] };
      setPayments(res.data ?? []);
    } catch {
      // payments are optional
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  const IN_PROGRESS_STATUSES = ["QUEUED", "SUBMITTING"];

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => {
        const inv = data as InvoiceDetail;
        setInvoice(inv);
        if (IN_PROGRESS_STATUSES.includes(inv.status)) setShowingProgress(true);
        if (inv.status === "ACCEPTED") loadPayments(id);
      })
      .catch(() => setError("Invoice not found"))
      .finally(() => setLoading(false));
  }, [id, loadPayments]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!invoice || !showingProgress) return;
    if (!IN_PROGRESS_STATUSES.includes(invoice.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const data = await invoiceApi.get(id) as InvoiceDetail;
        setInvoice(data);
        if (!IN_PROGRESS_STATUSES.includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === "ACCEPTED") {
            loadPayments(id);
            setTimeout(() => setShowingProgress(false), 3000);
          } else {
            setTimeout(() => setShowingProgress(false), 2000);
          }
        }
      } catch {
        // ignore transient errors
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [showingProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCancel() {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(id, cancelReason);
      setShowCancelConfirm(false);
      const updated = await invoiceApi.get(id);
      setInvoice(updated as InvoiceDetail);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDownloadPdf() {
    setXmlDownloading(true);
    try {
      const { blob, filename } = await invoiceApi.getXml(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `invoice-${id}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setXmlDownloading(false);
    }
  }

  async function handleRecordPayment() {
    if (!invoice) return;
    setPaymentError("");
    setPaymentSubmitting(true);
    try {
      await invoiceApi.recordPayment(invoice.id, {
        amount: parseFloat(paymentForm.amount),
        provider: paymentForm.provider,
        reference: paymentForm.reference,
        paidAt: new Date(paymentForm.paidAt).toISOString(),
        notes: paymentForm.notes || undefined,
        whtDeducted: paymentForm.whtDeducted ? parseFloat(paymentForm.whtDeducted) : undefined,
      });
      setShowPaymentModal(false);
      const updated = await invoiceApi.get(id) as InvoiceDetail;
      setInvoice(updated);
      loadPayments(id);
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function handleSendToBuyer() {
    setSendingToBuyer(true);
    setSendToBuyerError("");
    try {
      await invoiceApi.sendToBuyer(id);
      setSentToBuyer(true);
      setTimeout(() => setShowSendModal(false), 1800);
    } catch (err: unknown) {
      setSendToBuyerError(err instanceof Error ? err.message : "Failed to send invoice.");
    } finally {
      setSendingToBuyer(false);
    }
  }

  function copyPaymentLink() {
    const link = `${window.location.origin}/pay/${invoice!.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setPayLinkCopied(true);
      setPayLinkToast(true);
      setTimeout(() => setPayLinkCopied(false), 2000);
      setTimeout(() => setPayLinkToast(false), 2500);
    });
  }

  function handleCreateCorrected() {
    if (!invoice) return;
    window.location.href = `/invoices/new?originalIrn=${encodeURIComponent(invoice.platformIrn)}&type=${invoice.invoiceType}`;
  }

  async function handleDuplicate() {
    if (!invoice) return;
    setDuplicating(true);
    try {
      const res = await invoiceApi.duplicate(invoice.id) as { id: string };
      router.push(`/invoices/${res.id}?duplicated=true`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to duplicate invoice.");
    } finally {
      setDuplicating(false);
    }
  }

  function handleCreateCreditNote() {
    if (!invoice) return;
    setCreditNoteForm({
      adjustmentReason: "",
      adjustedAmount: String(invoice.totalAmount),
      transactionDate: new Date().toISOString().split("T")[0],
    });
    setCreditNoteError("");
    setCreditNoteSuccess(false);
    setShowCreditNoteModal(true);
  }

  async function handleSubmitCreditNote() {
    if (!invoice) return;
    setCreditNoteSubmitting(true);
    setCreditNoteError("");
    try {
      await invoiceApi.createCreditNote(invoice.id, {
        adjustmentReason: creditNoteForm.adjustmentReason,
        adjustedAmount: Number(creditNoteForm.adjustedAmount),
        transactionDate: creditNoteForm.transactionDate,
      });
      setCreditNoteSuccess(true);
      setTimeout(() => setShowCreditNoteModal(false), 1800);
    } catch (err: unknown) {
      setCreditNoteError(err instanceof Error ? err.message : "Failed to issue credit note.");
    } finally {
      setCreditNoteSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-6 space-y-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <Skeleton className="h-7 w-28 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-32 mb-2" />
              {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-24 mb-2" />
              {[0,1,2,3].map(i => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-6 space-y-3">
            <Skeleton className="h-5 w-32 mb-2" />
            {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        </div>
      </>
    );
  }

  if (error || !invoice) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-6">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        </div>
      </>
    );
  }

  if (showingProgress && invoice) {
    return (
      <>
        <div className="bg-white border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-dark">Submitting to FIRS</h1>
            <p className="text-xs text-muted font-mono mt-0.5">{invoice.platformIrn}</p>
          </div>
          <Link href="/invoices"><Button variant="secondary" size="sm">← All invoices</Button></Link>
        </div>
        <SubmissionProgress invoice={invoice} onCorrect={() => {
          window.location.href = `/invoices/new?originalIrn=${encodeURIComponent(invoice.platformIrn)}&type=${invoice.invoiceType}`;
        }} />
      </>
    );
  }

  const isAccepted = invoice.status === "ACCEPTED";
  const isDraft = invoice.status === "DRAFT";
  const isRejected = ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(invoice.status);
  const canCancel = ["DRAFT", "QUEUED", "VALIDATION_FAILED", "ACCEPTED"].includes(invoice.status);
  const canRecordPayment = isAccepted && invoice.paymentStatus !== "PAID";
  const amountOutstanding = invoice.totalAmount - (invoice.amountPaid ?? 0);
  const collectedPct = invoice.totalAmount > 0
    ? Math.round(((invoice.amountPaid ?? 0) / invoice.totalAmount) * 100)
    : 0;

  const pageTitle = isAccepted ? "Invoice accepted" : isRejected ? "Invoice rejected" : "Invoice";
  const pageSubtitle = isAccepted
    ? `${invoice.platformIrn?.slice(0, 24) ?? invoice.id} · FIRS validated · IRN issued`
    : isRejected
    ? `${invoice.platformIrn?.slice(0, 24) ?? invoice.id} · Action required`
    : undefined;

  function openPaymentModal() {
    const defaultAmount = invoice?.whtApplicable
      ? (invoice.expectedCash ?? amountOutstanding)
      : (amountOutstanding > 0 ? amountOutstanding : invoice!.totalAmount);
    setPaymentForm({
      amount: String(defaultAmount),
      provider: "MANUAL", reference: "",
      paidAt: new Date().toISOString().slice(0, 10), notes: "",
      whtDeducted: invoice?.whtApplicable ? String(invoice.whtAmount ?? "") : "",
    });
    setPaymentError("");
    setShowPaymentModal(true);
  }

  return (
    <>
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-border px-6 py-4 flex items-start justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold text-dark">{pageTitle}</h1>
          {pageSubtitle && <p className="text-xs text-muted mt-0.5 font-mono">{pageSubtitle}</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/invoices"><Button variant="secondary" size="sm">← All invoices</Button></Link>
          {isDraft && (
            <Link href={`/invoices/new?id=${invoice.id}`}>
              <Button size="sm" variant="secondary">Edit draft →</Button>
            </Link>
          )}
          {isAccepted && (
            <>
              <Button variant="secondary" size="sm" onClick={copyPaymentLink}>
                {payLinkCopied ? "Copied!" : "Copy payment link"}
              </Button>
              <Button variant="secondary" size="sm" loading={xmlDownloading} onClick={handleDownloadPdf}>
                Download PDF
              </Button>
              <Button variant="secondary" size="sm" loading={duplicating} onClick={handleDuplicate}>
                Duplicate
              </Button>
            </>
          )}
          {isRejected && (
            <Button size="sm" onClick={handleCreateCorrected}>
              Create corrected invoice
            </Button>
          )}
          {canRecordPayment && (
            <Button size="sm" onClick={openPaymentModal}>
              Record payment
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" size="sm" onClick={() => setShowCancelConfirm(true)}>
              Cancel invoice
            </Button>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6 pb-24">
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
              onClick={() => setShowDuplicatedBanner(false)}
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
            <Button variant="secondary" size="sm" onClick={handleCreateCreditNote}>
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
                onClick={copyPaymentLink}
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
        {isRejected && <RejectedBanner invoice={invoice} onCorrect={handleCreateCorrected} />}

        {/* Payment tracking — accepted invoices */}
        {isAccepted && (
          <div className="bg-white rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-dark">Payment tracking</h2>
              {canRecordPayment && (
                <Button size="sm" onClick={openPaymentModal}>
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
                  <Button size="sm" onClick={openPaymentModal}>
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
        )}

        {/* Credit notes — accepted invoices that have at least one credit note */}
        {isAccepted && invoice.creditNotes && invoice.creditNotes.length > 0 && (
          <CreditNotesSection
            creditNotes={invoice.creditNotes}
            currency={invoice.currency}
            totalAmount={invoice.totalAmount}
          />
        )}

        {/* Invoice document */}
        {(isAccepted || isRejected) && (
          <div>
            <h2 className="font-semibold text-dark mb-4">Invoice document</h2>
            <p className="text-sm text-muted mb-4">
              {isAccepted
                ? "This is the FIRS-certified document your buyer receives. The QR code lets them verify it directly with FIRS."
                : "Invoice document — fields highlighted in red indicate data rejected by FIRS."}
            </p>
            <InvoiceDocument
              platformIrn={invoice.platformIrn}
              firsConfirmedIrn={invoice.firsConfirmedIrn}
              status={invoice.status}
              rejectionCode={invoice.rejectionCode}
              issueDate={invoice.issueDate}
              paymentDueDate={invoice.paymentDueDate}
              sellerName={invoice.sellerName}
              sellerTin={invoice.sellerTin}
              sellerAddress={invoice.sellerAddress}
              buyerName={invoice.buyerName}
              buyerTin={invoice.buyerTin}
              buyerAddress={invoice.buyerAddress}
              currency={invoice.currency}
              totalAmount={invoice.totalAmount}
              taxAmount={invoice.taxAmount}
              lineItems={invoice.lineItems}
              qrCode={invoice.qrCode}
              qrCodeBase64={invoice.qrCodeBase64}
              invoiceId={invoice.id}
            />
          </div>
        )}

        {/* Submission history */}
        {invoice.submissionAttempts && invoice.submissionAttempts.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Submission history</h2>
            <div className="space-y-2">
              {invoice.submissionAttempts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-border">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${a.status === "SUCCESS" ? "bg-green" : "bg-red-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-dark">Attempt #{a.attemptNumber}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${a.status === "SUCCESS" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {a.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                    {a.errorMessage && <p className="text-xs text-red-500 mt-1">{a.errorMessage}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* State history */}
        {invoice.stateHistory?.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Status history</h2>
            <div className="space-y-3">
              {invoice.stateHistory.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-muted w-40 shrink-0">{formatDateTime(h.createdAt)}</span>
                  <span className="text-muted">{(h.fromStatus ?? '').replace(/_/g, " ")}</span>
                  <span className="text-muted">→</span>
                  <span className="text-dark font-medium">{(h.toStatus ?? '').replace(/_/g, " ")}</span>
                  {h.reason && <span className="text-muted">— {h.reason}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom sticky action bar ────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border px-6 py-3 flex items-center gap-3 flex-wrap z-20">
        <Link href="/invoices" className="text-sm font-medium text-muted hover:text-dark transition-colors">
          ← All invoices
        </Link>
        <div className="flex-1" />
        {isAccepted && (
          <>
            <button
              onClick={() => { setSendToBuyerError(""); setSentToBuyer(false); setShowSendModal(true); }}
              className="text-sm font-medium text-muted hover:text-dark transition-colors"
            >
              Send to buyer
            </button>
            <Button variant="secondary" size="sm" loading={duplicating} onClick={handleDuplicate}>
              Duplicate
            </Button>
            <Button variant="secondary" size="sm" loading={xmlDownloading} onClick={handleDownloadPdf}>
              Download PDF
            </Button>
            {canRecordPayment && (
              <Button size="sm" onClick={openPaymentModal}>
                Record payment
              </Button>
            )}
          </>
        )}
        {isRejected && (
          <>
            <Button variant="secondary" size="sm" loading={xmlDownloading} onClick={handleDownloadPdf}>
              Download rejection report
            </Button>
            <Button size="sm" onClick={handleCreateCorrected}>
              Create corrected invoice
            </Button>
          </>
        )}
      </div>

      {/* ── Send to buyer modal ─────────────────────────────────────────────── */}
      {showSendModal && invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Send invoice to buyer</h2>
              <button onClick={() => setShowSendModal(false)} className="text-muted hover:text-dark">
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
                <Button variant="secondary" onClick={() => setShowSendModal(false)}>Cancel</Button>
                <Button loading={sendingToBuyer} onClick={handleSendToBuyer}>
                  Send invoice
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cancel modal ───────────────────────────────────────────────────── */}
      {showCancelConfirm && (
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
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancellation…"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>Back</Button>
              <Button variant="danger" loading={cancelling} disabled={!cancelReason.trim()} onClick={handleCancel}>
                Confirm cancellation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record payment modal ────────────────────────────────────────────── */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Record payment</h2>
              <button onClick={() => setShowPaymentModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {paymentError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{paymentError}</div>
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
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              {invoice?.whtApplicable && (
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">WHT deducted by buyer (NGN)</label>
                  <input type="number"
                    className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                    value={paymentForm.whtDeducted}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, whtDeducted: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Provider</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.provider}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  {PROVIDERS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Reference</label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Transaction reference"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Payment date</label>
                <input type="date"
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={paymentForm.paidAt}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paidAt: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>Cancel</Button>
              <Button loading={paymentSubmitting} disabled={!paymentForm.amount || !paymentForm.reference}
                onClick={handleRecordPayment}>
                Record payment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment link copied toast ───────────────────────────────────────── */}
      <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${payLinkToast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green text-white text-sm font-medium rounded-xl shadow-lg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Payment link copied!
        </div>
      </div>

      {/* ── Issue credit note modal ─────────────────────────────────────────── */}
      {showCreditNoteModal && invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">Issue credit note</h2>
              <button onClick={() => setShowCreditNoteModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {creditNoteSuccess ? (
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
                      value={creditNoteForm.adjustmentReason}
                      onChange={(e) => setCreditNoteForm((f) => ({ ...f, adjustmentReason: e.target.value }))}
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
                      value={creditNoteForm.adjustedAmount}
                      onChange={(e) => setCreditNoteForm((f) => ({ ...f, adjustedAmount: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">Transaction date *</label>
                    <input
                      type="date"
                      className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      value={creditNoteForm.transactionDate}
                      onChange={(e) => setCreditNoteForm((f) => ({ ...f, transactionDate: e.target.value }))}
                    />
                  </div>
                  {creditNoteError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      {creditNoteError}
                    </div>
                  )}
                </>
              )}
            </div>
            {!creditNoteSuccess && (
              <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => setShowCreditNoteModal(false)}>Cancel</Button>
                <Button
                  loading={creditNoteSubmitting}
                  disabled={!creditNoteForm.adjustmentReason.trim() || !creditNoteForm.adjustedAmount || !creditNoteForm.transactionDate}
                  onClick={handleSubmitCreditNote}
                >
                  Issue credit note
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
