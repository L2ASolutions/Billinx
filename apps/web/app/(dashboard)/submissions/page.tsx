"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { invoiceApi } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const SUBMISSION_STATUSES = ["QUEUED", "SUBMITTING", "ACCEPTED", "REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED"];

const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-600",
  QUEUED: "bg-blue-50 text-blue-600",
  SUBMITTING: "bg-yellow-50 text-yellow-700",
  SUBMISSION_FAILED: "bg-red-50 text-red-600",
  DEAD_LETTERED: "bg-red-100 text-red-700",
};

interface Invoice {
  id: string;
  platformIrn: string;
  buyerName: string;
  status: string;
  updatedAt: string;
  createdAt: string;
}

export default function SubmissionsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (activeStatus !== "ALL") params.status = activeStatus;
      const res = await invoiceApi.list(params);
      setInvoices(res.data as Invoice[]);
    } finally {
      setLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Topbar title="Submissions" />
      <div className="p-6 space-y-4">
        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          {["ALL", ...SUBMISSION_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setActiveStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeStatus === s
                  ? "bg-green text-white"
                  : "bg-white border border-border text-muted hover:text-dark"
              }`}
            >
              {s === "ALL" ? "All" : s.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-border">
          {loading ? (
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-muted text-sm">No submissions found.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">IRN</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Buyer</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-6 py-3">
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-mono text-green hover:underline">
                        {inv.platformIrn?.slice(0, 24) ?? inv.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-sm text-dark">{inv.buyerName}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {inv.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{formatDateTime(inv.updatedAt)}</td>
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
