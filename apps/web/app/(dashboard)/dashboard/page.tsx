"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { invoiceApi } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Stats {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  overdue?: number;
  totalAmount: number;
  recentInvoices: Array<{
    id: string;
    platformIrn: string;
    buyerName: string;
    totalAmount: number;
    currency: string;
    status: string;
    isOverdue?: boolean;
    createdAt: string;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
  DRAFT: "bg-gray-100 text-gray-600",
  QUEUED: "bg-blue-50 text-blue-600",
  SUBMITTING: "bg-yellow-50 text-yellow-700",
  VALIDATION_FAILED: "bg-red-50 text-red-600",
  SUBMISSION_FAILED: "bg-red-50 text-red-600",
  DEAD_LETTERED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  VALIDATING: "bg-blue-50 text-blue-600",
};

function StatCard({
  label,
  value,
  sub,
  color,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  href?: string;
}) {
  const inner = (
    <div className={`bg-white rounded-xl border border-border p-5 ${href ? "hover:border-green/40 transition-colors" : ""}`}>
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-dark"}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function DashboardPage() {
  const { isLoading } = useRequireAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    invoiceApi.stats()
      .then((data) => {
        setStats(data as Stats);
        setLoadError("");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load dashboard data";
        setLoadError(msg);
        // Set empty stats so the page renders zeros instead of blank
        setStats({ total: 0, accepted: 0, rejected: 0, pending: 0, totalAmount: 0, recentInvoices: [] });
      })
      .finally(() => setDataLoaded(true));
  }, [isLoading]);

  const overdue = stats?.overdue ?? 0;

  return (
    <>
      <Topbar
        title="Dashboard"
        actions={
          <Link href="/invoices/new">
            <Button size="sm">+ New Invoice</Button>
          </Link>
        }
      />

      <div className="p-6 space-y-6">
        {loadError && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800 flex items-center justify-between">
            <span>{loadError}</span>
            <button
              className="text-xs font-medium underline"
              onClick={() => {
                setDataLoaded(false);
                invoiceApi.stats()
                  .then((d) => { setStats(d as Stats); setLoadError(""); })
                  .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Failed"))
                  .finally(() => setDataLoaded(true));
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Invoices" value={stats?.total ?? 0} />
          <StatCard
            label="Accepted"
            value={stats?.accepted ?? 0}
            sub={stats && stats.total > 0
              ? `${Math.round((stats.accepted / stats.total) * 100)}% acceptance rate`
              : "No invoices yet"}
            color="text-green-700"
          />
          <StatCard label="Pending" value={stats?.pending ?? 0} />
          <StatCard
            label="Total Value"
            value={stats ? formatCurrency(stats.totalAmount) : "₦0.00"}
          />
        </div>

        {/* Overdue alert */}
        {overdue > 0 && (
          <Link href="/payments?filter=OVERDUE">
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-red-700">{overdue} overdue invoice{overdue !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-red-500">Payment is past due — click to view</p>
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          </Link>
        )}

        {/* Recent invoices */}
        <div className="bg-white rounded-xl border border-border">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-dark">Recent Invoices</h2>
            <Link href="/invoices" className="text-sm text-green hover:underline">View all</Link>
          </div>

          {!dataLoaded && !loadError ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : !stats?.recentInvoices?.length ? (
            <div className="p-12 text-center">
              <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-muted text-sm mb-3">No invoices yet.</p>
              <Link href="/invoices/new">
                <Button size="sm">Create your first invoice</Button>
              </Link>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">IRN</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Buyer</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentInvoices.map((inv) => (
                  <tr key={inv.id} className={`border-b border-border last:border-0 transition-colors ${inv.isOverdue ? "bg-red-50/30 hover:bg-red-50/50" : "hover:bg-surface"}`}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline">
                          {inv.platformIrn?.slice(0, 20) ?? inv.id.slice(0, 8)}…
                        </Link>
                        {inv.isOverdue && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Overdue</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                    <td className="px-6 py-3 text-sm text-dark font-medium">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {inv.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{formatDate(inv.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
