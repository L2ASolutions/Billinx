interface InvoiceToastsProps {
  payLinkToast: boolean;
  reminderToast: { message: string; type: "success" | "error" } | null;
}

export function InvoiceToasts({ payLinkToast, reminderToast }: InvoiceToastsProps) {
  return (
    <>
      {/* ── Payment link copied toast ───────────────────────────────────────── */}
      <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${payLinkToast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green text-white text-sm font-medium rounded-xl shadow-lg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Payment link copied!
        </div>
      </div>

      {/* ── Reminder toast ─────────────────────────────────────────────────────── */}
      <div className={`fixed bottom-36 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${reminderToast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
        {reminderToast && (
          <div className={`flex items-center gap-2 px-4 py-2.5 text-white text-sm font-medium rounded-xl shadow-lg ${reminderToast.type === "success" ? "bg-green" : "bg-red-500"}`}>
            {reminderToast.type === "success" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {reminderToast.message}
          </div>
        )}
      </div>
    </>
  );
}
