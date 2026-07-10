"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface ConsentRecord {
  id: string;
  userId?: string;
  tenantId?: string;
  email?: string;
  consentType: string;
  consentVersion?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

const CONSENT_COLORS: Record<string, string> = {
  TERMS_AND_PRIVACY: "bg-blue-50 text-blue-700",
  NDPR_DATA_PROCESSING: "bg-purple-50 text-purple-700",
  BUSINESS_AUTHORISATION: "bg-green-50 text-green-700",
};

export default function AdminConsentPage() {
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterEmail, setFilterEmail] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (filterType) params.consentType = filterType;
      if (filterEmail) params.email = filterEmail;
      const res = await adminApi.consentRecords(params);
      setRecords(res.data as ConsentRecord[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load consent records");
    } finally {
      setLoading(false);
    }
  }

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-dark">Consent Records (NDPA 2023)</h1>
        <span className="text-sm text-muted">{total} records</span>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          className="px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="TERMS_AND_PRIVACY">Terms & Privacy</option>
          <option value="NDPR_DATA_PROCESSING">NDPR Data Processing</option>
          <option value="BUSINESS_AUTHORISATION">Business Authorisation</option>
        </select>
        <input
          className="px-3 py-2 rounded-lg border border-border text-dark text-sm"
          placeholder="Filter by email..."
          value={filterEmail}
          onChange={(e) => setFilterEmail(e.target.value)}
        />
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg bg-dark text-white text-sm font-medium hover:bg-dark/90"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No consent records found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Type</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Email</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Tenant</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Version</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">IP</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface">
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CONSENT_COLORS[r.consentType] ?? "bg-gray-100 text-gray-600"}`}>
                      {r.consentType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-dark">{r.email ?? "—"}</td>
                  <td className="px-6 py-3 text-sm text-muted font-mono text-xs">{r.tenantId?.slice(0, 8) ?? "—"}</td>
                  <td className="px-6 py-3 text-sm text-muted">{r.consentVersion ?? "—"}</td>
                  <td className="px-6 py-3 text-sm text-muted font-mono">{r.ipAddress ?? "—"}</td>
                  <td className="px-6 py-3 text-sm text-muted">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
