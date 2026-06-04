"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { api, inventoryApi, referenceApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

interface StockProduct {
  id: string;
  name: string;
  hsnCode?: string;
  stockQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  stockUnit?: string;
  supplierEmail?: string;
  supplierName?: string;
  lastRestockedAt?: string;
  status: StockStatus;
}

interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: string;
}

const STATUS_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};

const STATUS_CLASS: Record<StockStatus, string> = {
  IN_STOCK: "bg-green-50 text-green-700",
  LOW_STOCK: "bg-amber-50 text-amber-700",
  OUT_OF_STOCK: "bg-red-50 text-red-600",
};

const MOVEMENT_CLASS: Record<string, string> = {
  SALE: "bg-red-50 text-red-600",
  PURCHASE: "bg-green-50 text-green-700",
  ADJUSTMENT: "bg-blue-50 text-blue-700",
  OPENING: "bg-gray-100 text-gray-600",
  RETURN: "bg-green-50 text-green-700",
  WRITE_OFF: "bg-red-50 text-red-600",
};

type FilterTab = "ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

// ── Adjust Modal ──────────────────────────────────────────────────────────────

function AdjustModal({
  product,
  onClose,
  onSuccess,
}: {
  product: StockProduct;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("ADJUSTMENT");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const unit = product.stockUnit ?? "units";
  const current = product.stockQuantity;

  function preview(): number {
    const n = parseFloat(qty) || 0;
    if (mode === "add") return current + n;
    if (mode === "remove") return current - n;
    return n;
  }

  async function handleSubmit() {
    const n = parseFloat(qty) || 0;
    if (n <= 0) { setError("Enter a valid quantity"); return; }
    setSaving(true);
    setError("");
    try {
      let quantity = n;
      if (mode === "remove") quantity = -n;
      if (mode === "set") quantity = n - current;
      await inventoryApi.adjust(product.id, { quantity, type: reason, notes: notes || undefined });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setSaving(false);
    }
  }

  const newBalance = preview();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Adjust Stock — {product.name}</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          <div className="p-3 bg-surface rounded-lg text-sm text-dark">
            Current stock: <span className="font-semibold">{current} {unit}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Adjustment type</label>
            <div className="flex gap-2">
              {(["add", "remove", "set"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    mode === m ? "bg-green text-white border-green" : "border-border text-muted hover:text-dark"
                  }`}>
                  {m === "add" ? "Add" : m === "remove" ? "Remove" : "Set to exact"}
                </button>
              ))}
            </div>
          </div>
          <Input label={`Quantity (${unit})`} type="number" min="0" step="0.01"
            value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Reason</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
              value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="PURCHASE">Received goods</option>
              <option value="WRITE_OFF">Damaged / write-off</option>
              <option value="ADJUSTMENT">Stock count correction</option>
              <option value="OPENING">Opening balance</option>
              <option value="RETURN">Customer return</option>
            </select>
          </div>
          <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional note…" />
          {qty && parseFloat(qty) > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              Stock will change from <strong>{current}</strong> to <strong>{newBalance}</strong> {unit}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!qty || parseFloat(qty) <= 0} onClick={handleSubmit}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────

function HistoryModal({ product, onClose }: { product: StockProduct; onClose: () => void }) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    inventoryApi.movements(product.id, { page, limit: 20 })
      .then((r) => {
        setMovements(r.data as StockMovement[]);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [product.id, page]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Movement History — {product.name}</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 space-y-2">{[0,1,2,3].map(i => <SkeletonTableRow key={i} />)}</div>
          ) : movements.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted">No movements recorded yet.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Date", "Type", "Change", "Balance", "Reference"].map((col, i) => (
                    <th key={col} className={`px-5 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i >= 2 ? "text-right" : "text-left"}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-sm text-dark">{formatDate(m.createdAt)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${MOVEMENT_CLASS[m.type] ?? "bg-gray-100 text-gray-600"}`}>
                        {m.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm font-medium text-right">
                      <span className={Number(m.quantity) >= 0 ? "text-green-700" : "text-red-600"}>
                        {Number(m.quantity) >= 0 ? "+" : ""}{Number(m.quantity)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-dark text-right">{Number(m.balanceAfter)}</td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {m.referenceType ? `${m.referenceType}` : m.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between text-sm text-muted">
            <span>{total} movements</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [inventoryEnabled, setInventoryEnabled] = useState<boolean | null>(null);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const [alertCount, setAlertCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adjustProduct, setAdjustProduct] = useState<StockProduct | null>(null);
  const [historyProduct, setHistoryProduct] = useState<StockProduct | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);

  useEffect(() => {
    api.get<any>('/v1/tenants/me')
      .then((t) => setInventoryEnabled(!!t?.inventoryEnabled))
      .catch(() => setInventoryEnabled(false));
  }, []);

  const load = useCallback(async () => {
    if (!inventoryEnabled) return;
    setLoading(true);
    try {
      const params: { lowStock?: boolean; page: number; limit: number } = { page, limit: 20 };
      if (filter === "LOW_STOCK") params.lowStock = true;
      const res = await inventoryApi.list(params);
      let data = res.data as StockProduct[];
      if (filter === "IN_STOCK") data = data.filter(p => p.status === "IN_STOCK");
      if (filter === "OUT_OF_STOCK") data = data.filter(p => p.status === "OUT_OF_STOCK");
      setProducts(data);
      setTotal(filter === "ALL" ? res.total : data.length);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [inventoryEnabled, page, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!inventoryEnabled) return;
    inventoryApi.alerts().then((r) => setAlertCount(r.total)).catch(() => {});
  }, [inventoryEnabled]);

  async function handleReorder(product: StockProduct) {
    setReordering(product.id);
    try {
      await inventoryApi.reorder(product.id);
      alert(`Reorder request sent to ${product.supplierEmail}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Reorder failed");
    } finally {
      setReordering(null);
    }
  }

  // Stats
  const inStock = products.filter(p => p.status === "IN_STOCK").length;
  const lowStock = products.filter(p => p.status === "LOW_STOCK").length;
  const outOfStock = products.filter(p => p.status === "OUT_OF_STOCK").length;

  if (inventoryEnabled === null) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!inventoryEnabled) {
    return (
      <>
        <Topbar title="Inventory" />
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-dark mb-1">Inventory tracking is not enabled</h2>
          <p className="text-sm text-muted mb-5">Enable it in Settings → Features to start tracking stock levels.</p>
          <Link href="/settings?tab=features">
            <Button>Go to Settings →</Button>
          </Link>
        </div>
      </>
    );
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <div className="bg-white border-b border-border px-6 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-dark">Inventory</h1>
          <p className="text-sm text-muted mt-0.5">Track stock levels and reorder points</p>
        </div>
        <Button onClick={() => setAdjustProduct(products[0] ?? null)}>Adjust stock</Button>
      </div>

      <div className="p-6 space-y-4">
        {/* Low stock banner */}
        {alertCount > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-sm font-medium text-amber-700">{alertCount} product{alertCount !== 1 ? "s" : ""} are below reorder point</span>
            </div>
            <button onClick={() => setFilter("LOW_STOCK")} className="text-xs font-medium text-amber-700 hover:underline">
              View low stock →
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Products", value: total, color: "text-dark" },
            { label: "In Stock", value: inStock, color: "text-green-700" },
            { label: "Low Stock", value: lowStock, color: "text-amber-700" },
            { label: "Out of Stock", value: outOfStock, color: "text-red-600" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-border p-4">
              <p className="text-xs text-muted uppercase tracking-wide font-medium mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex border-b border-border px-4">
            {(["ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"] as FilterTab[]).map((tab) => (
              <button key={tab} onClick={() => { setFilter(tab); setPage(1); }}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  filter === tab ? "border-green text-green" : "border-transparent text-muted hover:text-dark"
                }`}>
                {tab === "ALL" ? "All" : tab === "IN_STOCK" ? "In Stock" : tab === "LOW_STOCK" ? "Low Stock" : "Out of Stock"}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="px-6 py-4 space-y-2">{[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}</div>
          ) : products.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted text-sm">No products found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Product", "Unit", "In Stock", "Reorder Point", "Status", "Last Restocked", "Actions"].map((col, i) => (
                      <th key={col + i} className={`px-5 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i >= 2 && i <= 3 ? "text-right" : i === 4 ? "text-center" : i === 6 ? "text-right" : "text-left"}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-dark">{p.name}</p>
                        {p.hsnCode && <p className="text-xs text-muted font-mono mt-0.5">{p.hsnCode}</p>}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted">{p.stockUnit ?? "—"}</td>
                      <td className="px-5 py-3 text-sm font-semibold text-dark text-right">{p.stockQuantity}</td>
                      <td className="px-5 py-3 text-sm text-muted text-right">{p.reorderPoint}</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASS[p.status]}`}>
                          {STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-muted">
                        {p.lastRestockedAt ? formatDate(p.lastRestockedAt) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {(p.status === "LOW_STOCK" || p.status === "OUT_OF_STOCK") && p.supplierEmail && (
                            <button
                              disabled={reordering === p.id}
                              onClick={() => handleReorder(p)}
                              className="text-xs font-medium text-amber-700 hover:underline disabled:opacity-50"
                            >
                              {reordering === p.id ? "Sending…" : "Reorder"}
                            </button>
                          )}
                          <button
                            onClick={() => setAdjustProduct(p)}
                            className="text-xs font-medium text-green hover:underline"
                          >
                            Adjust
                          </button>
                          <button
                            onClick={() => setHistoryProduct(p)}
                            className="text-xs font-medium text-muted hover:text-dark hover:underline"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Showing {products.length} of {total}</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="px-3 py-1.5 text-dark">{page} / {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {adjustProduct && (
        <AdjustModal product={adjustProduct} onClose={() => setAdjustProduct(null)} onSuccess={load} />
      )}
      {historyProduct && (
        <HistoryModal product={historyProduct} onClose={() => setHistoryProduct(null)} />
      )}
    </>
  );
}
