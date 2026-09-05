"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { reportIssueManually } from "@/lib/errorReporting";

// Floating button on every authenticated dashboard page — the manual
// counterpart to the automatic capture in ErrorBoundary/GlobalErrorListeners.
// Uses the same capture-and-upload flow, with an optional free-text field
// for the user to add context.
export function ReportIssueButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  function submit() {
    reportIssueManually({
      errorMessage: "Manually reported issue",
      userDescription: description.trim() || undefined,
    });
    setOpen(false);
    setDescription("");
    setConfirmed(true);
    // Don't block on the upload — just let the toast auto-dismiss.
    setTimeout(() => setConfirmed(false), 5000);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Report an issue"
        className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-dark text-white shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10h.01" />
          <path d="M12 10h.01" />
          <path d="M16 10h.01" />
          <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5A8.38 8.38 0 0 1 8 19.4L3 21l1.6-5A8.38 8.38 0 0 1 3.5 12 8.5 8.5 0 0 1 12 3.5 8.5 8.5 0 0 1 21 12Z" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-dark">Report an issue</h2>
              <p className="text-sm text-muted mt-1">
                We&apos;ll capture a screenshot of this page and send it to
                our team along with your note below.
              </p>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What went wrong? (optional)"
              rows={4}
              maxLength={2000}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green/40"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit}>
                Send report
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmed && (
        <div className="fixed bottom-6 right-20 z-50 bg-dark text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          Issue reported, our team will look into it.
        </div>
      )}
    </>
  );
}
