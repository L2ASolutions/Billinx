"use client";

import { useState, FormEvent, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { invoiceApi, productApi } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  hsnCode?: string;
  productId?: string;
}

interface Product {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  currency: string;
  hsnCode?: string;
  taxCategoryId?: string;
}

const EMPTY_LINE: LineItem = { description: "", quantity: 1, unitPrice: 0, vatRate: 7.5 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function sel(cls: string) {
  return `w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green ${cls}`;
}

function inp(cls = "") {
  return `w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green ${cls}`;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="font-semibold text-dark mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Catalog picker modal ──────────────────────────────────────────────────────

function CatalogPicker({ onPick, onClose }: {
  onPick: (p: Product) => void;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productApi.list(search ? { search } : undefined);
      setProducts(res.data as Product[]);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-dark">Select from catalog</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-4 border-b border-border shrink-0">
          <input
            className={inp()}
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">No products found.</p>
          ) : (
            <ul className="divide-y divide-border">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => onPick(p)}
                    className="w-full text-left px-6 py-3 hover:bg-surface transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark">{p.name}</p>
                      {p.description && <p className="text-xs text-muted truncate">{p.description}</p>}
                      {p.hsnCode && <p className="text-xs text-muted">HSN: {p.hsnCode}</p>}
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-dark">
                      {formatCurrency(p.unitPrice, p.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────────

interface PreviewData {
  invoiceType: string;
  invoiceKind: string;
  currency: string;
  issueDate: string;
  sellerName: string;
  sellerTin: string;
  buyerName: string;
  buyerTin?: string;
  lineItems: LineItem[];
  totals: { subtotal: number; tax: number; total: number };
}

function PreviewModal({ data, onSubmit, onClose, loading }: {
  data: PreviewData;
  onSubmit: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-dark">Invoice preview</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Type strip */}
          <div className="flex gap-3 text-sm">
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.invoiceType}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.invoiceKind}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.currency}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.issueDate}</span>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-surface rounded-lg border border-border">
              <p className="text-xs text-muted font-medium uppercase tracking-wide mb-1">Seller</p>
              <p className="text-sm font-semibold text-dark">{data.sellerName}</p>
              <p className="text-xs text-muted">TIN: {data.sellerTin}</p>
            </div>
            <div className="p-4 bg-surface rounded-lg border border-border">
              <p className="text-xs text-muted font-medium uppercase tracking-wide mb-1">Buyer</p>
              <p className="text-sm font-semibold text-dark">{data.buyerName || "—"}</p>
              {data.buyerTin && <p className="text-xs text-muted">TIN: {data.buyerTin}</p>}
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-4 py-2 text-xs text-muted font-medium">Description</th>
                  <th className="text-right px-4 py-2 text-xs text-muted font-medium">Qty</th>
                  <th className="text-right px-4 py-2 text-xs text-muted font-medium">Unit price</th>
                  <th className="text-right px-4 py-2 text-xs text-muted font-medium">VAT</th>
                  <th className="text-right px-4 py-2 text-xs text-muted font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.lineItems.map((item, i) => {
                  const lineTotal = item.quantity * item.unitPrice * (1 + item.vatRate / 100);
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-sm text-dark">{item.description || "—"}</td>
                      <td className="px-4 py-2 text-sm text-dark text-right">{item.quantity}</td>
                      <td className="px-4 py-2 text-sm text-dark text-right">
                        {item.unitPrice.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted text-right">{item.vatRate}%</td>
                      <td className="px-4 py-2 text-sm font-medium text-dark text-right">
                        {lineTotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tax summary */}
          <div className="p-4 bg-surface rounded-lg border border-border space-y-1.5">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Tax summary</p>
            <div className="flex justify-between text-sm text-muted">
              <span>Subtotal</span>
              <span>{data.totals.subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-sm text-muted">
              <span>VAT</span>
              <span>{data.totals.tax.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-dark border-t border-border pt-1.5">
              <span>Total ({data.currency})</span>
              <span>{data.totals.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border flex gap-3 justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Edit</Button>
          <Button loading={loading} onClick={onSubmit}>Submit invoice</Button>
        </div>
      </div>
    </div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

function NewInvoiceForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showCatalog, setShowCatalog] = useState<number | null>(null); // line index
  const [draftLoaded, setDraftLoaded] = useState(false);

  const draftId = params.get("id");

  const [form, setForm] = useState({
    invoiceType: params.get("type") ?? "STANDARD",
    invoiceKind: "B2B",
    currency: "NGN",
    issueDate: new Date().toISOString().slice(0, 10),
    paymentDueDate: "",
    sellerName: "",
    sellerTin: "",
    sellerAddress: "",
    buyerName: "",
    buyerTin: "",
    buyerEmail: "",
    buyerAddress: "",
    originalIrn: params.get("originalIrn") ?? "",
    sourceReference: "",
  });

  // Pre-fill seller from tenant profile
  useEffect(() => {
    if (user?.tenantName) setForm((f) => ({ ...f, sellerName: user.tenantName ?? "" }));
  }, [user]);

  // Pre-load an existing DRAFT invoice when ?id= param is present
  useEffect(() => {
    if (!draftId) return;
    invoiceApi.get(draftId).then((data: any) => {
      if (!data || data.status !== "DRAFT") return;
      setForm({
        invoiceType: data.invoiceType ?? "STANDARD",
        invoiceKind: data.invoiceKind ?? "B2B",
        currency: data.currency ?? "NGN",
        issueDate: data.issueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        paymentDueDate: data.paymentDueDate?.slice(0, 10) ?? "",
        sellerName: data.sellerName ?? "",
        sellerTin: data.sellerTin ?? "",
        sellerAddress: data.sellerAddress ?? "",
        buyerName: data.buyerName ?? "",
        buyerTin: data.buyerTin ?? "",
        buyerEmail: data.buyerEmail ?? "",
        buyerAddress: data.buyerAddress ?? "",
        originalIrn: data.originalIrn ?? "",
        sourceReference: data.sourceReference ?? "",
      });
      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        setLineItems(data.lineItems.map((li: any) => ({
          description: li.description ?? "",
          quantity: li.quantity ?? 1,
          unitPrice: li.unitPrice ?? 0,
          vatRate: li.vatRate ?? 7.5,
          hsnCode: li.hsnCode ?? "",
        })));
      }
      setDraftLoaded(true);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE }]);

  const uf = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    setLineItems((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function addLine() {
    setLineItems((items) => [...items, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  function pickFromCatalog(product: Product) {
    const idx = showCatalog;
    if (idx == null) return;
    setLineItems((items) =>
      items.map((item, i) =>
        i === idx
          ? {
              ...item,
              description: product.name,
              unitPrice: product.unitPrice,
              hsnCode: product.hsnCode ?? item.hsnCode,
              productId: product.id,
            }
          : item
      )
    );
    setShowCatalog(null);
  }

  const totals = lineItems.reduce(
    (acc, item) => {
      const sub = item.quantity * item.unitPrice;
      const vat = sub * (item.vatRate / 100);
      return { subtotal: acc.subtotal + sub, tax: acc.tax + vat, total: acc.total + sub + vat };
    },
    { subtotal: 0, tax: 0, total: 0 }
  );

  const needsOriginalIrn = ["CREDIT_NOTE", "DEBIT_NOTE"].includes(form.invoiceType);

  async function doSubmit() {
    setError("");
    setLoading(true);
    try {
      const typeCodeMap: Record<string, string> = {
        STANDARD: "380",
        CREDIT_NOTE: "381",
        DEBIT_NOTE: "383",
        PROFORMA: "325",
      };

      const payload = {
        invoiceTypeCode: typeCodeMap[form.invoiceType] ?? "380",
        invoiceKind: form.invoiceKind,
        currency: form.currency,
        issueDate: new Date(form.issueDate).toISOString(),
        dueDate: form.paymentDueDate ? new Date(form.paymentDueDate).toISOString() : undefined,
        sourceReference: form.sourceReference || undefined,
        originalIrn: form.originalIrn || undefined,
        seller: {
          tin: form.sellerTin,
          partyName: form.sellerName,
          address: form.sellerAddress || undefined,
        },
        buyer: {
          partyName: form.buyerName,
          tin: form.buyerTin || undefined,
          email: form.buyerEmail || undefined,
          address: form.buyerAddress || undefined,
        },
        lineItems: lineItems.map((item) => ({
          ...item,
          totalPrice: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
          vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
        })),
        taxTotal: [{ taxAmount: totals.tax }],
        legalMonetaryTotal: {
          lineExtensionAmount: totals.subtotal,
          taxExclusiveAmount: totals.subtotal,
          taxInclusiveAmount: totals.total,
          payableAmount: totals.total,
        },
      };

      const invoice = await invoiceApi.create(payload) as { id: string };
      router.push(`/invoices/${invoice.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create invoice";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setShowPreview(false);
    } finally {
      setLoading(false);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    setShowPreview(true);
  }

  return (
    <>
      <Topbar title={draftLoaded ? "Continue editing draft" : "Create invoice"} />
      <div className="p-6">
        {draftLoaded && (
          <div className="max-w-4xl mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Resuming a saved draft — review the details and submit when ready.
          </div>
        )}
        <form onSubmit={handleFormSubmit} className="max-w-4xl space-y-6">

          {/* ── Invoice details ─────────────────────────────────────────────── */}
          <SectionCard title="Invoice details">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Type</label>
                <select className={sel("")} value={form.invoiceType} onChange={uf("invoiceType")}>
                  <option value="STANDARD">Standard</option>
                  <option value="CREDIT_NOTE">Credit note</option>
                  <option value="DEBIT_NOTE">Debit note</option>
                  <option value="PROFORMA">Proforma</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Kind</label>
                <select className={sel("")} value={form.invoiceKind} onChange={uf("invoiceKind")}>
                  <option value="B2B">B2B</option>
                  <option value="B2C">B2C</option>
                  <option value="B2G">B2G</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Currency</label>
                <select className={sel("")} value={form.currency} onChange={uf("currency")}>
                  <option value="NGN">NGN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <Input label="Issue date" type="date" value={form.issueDate} onChange={uf("issueDate")} required />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Input label="Payment due date (optional)" type="date" value={form.paymentDueDate} onChange={uf("paymentDueDate")} />
              <Input label="Your reference (optional)" placeholder="Internal invoice ID" value={form.sourceReference} onChange={uf("sourceReference")} />
            </div>
            {needsOriginalIrn && (
              <div className="mt-4">
                <Input label="Original IRN *" placeholder="IRN of the original invoice" value={form.originalIrn} onChange={uf("originalIrn")} required />
              </div>
            )}
          </SectionCard>

          {/* ── Supplier + Buyer ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard title="Supplier">
              <div className="space-y-3">
                <Input label="Company name" placeholder="Your company name" value={form.sellerName} onChange={uf("sellerName")} required />
                <Input label="TIN" placeholder="12345678-0001" value={form.sellerTin} onChange={uf("sellerTin")} required />
                <Input label="Address" placeholder="Street, City, State" value={form.sellerAddress} onChange={uf("sellerAddress")} required />
              </div>
            </SectionCard>
            <SectionCard title="Buyer">
              <div className="space-y-3">
                <Input label="Name / company" placeholder="Buyer name or company" value={form.buyerName} onChange={uf("buyerName")} required />
                <Input label="TIN (optional)" placeholder="12345678-0001" value={form.buyerTin} onChange={uf("buyerTin")} />
                <Input label="Email" type="email" placeholder="buyer@company.com" value={form.buyerEmail} onChange={uf("buyerEmail")} />
                <Input label="Address" placeholder="Street, City, State" value={form.buyerAddress} onChange={uf("buyerAddress")} required />
              </div>
            </SectionCard>
          </div>

          {/* ── Line items ───────────────────────────────────────────────────── */}
          <SectionCard title="Line items">
            <div className="space-y-2">
              {/* Column headers */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-1">
                {["Description", "Qty", "Unit price", "VAT %", "HSN", "Subtotal", ""].map((h, i) => (
                  <div key={i}
                    className={`text-xs font-medium text-muted ${[0].includes(i) ? "col-span-4" : [2].includes(i) ? "col-span-2" : [5].includes(i) ? "col-span-2 text-right" : "col-span-1"}`}>
                    {h}
                  </div>
                ))}
              </div>

              {lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  {/* Description + catalog */}
                  <div className="col-span-4 flex gap-1">
                    <input
                      className={inp("flex-1")}
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      title="Pick from catalog"
                      onClick={() => setShowCatalog(i)}
                      className="px-2 rounded-lg border border-border text-muted hover:text-green hover:border-green transition-colors shrink-0"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                    </button>
                  </div>
                  {/* Qty */}
                  <div className="col-span-1">
                    <input type="number" min="1" className={inp()} value={item.quantity}
                      onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} required />
                  </div>
                  {/* Unit price */}
                  <div className="col-span-2">
                    <input type="number" min="0" step="0.01" className={inp()} value={item.unitPrice}
                      onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))} required />
                  </div>
                  {/* VAT */}
                  <div className="col-span-1">
                    <input type="number" min="0" step="0.1" className={inp()} value={item.vatRate}
                      onChange={(e) => updateLine(i, "vatRate", Number(e.target.value))} required />
                  </div>
                  {/* HSN */}
                  <div className="col-span-2">
                    <input className={inp()} placeholder="Optional" value={item.hsnCode ?? ""}
                      onChange={(e) => updateLine(i, "hsnCode", e.target.value)} />
                  </div>
                  {/* Subtotal */}
                  <div className="col-span-2 text-right text-sm font-medium text-dark">
                    {(item.quantity * item.unitPrice * (1 + item.vatRate / 100)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </div>
                  {/* Remove */}
                  <div className="col-span-0 flex justify-end">
                    {lineItems.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)}
                        className="text-red-300 hover:text-red-500 transition-colors">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button type="button" onClick={addLine}
                className="text-sm text-green hover:underline mt-1 flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add line item
              </button>
            </div>

            {/* Tax summary */}
            <div className="border-t border-border pt-4 mt-4 space-y-1.5 max-w-xs ml-auto">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Tax summary</p>
              <div className="flex justify-between text-sm text-muted">
                <span>Subtotal</span>
                <span>{totals.subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm text-muted">
                <span>VAT</span>
                <span>{totals.tax.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-dark border-t border-border pt-1.5">
                <span>Total ({form.currency})</span>
                <span>{totals.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </SectionCard>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
          )}

          <div className="flex gap-3">
            <Button type="submit" size="lg">
              Preview &amp; submit →
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/invoices")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>

      {/* Catalog picker */}
      {showCatalog !== null && (
        <CatalogPicker onPick={pickFromCatalog} onClose={() => setShowCatalog(null)} />
      )}

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal
          data={{ ...form, lineItems, totals }}
          onSubmit={doSubmit}
          onClose={() => setShowPreview(false)}
          loading={loading}
        />
      )}
    </>
  );
}

// ── Page wrapper (Suspense for useSearchParams) ───────────────────────────────

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoiceForm />
    </Suspense>
  );
}
