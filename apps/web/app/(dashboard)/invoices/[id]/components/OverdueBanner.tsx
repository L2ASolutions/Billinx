import { formatDate } from "@/lib/utils";

export function OverdueBanner({ dueDate }: { dueDate?: string }) {
  // Date.now() in render is flagged as impure by react-hooks/purity, but this is a
  // read-only "days overdue as of now" display calculation with no state/effects of
  // its own — an SSR/client hydration mismatch here would at most show a stale day
  // count for one render, not a functional bug. Accepted trade-off vs. threading
  // "now" through props/state for a purely cosmetic banner.
  const daysOverdue = dueDate
    // eslint-disable-next-line react-hooks/purity
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
