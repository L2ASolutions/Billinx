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
  totalAmount: number;
  recentInvoices: Array<{
    id: string;
    platformIrn: string;
    buyerName: string;
    totalAmount: number;
    currency: string;
    status: string;
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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <p className="text-sm text-muted mb-1">{label}</p>
      <p className="text-2xl font-bold text-dark">{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  // Defense-in-depth: redirect to /login if the token is missing or expired.
  // The (dashboard) layout also does this, but calling it here catches any
  // case where the token expires after the layout has already rendered.
  const { isLoading } = useRequireAuth();

  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLoading) return; // wait for auth check before firing API calls
    invoiceApi.stats()
      .then((data) => setStats(data as Stats))
      .catch(() => setError("Failed to load dashboard data"));
  }, [isLoading]);

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
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Invoices" value={stats?.total ?? "—"} />
          <StatCard
            label="Accepted"
            value={stats?.accepted ?? "—"}
            sub={stats ? `${Math.round((stats.accepted / Math.max(stats.total, 1)) * 100)}% acceptance rate` : undefined}
          />
          <StatCard label="Pending" value={stats?.pending ?? "—"} />
          <StatCard
            label="Total Value"
            value={stats ? formatCurrency(stats.totalAmount) : "—"}
          />
        </div>

        {/* Recent invoices */}
        <div className="bg-white rounded-xl border border-border">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-dark">Recent Invoices</h2>
            <Link href="/invoices" className="text-sm text-green hover:underline">
              View all
            </Link>
          </div>

          {!stats ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : stats.recentInvoices?.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">
              No invoices yet.{" "}
              <Link href="/invoices/new" className="text-green hover:underline">
                Create your first invoice
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
                {stats.recentInvoices?.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-6 py-3">
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline">
                        {inv.platformIrn?.slice(0, 20) ?? inv.id.slice(0, 8)}…
                      </Link>
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
