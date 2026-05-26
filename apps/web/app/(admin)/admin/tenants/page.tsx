"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface Tenant {
  id: string;
  name: string;
  tin: string;
  appAdapterKey: string;
  environment: string;
  rateLimitTier: string;
  isActive: boolean;
  invoiceCount: number;
  userCount: number;
  createdAt: string;
}

const TIER_COLORS: Record<string, string> = {
  STANDARD: "bg-gray-100 text-gray-600",
  PREMIUM: "bg-blue-50 text-blue-700",
  ENTERPRISE: "bg-purple-50 text-purple-700",
};

const ENV_COLORS: Record<string, string> = {
  SANDBOX: "bg-yellow-50 text-yellow-700",
  PRODUCTION: "bg-green-50 text-green-700",
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminApi.tenants()
      .then((res) => setTenants(res.data as Tenant[]))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load tenants"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tenants.filter((t) =>
    t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.tin?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-dark">Tenants</h1>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      <div className="flex gap-3">
        <input
          className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green flex-1 max-w-xs placeholder:text-muted"
          placeholder="Search by name or TIN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-xl border border-border">
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted text-sm">No tenants found.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Tenant</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Adapter</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Tier</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Invoices</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-sm font-medium text-dark">{t.name}</p>
                    <p className="text-xs text-muted">TIN: {t.tin}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-sm text-dark">{t.appAdapterKey}</span>
                    <span className={`inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${ENV_COLORS[t.environment] ?? "bg-gray-100 text-gray-600"}`}>
                      {t.environment}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TIER_COLORS[t.rateLimitTier] ?? "bg-gray-100 text-gray-600"}`}>
                      {t.rateLimitTier}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-dark">{t.invoiceCount?.toLocaleString() ?? "—"}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${t.isActive ? "bg-green" : "bg-gray-300"}`} />
                      <span className="text-sm text-muted">{t.isActive ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
