"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface ErasureRequest {
  id: string;
  userId?: string;
  tenantId?: string;
  email?: string;
  requestReason?: string;
  status: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-50 text-yellow-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
};

export default function AdminErasurePage() {
  const [requests, setRequests] = useState<ErasureRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await adminApi.erasureRequests(filterStatus || undefined);
      setRequests(res.data as ErasureRequest[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load erasure requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction() {
    if (!actionId || !actionType) return;
    setSubmitting(true);
    try {
      if (actionType === "approve") {
        await adminApi.approveErasure(actionId, reviewNote || undefined);
      } else {
        await adminApi.rejectErasure(actionId, reviewNote || undefined);
      }
      setActionId(null);
      setActionType(null);
      setReviewNote("");
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-dark">Erasure Requests (NDPA 2023)</h1>
        <span className="text-sm text-muted">{total} requests</span>
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
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
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
        ) : requests.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No erasure requests found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">User</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Reason</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Requested</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Review Note</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface">
                  <td className="px-6 py-3">
                    <p className="text-sm text-dark">{r.email ?? "—"}</p>
                    <p className="text-xs text-muted font-mono">{r.tenantId?.slice(0, 8) ?? "—"}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted max-w-xs">
                    <p className="truncate">{r.requestReason ?? "—"}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">{formatDateTime(r.createdAt)}</td>
                  <td className="px-6 py-3 text-sm text-muted">
                    {r.reviewNote ?? "—"}
                    {r.reviewedAt && <p className="text-xs">{formatDateTime(r.reviewedAt)}</p>}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {r.status === "PENDING" && (
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setActionId(r.id); setActionType("approve"); setReviewNote(""); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green text-white hover:bg-green/90"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => { setActionId(r.id); setActionType("reject"); setReviewNote(""); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Action Modal */}
      {actionId && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark capitalize">{actionType} Erasure Request</h2>
            </div>
            <div className="p-6 space-y-4">
              {actionType === "approve" && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  Approving will <strong>permanently anonymise</strong> the user&apos;s PII (name → &quot;Anonymized&quot;, email → hash). This cannot be undone.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Review Note (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={3}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Add a review note..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <button
                onClick={() => { setActionId(null); setActionType(null); }}
                className="px-4 py-2 rounded-lg border border-border text-dark text-sm font-medium hover:bg-surface"
              >
                Cancel
              </button>
              <button
                disabled={submitting}
                onClick={handleAction}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${actionType === "approve" ? "bg-green hover:bg-green/90" : "bg-red-500 hover:bg-red-600"} disabled:opacity-50`}
              >
                {submitting ? "Processing…" : `Confirm ${actionType === "approve" ? "Approval" : "Rejection"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
