"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface SupportTicketListItem {
  id: string;
  tenantId: string | null;
  tenantName?: string | null;
  userId: string | null;
  errorMessage: string;
  pageUrl: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
}

interface SupportTicketDetail extends SupportTicketListItem {
  stackTrace: string | null;
  browserInfo: string;
  userDescription: string | null;
  screenshotUrl: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-50 text-red-600",
  IN_PROGRESS: "bg-yellow-50 text-yellow-700",
  RESOLVED: "bg-green-50 text-green-700",
};

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export default function AdminSupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicketListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTenantId, setFilterTenantId] = useState("");

  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.supportTickets({
        status: filterStatus || undefined,
        tenantId: filterTenantId || undefined,
      });
      setTickets(res.data as SupportTicketListItem[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }

  // Standard fetch-on-mount pattern, matching the other admin list pages.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await adminApi.getSupportTicket(id);
      setDetail(res as SupportTicketDetail);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setDetailLoading(false);
    }
  }

  async function updateStatus(status: string) {
    if (!detail) return;
    setUpdating(true);
    try {
      await adminApi.updateSupportTicketStatus(detail.id, status);
      setDetail({ ...detail, status: status as SupportTicketDetail["status"] });
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-dark">Support Tickets</h1>
        <span className="text-sm text-muted">{total} tickets</span>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select
          className="px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          className="px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm"
          placeholder="Filter by tenant ID"
          value={filterTenantId}
          onChange={(e) => setFilterTenantId(e.target.value)}
        />
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg bg-dark text-white text-sm font-medium hover:bg-dark/90"
        >
          Filter
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No support tickets found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Tenant</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Error</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Created</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface">
                  <td className="px-6 py-3">
                    <p className="text-sm text-dark">{t.tenantName ?? (t.tenantId ? t.tenantId.slice(0, 8) : "Unauthenticated")}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted max-w-sm">
                    <p className="truncate">{t.errorMessage}</p>
                    <p className="text-xs truncate">{t.pageUrl}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">{formatDateTime(t.createdAt)}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => openDetail(t.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface text-dark border border-border hover:bg-border"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail modal */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {detailLoading || !detail ? (
              <div className="p-12 flex justify-center">
                <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                  <h2 className="font-semibold text-dark">Support Ticket</h2>
                  <button
                    onClick={() => setDetail(null)}
                    className="text-muted hover:text-dark text-sm"
                  >
                    Close
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">Tenant</p>
                      <p className="text-dark">{detail.tenantName ?? detail.tenantId ?? "Unauthenticated"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">User ID</p>
                      <p className="text-dark font-mono text-xs">{detail.userId ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">Page URL</p>
                      <p className="text-dark break-all">{detail.pageUrl}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">Browser</p>
                      <p className="text-dark break-all">{detail.browserInfo}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">Created</p>
                      <p className="text-dark">{formatDateTime(detail.createdAt)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide mb-1">Error</p>
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{detail.errorMessage}</p>
                  </div>

                  {detail.stackTrace && (
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">Stack Trace</p>
                      <pre className="text-xs text-dark bg-surface border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{detail.stackTrace}</pre>
                    </div>
                  )}

                  {detail.userDescription && (
                    <div>
                      <p className="text-xs text-muted uppercase tracking-wide mb-1">User Note</p>
                      <p className="text-sm text-dark">{detail.userDescription}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide mb-1">Screenshot</p>
                    {detail.screenshotUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={detail.screenshotUrl}
                        alt="Error screenshot"
                        className="rounded-lg border border-border max-h-96 w-auto"
                      />
                    ) : (
                      <p className="text-sm text-muted">No screenshot available (S3 not configured in this environment).</p>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-muted uppercase tracking-wide mb-2">Status</p>
                    <div className="flex gap-2">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={updating || detail.status === s}
                          onClick={() => updateStatus(s)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50 ${
                            detail.status === s
                              ? `${STATUS_COLORS[s]} border-transparent`
                              : "bg-white text-dark border-border hover:bg-surface"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
