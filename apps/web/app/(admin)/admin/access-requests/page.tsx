"use client";

import { useEffect, useState, FormEvent } from "react";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDate } from "@/lib/utils";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

interface AccessRequest {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  useCase?: string;
  status: RequestStatus;
  createdAt: string;
}

const STATUS_COLORS: Record<RequestStatus, string> = {
  PENDING: "bg-yellow-50 text-yellow-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
};

const TABS: Array<{ label: string; value: string }> = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
];

export default function AccessRequestsPage() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("PENDING");
  const [selected, setSelected] = useState<AccessRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveForm, setApproveForm] = useState({ adapter: "mock", environment: "test" });
  const [actioning, setActioning] = useState(false);

  async function load(status: string) {
    setLoading(true);
    try {
      const res = await adminApi.accessRequests(status);
      setRequests(res.data as AccessRequest[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(activeTab); }, [activeTab]);

  async function handleApprove(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setActioning(true);
    try {
      await adminApi.approveRequest(selected.id, approveForm);
      setSelected(null);
      load(activeTab);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setActioning(false);
    }
  }

  async function handleReject() {
    if (!selected || !rejectReason) return;
    setActioning(true);
    try {
      await adminApi.rejectRequest(selected.id, rejectReason);
      setSelected(null);
      load(activeTab);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setActioning(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold text-dark">Access Requests</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.value ? "bg-green text-white" : "bg-white border border-border text-muted hover:text-dark"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Approve modal */}
      {selected && activeTab === "PENDING" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-border p-6 w-full max-w-md">
            <h2 className="font-semibold text-dark mb-2">Review: {selected.companyName}</h2>
            <div className="text-sm text-muted space-y-1 mb-6">
              <p><strong className="text-dark">Contact:</strong> {selected.contactName}</p>
              <p><strong className="text-dark">Email:</strong> {selected.email}</p>
              {selected.useCase && <p><strong className="text-dark">Use case:</strong> {selected.useCase}</p>}
            </div>

            <form onSubmit={handleApprove} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Adapter</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={approveForm.adapter}
                  onChange={(e) => setApproveForm((f) => ({ ...f, adapter: e.target.value }))}
                >
                  <option value="mock">Mock (development)</option>
                  <option value="interswitch">Interswitch (production)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Environment</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={approveForm.environment}
                  onChange={(e) => setApproveForm((f) => ({ ...f, environment: e.target.value }))}
                >
                  <option value="test">Test</option>
                  <option value="production">Production</option>
                </select>
              </div>

              <div className="flex gap-3">
                <Button type="submit" loading={actioning} className="flex-1">Approve & Provision</Button>
                <Button type="button" variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
              </div>
            </form>

            <hr className="my-4 border-border" />

            <div className="space-y-2">
              <p className="text-sm font-medium text-dark">Reject instead</p>
              <Input
                placeholder="Reason for rejection"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <Button
                variant="danger"
                className="w-full"
                onClick={handleReject}
                disabled={!rejectReason}
                loading={actioning}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-border">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No {activeTab.toLowerCase()} requests.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Company</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Contact</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Applied</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-sm font-medium text-dark">{req.companyName}</p>
                    <p className="text-xs text-muted">{req.email}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-dark">{req.contactName}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status]}`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">{formatDate(req.createdAt)}</td>
                  <td className="px-6 py-3 text-right">
                    {req.status === "PENDING" && (
                      <Button size="sm" variant="secondary" onClick={() => setSelected(req)}>
                        Review
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
