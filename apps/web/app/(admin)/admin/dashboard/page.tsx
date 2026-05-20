"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface AdminStats {
  totalTenants: number;
  activeTenants: number;
  totalInvoices: number;
  invoicesToday: number;
  invoicesThisWeek: number;
  invoicesThisMonth: number;
  acceptanceRate: number;
  totalRevenue: number;
  openAccessRequests: number;
  systemErrors: number;
  webhookDeliveryRate: number;
}

function StatCard({ label, value, sub, accent }: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-5 ${accent ? "bg-green text-white border-green-dark" : "bg-white border-border"}`}>
      <p className={`text-sm mb-1 ${accent ? "text-white/70" : "text-muted"}`}>{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-white" : "text-dark"}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? "text-white/60" : "text-muted"}`}>{sub}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.dashboard()
      .then((data) => setStats(data as AdminStats))
      .catch(() => setError("Failed to load admin stats"));
  }, []);

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-dark">Platform Overview</h1>

      {!stats ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Active Tenants" value={stats.activeTenants} sub={`${stats.totalTenants} total`} accent />
            <StatCard label="Invoices Today" value={stats.invoicesToday} sub={`${stats.invoicesThisWeek} this week`} />
            <StatCard label="Acceptance Rate" value={`${stats.acceptanceRate?.toFixed(1)}%`} />
            <StatCard label="Open Access Requests" value={stats.openAccessRequests} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Invoices" value={stats.totalInvoices?.toLocaleString()} />
            <StatCard label="This Month" value={stats.invoicesThisMonth?.toLocaleString()} />
            <StatCard label="System Errors" value={stats.systemErrors ?? 0} />
            <StatCard label="Webhook Delivery Rate" value={`${stats.webhookDeliveryRate?.toFixed(1) ?? "—"}%`} />
          </div>
        </>
      )}
    </div>
  );
}
