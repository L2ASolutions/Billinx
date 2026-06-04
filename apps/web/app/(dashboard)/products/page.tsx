"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { productApi, referenceApi, api } from "@/lib/api";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { formatCurrency } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  description?: string;
  hsnCode?: string;
  isicCode?: string;
  productCategory?: string;
  unitPrice: number;
  currency: string;
  taxCategoryId?: string;
  isActive: boolean;
  stockQuantity?: number;
  reorderPoint?: number;
  reorderQuantity?: number;
  stockUnit?: string;
  supplierName?: string;
  supplierEmail?: string;
  createdAt: string;
}

interface ProductForm {
  itemType: "product" | "service";
  name: string;
  description: string;
  hsnCode: string;
  isicCode: string;
  productCategory: string;
  unitPrice: string;
  currency: string;
  taxCategoryId: string;
  stockQuantity: string;
  reorderPoint: string;
  reorderQuantity: string;
  stockUnit: string;
  supplierName: string;
  supplierEmail: string;
}

const EMPTY_FORM: ProductForm = {
  itemType: "product",
  name: "",
  description: "",
  hsnCode: "",
  isicCode: "",
  productCategory: "",
  unitPrice: "",
  currency: "NGN",
  taxCategoryId: "S",
  stockQuantity: "0",
  reorderPoint: "0",
  reorderQuantity: "0",
  stockUnit: "",
  supplierName: "",
  supplierEmail: "",
};

// Maps any stored taxCategoryId to a display label
const TAX_CODE_LABEL: Record<string, string> = {
  S: "Standard VAT (7.5%)", Z: "Zero-rated (0%)", E: "Exempt",
  O: "Outside scope", WHT: "Withholding Tax",
  STANDARD: "Standard VAT (7.5%)", STANDARD_VAT: "Standard VAT (7.5%)",
  ZERO_RATED: "Zero-rated (0%)", EXEMPT: "Exempt", WITHHOLDING: "Withholding Tax",
};

function taxLabel(id?: string): string {
  if (!id) return "—";
  return TAX_CODE_LABEL[id] ?? id.replace(/_/g, " ");
}

// Normalise legacy stored values to FIRS code
function normaliseTax(raw?: string): string {
  if (!raw) return "S";
  const u = raw.toUpperCase().replace(/[-_ ]/g, "");
  if (u === "STANDARD" || u === "STANDARDVAT" || u === "S") return "S";
  if (u === "ZERORATED" || u === "ZERO" || u === "Z") return "Z";
  if (u === "EXEMPT" || u === "E") return "E";
  if (u === "OUTSIDESCOPE" || u === "OUTSIDE" || u === "O") return "O";
  if (u === "WHT" || u === "WITHHOLDING") return "WHT";
  return "S";
}

// ── Code search ───────────────────────────────────────────────────────────────

function CodeSearch({ type, value, onSelect }: {
  type: "hs" | "service";
  value: string;
  onSelect: (code: string, description: string) => void;
}) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState<{ code: string; description: string }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function handleInput(q: string) {
    setQuery(q);
    setOpen(false);
    clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = type === "hs"
          ? await referenceApi.hsCodes(q)
          : await referenceApi.serviceCodes(q);
        setResults(res.data ?? []);
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
  }

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";

  return (
    <div className="relative">
      <input
        className={inp}
        placeholder={type === "hs" ? "Search by code or description…" : "Search by code or description…"}
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-xl max-h-44 overflow-y-auto text-sm">
          {results.map((r) => (
            <button
              key={r.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="w-full text-left px-3 py-2 hover:bg-surface border-b border-border last:border-0"
              onClick={() => {
                onSelect(r.code, r.description);
                setQuery(`${r.code} — ${r.description}`);
                setOpen(false);
              }}
            >
              <span className="font-mono font-medium">{r.code}</span>
              <span className="text-muted ml-1">— {r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [inventoryEnabled, setInventoryEnabled] = useState(false);
  const [invSectionOpen, setInvSectionOpen] = useState(true);

  const [taxCategories, setTaxCategories] = useState<{ code: string; value: string }[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await productApi.list(search ? { search } : undefined);
      setProducts(res.data as Product[]);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load products");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    referenceApi.taxCategories().then(setTaxCategories).catch(() => {});
    api.get<any>('/v1/tenants/me').then((t) => setInventoryEnabled(!!t?.inventoryEnabled)).catch(() => {});
  }, []);

  function openCreate() {
    setEditProduct(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setEditProduct(p);
    const hasIsic = !!p.isicCode && !p.hsnCode;
    setForm({
      itemType: hasIsic ? "service" : "product",
      name: p.name,
      description: p.description ?? "",
      hsnCode: p.hsnCode ?? "",
      isicCode: p.isicCode ?? "",
      productCategory: p.productCategory ?? "",
      unitPrice: String(p.unitPrice),
      currency: p.currency ?? "NGN",
      taxCategoryId: normaliseTax(p.taxCategoryId),
      stockQuantity: String(p.stockQuantity ?? 0),
      reorderPoint: String(p.reorderPoint ?? 0),
      reorderQuantity: String(p.reorderQuantity ?? 0),
      stockUnit: p.stockUnit ?? "",
      supplierName: p.supplierName ?? "",
      supplierEmail: p.supplierEmail ?? "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSubmit() {
    setFormError("");
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        name: form.name,
        description: form.description || undefined,
        hsnCode: form.itemType === "product" ? (form.hsnCode || undefined) : undefined,
        isicCode: form.itemType === "service" ? (form.isicCode || undefined) : undefined,
        productCategory: form.productCategory || undefined,
        unitPrice: parseFloat(form.unitPrice),
        currency: form.currency,
        taxCategoryId: form.taxCategoryId || "S",
      };
      if (inventoryEnabled) {
        payload.stockQuantity = parseFloat(form.stockQuantity) || 0;
        payload.reorderPoint = parseFloat(form.reorderPoint) || 0;
        payload.reorderQuantity = parseFloat(form.reorderQuantity) || 0;
        payload.stockUnit = form.stockUnit || undefined;
        payload.supplierName = form.supplierName || undefined;
        payload.supplierEmail = form.supplierEmail || undefined;
      }
      if (editProduct) {
        await productApi.update(editProduct.id, payload);
      } else {
        await productApi.create(payload);
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await productApi.delete(id);
      setProducts((p) => p.filter((x) => x.id !== id));
      setTotal((t) => t - 1);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const sel = "w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";

  const TAX_RATE: Record<string, number> = { S: 7.5, Z: 0, E: 0, O: 0, WHT: 0 };

  return (
    <>
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-5 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-dark">Products</h1>
          <p className="text-sm text-muted mt-0.5">
            {loading ? "Loading…" : `${total} product${total !== 1 ? "s" : ""} in catalog`}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add product
        </Button>
      </header>

      <div className="p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* Search */}
        <div className="mb-4 max-w-xs">
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="px-6 py-4 space-y-2">
              {[0,1,2,3,4].map(i => <SkeletonTableRow key={i} />)}
            </div>
          ) : products.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <div>
                <p className="text-dark font-medium">No products yet</p>
                <p className="text-sm text-muted mt-1">Add your first product to use in invoices</p>
              </div>
              <Button size="sm" onClick={openCreate}>Add product</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Name</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden sm:table-cell">Code</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden md:table-cell">Category</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Unit Price</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden lg:table-cell">Tax</th>
                    {inventoryEnabled && (
                      <>
                        <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right hidden xl:table-cell">Stock</th>
                        <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-center hidden xl:table-cell">Status</th>
                      </>
                    )}
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface/40 transition-colors">
                      <td className="px-5 py-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-dark">{p.name}</span>
                            {!p.isActive && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400">Inactive</span>
                            )}
                          </div>
                          {p.description && (
                            <p className="text-xs text-muted mt-0.5 line-clamp-1 max-w-xs">{p.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 hidden sm:table-cell">
                        {(p.hsnCode || p.isicCode) ? (
                          <span className="font-mono text-xs text-dark bg-surface px-2 py-0.5 rounded border border-border">
                            {p.hsnCode ?? p.isicCode}
                          </span>
                        ) : (
                          <span className="text-muted text-sm">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 hidden md:table-cell">
                        {p.productCategory ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">{p.productCategory}</span>
                        ) : (
                          <span className="text-muted text-sm">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="text-sm font-semibold text-dark">{formatCurrency(p.unitPrice, p.currency)}</span>
                      </td>
                      <td className="px-5 py-4 hidden lg:table-cell">
                        <span className="text-sm text-muted">{taxLabel(p.taxCategoryId)}</span>
                      </td>
                      {inventoryEnabled && (
                        <>
                          <td className="px-5 py-4 text-right hidden xl:table-cell text-sm text-dark">
                            {p.stockQuantity ?? 0}{p.stockUnit ? ` ${p.stockUnit}` : ""}
                          </td>
                          <td className="px-5 py-4 text-center hidden xl:table-cell">
                            {(p.stockQuantity ?? 0) === 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">Out</span>
                            ) : (p.stockQuantity ?? 0) <= (p.reorderPoint ?? 0) ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">Low</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">In Stock</span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(p)}
                            className="text-xs font-medium text-green hover:text-green-dark transition-colors px-2 py-1 rounded hover:bg-green/5"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.name)}
                            disabled={deletingId === p.id}
                            className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingId === p.id ? "Deleting…" : "Delete"}
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
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="font-semibold text-dark">{editProduct ? "Edit product" : "Add product"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-dark transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>
              )}

              {/* Product / Service toggle */}
              <div>
                <label className="block text-sm font-medium text-dark mb-1.5">Product type</label>
                <div className="flex rounded-lg border border-border overflow-hidden w-fit">
                  <button
                    type="button"
                    className={`px-4 py-2 text-sm transition-colors ${form.itemType === "product" ? "bg-green text-white font-medium" : "bg-white text-muted hover:bg-surface"}`}
                    onClick={() => setForm((f) => ({ ...f, itemType: "product", isicCode: "" }))}
                  >
                    Product
                  </button>
                  <button
                    type="button"
                    className={`px-4 py-2 text-sm border-l border-border transition-colors ${form.itemType === "service" ? "bg-green text-white font-medium" : "bg-white text-muted hover:bg-surface"}`}
                    onClick={() => setForm((f) => ({ ...f, itemType: "service", hsnCode: "" }))}
                  >
                    Service
                  </button>
                </div>
              </div>

              {/* Code search */}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">
                  {form.itemType === "product" ? "HS Code (Product)" : "Service Code"}
                </label>
                <CodeSearch
                  key={form.itemType}
                  type={form.itemType === "product" ? "hs" : "service"}
                  value={form.itemType === "product" ? form.hsnCode : form.isicCode}
                  onSelect={(code, description) => {
                    setForm((f) => ({
                      ...f,
                      hsnCode: f.itemType === "product" ? code : f.hsnCode,
                      isicCode: f.itemType === "service" ? code : f.isicCode,
                      productCategory: f.productCategory || description,
                    }));
                  }}
                />
                <p className="text-xs text-muted mt-1">
                  {form.itemType === "product"
                    ? "Search HS tariff codes (e.g. rice, petroleum, textiles)"
                    : "Search ISIC service codes (e.g. consultancy, transport, software)"}
                </p>
              </div>

              {/* Product name */}
              <Input
                label="Product name *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Consulting Services"
                required
              />

              {/* Category — auto-filled from code selection */}
              <Input
                label="Category"
                value={form.productCategory}
                onChange={(e) => setForm((f) => ({ ...f, productCategory: e.target.value }))}
                placeholder="Auto-filled from code selection or type manually"
              />

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Description (optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Enter description"
                />
              </div>

              {/* Unit price */}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Unit Price *</label>
                <div className="flex rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-green/30 focus-within:border-green">
                  <span className="px-3 py-2.5 bg-surface text-sm text-muted border-r border-border">₦</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="flex-1 px-3 py-2.5 text-dark text-sm bg-white focus:outline-none"
                    value={form.unitPrice}
                    onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Tax category */}
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Tax Category</label>
                <select
                  className={sel}
                  value={form.taxCategoryId}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    taxCategoryId: e.target.value,
                  }))}
                >
                  {taxCategories.length === 0 ? (
                    <>
                      <option value="S">S — Standard VAT (7.5%)</option>
                      <option value="Z">Z — Zero-rated (0%)</option>
                      <option value="E">E — Exempt</option>
                      <option value="WHT">WHT — Withholding Tax</option>
                      <option value="O">O — Outside scope of tax</option>
                    </>
                  ) : (
                    taxCategories.map((t) => (
                      <option key={t.code} value={t.code}>{t.code} — {t.value}</option>
                    ))
                  )}
                </select>
                <p className="text-xs text-muted mt-1">
                  Effective VAT rate: {TAX_RATE[form.taxCategoryId] ?? 0}%
                </p>
              </div>

              {/* Inventory section — only shown when inventoryEnabled */}
              {inventoryEnabled && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setInvSectionOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-dark bg-surface/50 hover:bg-surface transition-colors"
                  >
                    <span>Inventory</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`transition-transform text-muted ${invSectionOpen ? "rotate-180" : ""}`}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {invSectionOpen && (
                    <div className="p-4 space-y-3 border-t border-border">
                      <div className="grid grid-cols-2 gap-3">
                        <Input label="Current stock" type="number" min="0" step="0.01"
                          value={form.stockQuantity}
                          onChange={(e) => setForm((f) => ({ ...f, stockQuantity: e.target.value }))} />
                        <Input label="Unit (e.g. KGM, PCS)" value={form.stockUnit}
                          onChange={(e) => setForm((f) => ({ ...f, stockUnit: e.target.value }))}
                          placeholder="KGM" />
                      </div>
                      <Input label="Reorder alert — alert when stock falls below"
                        type="number" min="0" step="0.01"
                        value={form.reorderPoint}
                        onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))} />
                      <p className="text-xs text-muted -mt-1">Set to 0 to disable</p>
                      <Input label="Reorder quantity — request this quantity when restocking"
                        type="number" min="0" step="0.01"
                        value={form.reorderQuantity}
                        onChange={(e) => setForm((f) => ({ ...f, reorderQuantity: e.target.value }))} />
                      <div className="pt-1">
                        <p className="text-xs font-semibold text-dark mb-2">Preferred supplier</p>
                        <div className="space-y-2">
                          <Input label="Supplier name" value={form.supplierName}
                            onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
                            placeholder="Company or contact name" />
                          <Input label="Supplier email" type="email" value={form.supplierEmail}
                            onChange={(e) => setForm((f) => ({ ...f, supplierEmail: e.target.value }))}
                            placeholder="orders@supplier.com" />
                          <p className="text-xs text-muted">Used for automatic reorder requests</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button
                loading={submitting}
                disabled={!form.name || !form.unitPrice}
                onClick={handleSubmit}
              >
                {editProduct ? "Save changes" : "Save product"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
