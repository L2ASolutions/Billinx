"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { productApi } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  description?: string;
  hsnCode?: string;
  productCategory?: string;
  unitPrice: number;
  currency: string;
  taxCategoryId?: string;
  isActive: boolean;
  createdAt: string;
}

interface ProductForm {
  name: string;
  description: string;
  hsnCode: string;
  productCategory: string;
  unitPrice: string;
  currency: string;
  taxCategoryId: string;
}

const EMPTY_FORM: ProductForm = {
  name: "",
  description: "",
  hsnCode: "",
  productCategory: "",
  unitPrice: "",
  currency: "NGN",
  taxCategoryId: "",
};

const TAX_OPTIONS: { value: string; label: string }[] = [
  { value: "STANDARD_VAT", label: "Standard VAT (7.5%)" },
  { value: "ZERO_RATED", label: "Zero Rated (0%)" },
  { value: "EXEMPT", label: "Exempt" },
  { value: "WITHHOLDING", label: "Withholding Tax" },
];

function taxLabel(id?: string): string {
  if (!id) return "—";
  return TAX_OPTIONS.find((t) => t.value === id)?.label ?? id.replace(/_/g, " ");
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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

  function openCreate() {
    setEditProduct(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowModal(true);
  }

  function openEdit(p: Product) {
    setEditProduct(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      hsnCode: p.hsnCode ?? "",
      productCategory: p.productCategory ?? "",
      unitPrice: String(p.unitPrice),
      currency: p.currency ?? "NGN",
      taxCategoryId: p.taxCategoryId ?? "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSubmit() {
    setFormError("");
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        hsnCode: form.hsnCode || undefined,
        productCategory: form.productCategory || undefined,
        unitPrice: parseFloat(form.unitPrice),
        currency: form.currency,
        taxCategoryId: form.taxCategoryId || undefined,
      };
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

  const f = (field: keyof ProductForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

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
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
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
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden sm:table-cell">HSN Code</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden md:table-cell">Category</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Unit Price</th>
                    <th className="px-5 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden lg:table-cell">Tax</th>
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
                        {p.hsnCode ? (
                          <span className="font-mono text-xs text-dark bg-surface px-2 py-0.5 rounded border border-border">{p.hsnCode}</span>
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

              <Input label="Product name *" value={form.name} onChange={f("name")} placeholder="e.g. Consulting Services" required />

              <div>
                <label className="block text-sm font-medium text-dark mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={2}
                  value={form.description}
                  onChange={f("description")}
                  placeholder="Optional description"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="HSN Code" value={form.hsnCode} onChange={f("hsnCode")} placeholder="e.g. 9983" />
                <Input label="Product Category" value={form.productCategory} onChange={f("productCategory")} placeholder="e.g. Services" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="Unit Price (₦) *" type="number" value={form.unitPrice} onChange={f("unitPrice")} placeholder="0.00" required />
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">Currency</label>
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
              </div>

              <div>
                <label className="block text-sm font-medium text-dark mb-1">Tax Category</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.taxCategoryId}
                  onChange={f("taxCategoryId")}
                >
                  <option value="">— Select tax category —</option>
                  {TAX_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button
                loading={submitting}
                disabled={!form.name || !form.unitPrice}
                onClick={handleSubmit}
              >
                {editProduct ? "Save changes" : "Add product"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
