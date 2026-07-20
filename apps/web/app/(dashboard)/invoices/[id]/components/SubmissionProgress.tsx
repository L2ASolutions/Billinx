import { Button } from "@/components/ui/Button";
import type { InvoiceDetail } from "./types";

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

export function SubmissionProgress({ invoice, onCorrect }: { invoice: InvoiceDetail; onCorrect: () => void }) {
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
