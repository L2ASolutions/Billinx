"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface ActivityEvent {
  id: string;
  eventType: string;
  actor: string;
  actorType: string;
  tenantId?: string;
  tenantName?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

const EVENT_COLORS: Record<string, string> = {
  LOGIN: "bg-blue-50 text-blue-700",
  LOGOUT: "bg-gray-100 text-gray-600",
  INVOICE_CREATED: "bg-green-50 text-green-700",
  INVOICE_ACCEPTED: "bg-green-50 text-green-700",
  INVOICE_REJECTED: "bg-red-50 text-red-600",
  API_KEY_CREATED: "bg-purple-50 text-purple-700",
  API_KEY_REVOKED: "bg-red-50 text-red-600",
  SYSTEM_ERROR: "bg-red-100 text-red-700",
};

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.activity({ page: String(page), limit: "50" });
      setEvents(res.data as ActivityEvent[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-dark">Platform Activity</h1>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-border">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No activity found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Time</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Event</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Actor</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Tenant</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                  <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">{formatDateTime(ev.occurredAt)}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${EVENT_COLORS[ev.eventType] ?? "bg-gray-100 text-gray-600"}`}>
                      {ev.eventType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-sm text-dark">{ev.actor}</p>
                    <p className="text-xs text-muted">{ev.actorType}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">{ev.tenantName ?? ev.tenantId?.slice(0, 8) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Showing {events.length} of {total}</span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border border-border bg-white text-dark text-sm disabled:opacity-50"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
            <button
              className="px-3 py-1.5 rounded-lg border border-border bg-white text-dark text-sm disabled:opacity-50"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
