"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { incomingInvoiceApi } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingInvoice {
  id: string;
  supplierName: string;
  supplierTin: string;
  invoiceNumber: string;
  invoiceAmount: number;
  vatAmount: number;
  currency: string;
  invoiceDate: string;
  dueDate?: string;
  status: string;
  description?: string;
  rejectionReason?: string;
  createdAt: string;
}

interface AddInvoiceForm {
  supplierName: string;
  supplierTin: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: string;
  vatAmount: string;
  currency: string;
  description: string;
}

const EMPTY_FORM: AddInvoiceForm = {
  supplierName: "",
  supplierTin: "",
  invoiceNumber: "",
  invoiceDate: "",
  dueDate: "",
  invoiceAmount: "",
  vatAmount: "0",
  currency: "NGN",
  description: "",
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: "ALL",       label: "All" },
  { key: "RECEIVED",  label: "Received" },
  { key: "VALIDATED", label: "Validated" },
  { key: "APPROVED",  label: "Approved" },
  { key: "PAID",      label: "Paid" },
  { key: "REJECTED",  label: "Rejected" },
] as const;

type StatusTab = typeof STATUS_TABS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  RECEIVED:  "bg-gray-100 text-gray-600",
  VALIDATED: "bg-blue-50 text-blue-600",
  APPROVED:  "bg-green-50 text-green-700",
  REJECTED:  "bg-red-50 text-red-600",
  PAID:      "bg-emerald-50 text-emerald-700",
};

// ── Add Invoice Modal ─────────────────────────────────────────────────────────

function AddInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<AddInvoiceForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const f =
    (field: keyof AddInvoiceForm) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit() {
    setError("");
    setSubmitting(true);
    try {
      await incomingInvoiceApi.create({
        supplierName: form.supplierName,
        supplierTin: form.supplierTin,
        invoiceNumber: form.invoiceNumber,
        invoiceDate: new Date(form.invoiceDate).toISOString(),
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        invoiceAmount: parseFloat(form.invoiceAmount),
        vatAmount: parseFloat(form.vatAmount) || 0,
        currency: form.currency,
        description: form.description || undefined,
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    form.supplierName &&
    form.supplierTin &&
    form.invoiceNumber &&
    form.invoiceDate &&
    form.invoiceAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-dark">Add invoice</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-dark transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <Input
            label="Supplier name *"
            value={form.supplierName}
            onChange={f("supplierName")}
            placeholder="e.g. Acme Supplies Ltd"
          />
          <Input
            label="Supplier TIN *"
            value={form.supplierTin}
            onChange={f("supplierTin")}
            placeholder="e.g. 12345678-0001"
          />
          <Input
            label="Invoice number *"
            value={form.invoiceNumber}
            onChange={f("invoiceNumber")}
            placeholder="e.g. INV-2026-001"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Invoice date *"
              type="date"
              value={form.invoiceDate}
              onChange={f("invoiceDate")}
            />
            <Input
              label="Due date"
              type="date"
              value={form.dueDate}
              onChange={f("dueDate")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Invoice amount (₦) *"
              type="number"
              value={form.invoiceAmount}
              onChange={f("invoiceAmount")}
              placeholder="0.00"
            />
            <Input
              label="VAT amount (₦)"
              type="number"
              value={form.vatAmount}
              onChange={f("vatAmount")}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">
              Currency
            </label>
            <select
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={form.currency}
              onChange={f("currency")}
            >
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
              rows={2}
              value={form.description}
              onChange={f("description")}
              placeholder="Optional description"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Add invoice
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IncomingInvoicesPage() {
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<StatusTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (activeTab !== "ALL") params.status = activeTab;
      const res = await incomingInvoiceApi.list(
        params as Parameters<typeof incomingInvoiceApi.list>[0],
      );
      setInvoices(res.data as IncomingInvoice[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load invoices",
      );
      setInvoices([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, activeTab]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleValidate(id: string) {
    setActionLoading(id);
    try {
      await incomingInvoiceApi.validate(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Validate failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      await incomingInvoiceApi.approve(id);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    const reason = prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionLoading(id);
    try {
      await incomingInvoiceApi.reject(id, reason);
      load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <Topbar
        title="Incoming invoices"
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Add invoice
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        <p className="text-sm text-muted -mt-2">
          Supplier invoices received by your business
        </p>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Filter tabs */}
          <div className="flex border-b border-border overflow-x-auto">
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setActiveTab(key);
                  setPage(1);
                }}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? "border-green text-green"
                    : "border-transparent text-muted hover:text-dark"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Table */}
          {loading ? (
            <div className="px-6 py-4 space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <SkeletonTableRow key={i} />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-muted"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div>
                <p className="text-dark font-medium">
                  No incoming invoices yet
                </p>
                <p className="text-sm text-muted mt-1">
                  Add your first supplier invoice
                </p>
              </div>
              <Button size="sm" onClick={() => setShowAdd(true)}>
                Add invoice
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Invoice #",
                      "Supplier",
                      "Date",
                      "Due Date",
                      "Amount",
                      "VAT",
                      "Status",
                      "",
                    ].map((col, i) => (
                      <th
                        key={col + i}
                        className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${
                          i === 4 || i === 5 ? "text-right" : "text-left"
                        }`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-border last:border-0 hover:bg-surface transition-colors"
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/incoming-invoices/${inv.id}`}
                          className="text-sm font-mono text-green hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-sm text-dark">{inv.supplierName}</p>
                        <p className="text-xs text-muted">TIN: {inv.supplierTin}</p>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                        {formatDate(inv.invoiceDate)}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted whitespace-nowrap">
                        {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-dark text-right">
                        {formatCurrency(inv.invoiceAmount, inv.currency)}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted text-right">
                        {formatCurrency(inv.vatAmount, inv.currency)}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/incoming-invoices/${inv.id}`}
                            className="text-xs font-medium text-green hover:underline"
                          >
                            View
                          </Link>
                          {inv.status === "RECEIVED" && (
                            <button
                              onClick={() => handleValidate(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            >
                              Validate
                            </button>
                          )}
                          {inv.status === "VALIDATED" && (
                            <button
                              onClick={() => handleApprove(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-green hover:text-green-dark disabled:opacity-50"
                            >
                              Approve
                            </button>
                          )}
                          {["RECEIVED", "VALIDATED", "APPROVED"].includes(
                            inv.status,
                          ) && (
                            <button
                              onClick={() => handleReject(inv.id)}
                              disabled={actionLoading === inv.id}
                              className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              Showing {invoices.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="px-3 py-1.5 text-dark">
                {page} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <AddInvoiceModal
          onClose={() => setShowAdd(false)}
          onCreated={load}
        />
      )}
    </>
  );
}
