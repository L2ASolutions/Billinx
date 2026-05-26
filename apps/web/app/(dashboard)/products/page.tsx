"use client";

import { useEffect, useState, useCallback } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { productApi } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  description?: string;
  hsnCode?: string;
  productCategory?: string;
  unitPrice: number;
  currency: string;
  taxCategoryId?: string; // BUG-015: backend returns taxCategoryId, not taxCategory
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
  taxCategoryId: string; // BUG-015
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

const TAX_CATEGORIES = ["STANDARD", "ZERO_RATED", "EXEMPT", "REVERSE_CHARGE"];

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirm
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

  async function handleDelete(id: string) {
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

  const f = (field: keyof ProductForm) => (
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  );

  return (
    <>
      <Topbar
        title="Product Catalog"
        actions={<Button size="sm" onClick={openCreate}>+ Add Product</Button>}
      />

      <div className="p-6 space-y-4">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* Search */}
        <div className="flex gap-3 items-center">
          <div className="flex-1 max-w-xs">
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted">{total} products</p>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="p-12 flex justify-center">
            <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-xl border border-border">
            <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            </div>
            <p className="text-muted text-sm mb-3">No products yet.</p>
            <Button size="sm" onClick={openCreate}>Add your first product</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => (
              <div key={p.id} className="bg-white rounded-xl border border-border p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-dark text-sm truncate">{p.name}</h3>
                      {!p.isActive && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Inactive</span>
                      )}
                    </div>
                    {p.productCategory && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-600">
                        {p.productCategory}
                      </span>
                    )}
                  </div>
                  <p className="text-base font-bold text-dark shrink-0 ml-3">
                    {formatCurrency(p.unitPrice, p.currency)}
                  </p>
                </div>
                {p.description && (
                  <p className="text-xs text-muted line-clamp-2">{p.description}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {p.hsnCode && <span>HSN: <span className="text-dark font-mono">{p.hsnCode}</span></span>}
                  {p.taxCategoryId && <span>Tax: <span className="text-dark">{p.taxCategoryId.replace(/_/g, " ")}</span></span>}
                </div>
                <div className="flex gap-2 pt-1 border-t border-border">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={deletingId === p.id}
                    onClick={() => {
                      if (confirm(`Delete "${p.name}"?`)) handleDelete(p.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="font-semibold text-dark">{editProduct ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>
              )}
              <Input label="Product Name *" value={form.name} onChange={f("name")} placeholder="e.g. Consulting Services" required />
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
                <Input label="Unit Price *" type="number" value={form.unitPrice} onChange={f("unitPrice")} placeholder="0.00" required />
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
                  <option value="">— None —</option>
                  {TAX_CATEGORIES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
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
                {editProduct ? "Save Changes" : "Add Product"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
