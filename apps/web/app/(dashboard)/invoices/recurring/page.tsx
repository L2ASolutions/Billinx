"use client";

import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { recurringInvoiceApi } from "@/lib/api";
import {
  RecurringInvoiceFormModal,
  RecurringScheduleRecord,
} from "./components/RecurringInvoiceFormModal";

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green/10 text-green",
  PAUSED: "bg-amber-50 text-amber-600",
  CANCELLED: "bg-gray-100 text-gray-500",
  COMPLETED: "bg-blue-50 text-blue-600",
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid="recurring-invoice-status"
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-500"}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export default function RecurringInvoicesPage() {
  const [schedules, setSchedules] = useState<RecurringScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editSchedule, setEditSchedule] = useState<RecurringScheduleRecord | undefined>();
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await recurringInvoiceApi.list();
      setSchedules(data as RecurringScheduleRecord[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load recurring invoices");
    } finally {
      setLoading(false);
    }
  }, []);

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditSchedule(undefined);
    setShowModal(true);
  }
  function openEdit(schedule: RecurringScheduleRecord) {
    setEditSchedule(schedule);
    setShowModal(true);
  }
  function closeModal() {
    setShowModal(false);
    setEditSchedule(undefined);
  }
  function afterSave() {
    closeModal();
    load();
  }

  async function handlePauseResume(schedule: RecurringScheduleRecord & { status?: string }) {
    setActioningId(schedule.id);
    try {
      if (schedule.status === "ACTIVE") {
        await recurringInvoiceApi.pause(schedule.id);
      } else {
        await recurringInvoiceApi.resume(schedule.id);
      }
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActioningId(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel this recurring invoice schedule? This cannot be undone.")) return;
    setActioningId(id);
    try {
      await recurringInvoiceApi.cancel(id);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setActioningId(null);
    }
  }

  return (
    <>
      <Topbar title="Recurring Invoices" />
      {showModal && (
        <RecurringInvoiceFormModal
          schedule={editSchedule}
          onClose={closeModal}
          onSave={afterSave}
        />
      )}

      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-dark">Recurring Invoices</h1>
            <p className="text-sm text-muted mt-0.5">
              Automate invoice generation for your regular clients
            </p>
          </div>
          <Button onClick={openAdd}>+ New Recurring Invoice</Button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 font-medium text-muted">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Buyer</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Frequency</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Next Run</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Status</th>
                <th className="text-center px-4 py-3 font-medium text-muted">Invoices Generated</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted">Loading…</td>
                </tr>
              )}

              {!loading && schedules.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="py-14 flex flex-col items-center text-center">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted mb-3">
                        <path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" />
                        <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" />
                      </svg>
                      <p className="text-sm font-semibold text-dark mb-1">
                        No recurring invoices set up yet.
                      </p>
                      <p className="text-sm text-muted mb-4">
                        Create one to automate your regular billing.
                      </p>
                      <button
                        onClick={openAdd}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-green text-white text-sm font-medium rounded-lg hover:bg-green/90 transition-colors"
                      >
                        + New Recurring Invoice
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {!loading &&
                schedules.map((schedule) => {
                  const s = schedule as RecurringScheduleRecord & {
                    status: string;
                    nextRunDate: string;
                    invoiceCount: number;
                  };
                  const busy = actioningId === s.id;
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-dark">{s.name}</td>
                      <td className="px-4 py-3 text-dark">{s.templateData?.buyer?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-dark">{FREQUENCY_LABELS[s.frequency] ?? s.frequency}</td>
                      <td className="px-4 py-3 text-muted">
                        {s.status === "ACTIVE" || s.status === "PAUSED" ? fmtDate(s.nextRunDate) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center bg-green/10 text-green font-semibold text-xs px-2 py-0.5 rounded-full min-w-[28px]">
                          {s.invoiceCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {(s.status === "ACTIVE" || s.status === "PAUSED") && (
                            <button
                              disabled={busy}
                              onClick={() => handlePauseResume(s)}
                              className="text-xs text-green hover:underline font-medium disabled:opacity-50"
                            >
                              {s.status === "ACTIVE" ? "Pause" : "Resume"}
                            </button>
                          )}
                          {(s.status === "ACTIVE" || s.status === "PAUSED") && (
                            <button
                              onClick={() => openEdit(s)}
                              className="text-xs text-dark hover:underline font-medium"
                            >
                              Edit
                            </button>
                          )}
                          {s.status !== "CANCELLED" && s.status !== "COMPLETED" && (
                            <button
                              disabled={busy}
                              onClick={() => handleCancel(s.id)}
                              className="text-xs text-red-500 hover:underline font-medium disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
