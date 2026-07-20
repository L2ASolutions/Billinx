import { formatDateTime } from "@/lib/utils";
import type { InvoiceDetail } from "./types";

interface InvoiceHistorySectionsProps {
  submissionAttempts?: InvoiceDetail["submissionAttempts"];
  stateHistory: InvoiceDetail["stateHistory"];
}

export function InvoiceHistorySections({ submissionAttempts, stateHistory }: InvoiceHistorySectionsProps) {
  return (
    <>
      {/* Submission history */}
      {submissionAttempts && submissionAttempts.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">Submission history</h2>
          <div className="space-y-2">
            {submissionAttempts.map((a) => (
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
      {stateHistory?.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">Status history</h2>
          <div className="space-y-3">
            {stateHistory.map((h, i) => (
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
    </>
  );
}
