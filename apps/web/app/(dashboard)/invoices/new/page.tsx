"use client";

import { useState, FormEvent, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api, invoiceApi, productApi, referenceApi } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxCategory: string;
  vatRate: number;
  itemType: "product" | "service";
  hsnCode?: string;
  isicCode?: string;
  productId?: string;
}

interface Product {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  currency: string;
  hsnCode?: string;
  isicCode?: string;
  taxCategoryId?: string;
}

const TAX_RATE_MAP: Record<string, number> = { S: 7.5, Z: 0, E: 0, O: 0, WHT: 0 };

// Products store legacy taxCategoryId strings — normalise to FIRS codes
function normaliseTaxCategory(raw?: string): string {
  if (!raw) return "S";
  const upper = raw.toUpperCase().replace(/[-_ ]/g, "");
  if (upper === "STANDARD" || upper === "STANDARDVAT" || upper === "S") return "S";
  if (upper === "ZERORATED" || upper === "ZERO" || upper === "Z") return "Z";
  if (upper === "EXEMPT" || upper === "E") return "E";
  if (upper === "OUTSIDESCOPE" || upper === "OUTSIDE" || upper === "O") return "O";
  if (upper === "WHT" || upper === "WITHHOLDING") return "WHT";
  return "S";
}

const TAX_CATEGORY_LABEL: Record<string, string> = {
  S: "Standard VAT 7.5%", Z: "Zero-rated", E: "Exempt", O: "Outside scope", WHT: "WHT",
};

// Maps legacy backend enum values (STANDARD etc.) to FIRS codes
const LEGACY_TYPE_TO_CODE: Record<string, string> = {
  STANDARD: "381",
  CREDIT_NOTE: "380",
  DEBIT_NOTE: "384",
  PROFORMA: "390",
};

const EMPTY_LINE: LineItem = {
  description: "", quantity: 1, unitPrice: 0,
  taxCategory: "S", vatRate: 7.5, itemType: "product",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sel(cls = "") {
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

// ── Code search (HS codes / service codes) ────────────────────────────────────

function CodeSearch({ type, value, onSelect }: {
  type: "hs" | "service";
  value: string;
  onSelect: (code: string) => void;
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

  return (
    <div className="relative">
      <input
        className={inp()}
        placeholder={type === "hs" ? "Search HS code… (e.g. rice, petroleum)" : "Search service code… (e.g. consultancy, transport)"}
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
                onSelect(r.code);
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

// ── Catalog picker modal ──────────────────────────────────────────────────────

function CatalogPicker({ onPick, onClose }: {
  onPick: (p: Product) => void;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    productApi.list()
      .then((res) => {
        const data = res.data as Product[];
        setAllProducts(data);
        setProducts(data);
      })
      .catch(() => { setAllProducts([]); setProducts([]); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const q = search.trim().toLowerCase();
    setProducts(
      q
        ? allProducts.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.description ?? "").toLowerCase().includes(q) ||
              (p.hsnCode ?? "").toLowerCase().includes(q),
          )
        : allProducts,
    );
  }, [search, allProducts]);

  const TAX_PILL: Record<string, string> = {
    S: "bg-blue-50 text-blue-700", Z: "bg-gray-100 text-gray-600",
    E: "bg-gray-100 text-gray-600", O: "bg-gray-100 text-gray-600",
    WHT: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-dark">Select a product</h2>
            {!loading && <p className="text-xs text-muted mt-0.5">{allProducts.length} product{allProducts.length !== 1 ? "s" : ""} in catalog</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-4 border-b border-border shrink-0">
          <input
            className={inp()}
            placeholder="Search by name, description or HSN code…"
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
          ) : allProducts.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted mb-3">No products in catalog yet.</p>
              <a href="/products" className="text-sm text-green font-medium hover:underline">
                Add products →
              </a>
            </div>
          ) : products.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">No products match &ldquo;{search}&rdquo;</p>
          ) : (
            <ul className="divide-y divide-border">
              {products.map((p) => {
                const taxCode = normaliseTaxCategory(p.taxCategoryId);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onPick(p)}
                      className="w-full text-left px-5 py-3.5 hover:bg-surface transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-dark">{p.name}</p>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${TAX_PILL[taxCode] ?? "bg-gray-100 text-gray-600"}`}>
                            {taxCode}
                          </span>
                          {(p.hsnCode || p.isicCode) && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-surface border border-border text-muted">
                              {p.hsnCode ?? p.isicCode}
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-xs text-muted mt-0.5 truncate">{p.description}</p>
                        )}
                        <p className="text-xs text-muted mt-0.5">{TAX_CATEGORY_LABEL[taxCode]}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-dark">
                        {formatCurrency(p.unitPrice, p.currency ?? "NGN")}
                      </span>
                    </button>
                  </li>
                );
              })}
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
          <div className="flex gap-3 text-sm">
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.invoiceType}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.invoiceKind}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.currency}</span>
            <span className="px-2 py-0.5 rounded bg-surface border border-border text-muted">{data.issueDate}</span>
          </div>
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
  const [showCatalog, setShowCatalog] = useState<number | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  const draftId = params.get("id");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(draftId);

  // ── Reference data ──────────────────────────────────────────────────────────
  const [invoiceTypes, setInvoiceTypes] = useState<{ code: string; value: string }[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string; symbolNative: string }[]>([]);
  const [taxCategories, setTaxCategories] = useState<{ code: string; value: string }[]>([]);
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [sellerLgas, setSellerLgas] = useState<{ code: string; name: string }[]>([]);
  const [buyerLgas, setBuyerLgas] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    Promise.all([
      referenceApi.invoiceTypes(),
      referenceApi.currencies(),
      referenceApi.taxCategories(),
      referenceApi.states(),
    ]).then(([types, currs, taxes, sts]) => {
      setInvoiceTypes(types);
      setCurrencies(currs);
      setTaxCategories(taxes);
      setStates(sts);
    }).catch(() => {});
  }, []);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    invoiceType: params.get("type") ? (LEGACY_TYPE_TO_CODE[params.get("type")!] ?? params.get("type")!) : "381",
    invoiceKind: "B2B",
    currency: "NGN",
    issueDate: new Date().toISOString().slice(0, 10),
    paymentDueDate: "",
    sellerName: "",
    sellerTin: "",
    sellerAddress: "",
    sellerState: "",
    sellerLga: "",
    sellerTelephone: "",
    sellerBusinessDescription: "",
    buyerName: "",
    buyerTin: "",
    buyerEmail: "",
    buyerAddress: "",
    buyerState: "",
    buyerLga: "",
    buyerTelephone: "",
    buyerBusinessDescription: "",
    originalIrn: params.get("originalIrn") ?? "",
    sourceReference: "",
    // Advanced options
    note: "",
    paymentTermsNote: "",
    buyerReference: "",
    orderReference: "",
    actualDeliveryDate: "",
    deliveryPeriodStart: "",
    deliveryPeriodEnd: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Cascading LGA dropdowns
  useEffect(() => {
    if (!form.sellerState) { setSellerLgas([]); return; }
    referenceApi.lgas(form.sellerState).then(setSellerLgas).catch(() => setSellerLgas([]));
  }, [form.sellerState]);

  useEffect(() => {
    if (!form.buyerState) { setBuyerLgas([]); return; }
    referenceApi.lgas(form.buyerState).then(setBuyerLgas).catch(() => setBuyerLgas([]));
  }, [form.buyerState]);

  // Pre-fill seller from tenant profile
  useEffect(() => {
    if (draftId) return;
    api.get<{ name?: string; tin?: string; telephone?: string; businessDescription?: string; registeredAddress?: { state?: string; lga?: string } }>("/v1/tenants/me")
      .then((t) => {
        setForm((f) => ({
          ...f,
          sellerName: t?.name ?? f.sellerName,
          sellerTin: t?.tin ?? f.sellerTin,
          sellerTelephone: t?.telephone ?? f.sellerTelephone,
          sellerBusinessDescription: t?.businessDescription ?? f.sellerBusinessDescription,
          sellerState: t?.registeredAddress?.state ?? f.sellerState,
          sellerLga: t?.registeredAddress?.lga ?? f.sellerLga,
        }));
      })
      .catch(() => {
        if (user?.tenantName) setForm((f) => ({ ...f, sellerName: user.tenantName ?? "" }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Pre-load an existing DRAFT
  useEffect(() => {
    if (!draftId) return;
    invoiceApi.get(draftId).then((data: any) => {
      if (!data || data.status !== "DRAFT") return;
      setForm({
        invoiceType: LEGACY_TYPE_TO_CODE[data.invoiceType] ?? data.invoiceType ?? "381",
        invoiceKind: data.invoiceKind ?? "B2B",
        currency: data.currency ?? "NGN",
        issueDate: data.issueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        paymentDueDate: data.paymentDueDate?.slice(0, 10) ?? "",
        sellerName: data.sellerName ?? data.seller?.partyName ?? "",
        sellerTin: data.sellerTin ?? data.seller?.tin ?? "",
        sellerAddress: data.seller?.postalAddress?.streetName ?? "",
        sellerState: data.seller?.postalAddress?.state ?? "",
        sellerLga: data.seller?.postalAddress?.lga ?? "",
        sellerTelephone: data.seller?.telephone ?? "",
        sellerBusinessDescription: data.seller?.businessDescription ?? "",
        buyerName: data.buyerName ?? data.buyer?.partyName ?? "",
        buyerTin: data.buyerTin ?? data.buyer?.tin ?? "",
        buyerEmail: data.buyer?.email ?? "",
        buyerAddress: data.buyer?.postalAddress?.streetName ?? "",
        buyerState: data.buyer?.postalAddress?.state ?? "",
        buyerLga: data.buyer?.postalAddress?.lga ?? "",
        buyerTelephone: data.buyer?.telephone ?? "",
        buyerBusinessDescription: data.buyer?.businessDescription ?? "",
        originalIrn: data.originalIrn ?? "",
        sourceReference: data.sourceReference ?? "",
        note: data.note ?? "",
        paymentTermsNote: data.paymentTermsNote ?? "",
        buyerReference: data.buyerReference ?? "",
        orderReference: data.orderReference ?? "",
        actualDeliveryDate: data.actualDeliveryDate?.slice(0, 10) ?? "",
        deliveryPeriodStart: data.deliveryPeriodStart?.slice(0, 10) ?? "",
        deliveryPeriodEnd: data.deliveryPeriodEnd?.slice(0, 10) ?? "",
      });
      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        setLineItems(data.lineItems.map((li: any) => ({
          description: li.description ?? "",
          quantity: li.quantity ?? 1,
          unitPrice: li.unitPrice ?? 0,
          taxCategory: li.taxCategory ?? "S",
          vatRate: li.vatRate ?? 7.5,
          itemType: li.isicCode ? "service" : "product",
          hsnCode: li.hsnCode ?? "",
          isicCode: li.isicCode ?? "",
        })));
      }
      setDraftLoaded(true);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [whtApplicable, setWhtApplicable] = useState(false);
  const [whtRate, setWhtRate] = useState<number>(5);

  const uf = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    setLineItems((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function updateLineTaxCategory(index: number, code: string) {
    setLineItems((items) =>
      items.map((item, i) =>
        i === index
          ? { ...item, taxCategory: code, vatRate: TAX_RATE_MAP[code] ?? 7.5 }
          : item
      )
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
    const taxCode = normaliseTaxCategory(product.taxCategoryId);
    const hasIsic = !!product.isicCode && !product.hsnCode;
    setLineItems((items) =>
      items.map((item, i) =>
        i === idx
          ? {
              ...item,
              description: product.description ? `${product.name} — ${product.description}` : product.name,
              unitPrice: product.unitPrice,
              taxCategory: taxCode,
              vatRate: TAX_RATE_MAP[taxCode] ?? 7.5,
              itemType: hasIsic ? "service" : "product",
              hsnCode: product.hsnCode ?? (hasIsic ? undefined : item.hsnCode),
              isicCode: product.isicCode ?? (hasIsic ? item.isicCode : undefined),
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

  const needsOriginalIrn = ["380", "384"].includes(form.invoiceType);

  function buildPayload(forSubmit: boolean) {
    return {
      invoiceTypeCode: form.invoiceType,
      invoiceKind: form.invoiceKind,
      currency: form.currency,
      issueDate: new Date(form.issueDate).toISOString(),
      dueDate: form.paymentDueDate ? new Date(form.paymentDueDate).toISOString() : undefined,
      sourceReference: form.sourceReference || undefined,
      originalIrn: form.originalIrn || undefined,
      note: form.note || undefined,
      paymentTermsNote: form.paymentTermsNote || undefined,
      buyerReference: form.buyerReference || undefined,
      orderReference: form.orderReference || undefined,
      actualDeliveryDate: form.actualDeliveryDate ? new Date(form.actualDeliveryDate).toISOString() : undefined,
      deliveryPeriodStart: form.deliveryPeriodStart ? new Date(form.deliveryPeriodStart).toISOString() : undefined,
      deliveryPeriodEnd: form.deliveryPeriodEnd ? new Date(form.deliveryPeriodEnd).toISOString() : undefined,
      seller: {
        tin: form.sellerTin || undefined,
        partyName: form.sellerName || undefined,
        telephone: form.sellerTelephone || undefined,
        businessDescription: form.sellerBusinessDescription || undefined,
        postalAddress: {
          streetName: form.sellerAddress || undefined,
          lga: form.sellerLga || undefined,
          state: form.sellerState || undefined,
          country: "NG",
        },
      },
      buyer: {
        partyName: form.buyerName || undefined,
        tin: form.buyerTin || undefined,
        email: form.buyerEmail || undefined,
        telephone: form.buyerTelephone || undefined,
        businessDescription: form.buyerBusinessDescription || undefined,
        postalAddress: {
          streetName: form.buyerAddress || undefined,
          lga: form.buyerLga || undefined,
          state: form.buyerState || undefined,
          country: "NG",
        },
      },
      lineItems: lineItems
        .filter((li) => !forSubmit || li.description)
        .map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          hsnCode: item.itemType === "product" ? (item.hsnCode || undefined) : undefined,
          isicCode: item.itemType === "service" ? (item.isicCode || undefined) : undefined,
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
      whtApplicable: whtApplicable || undefined,
      whtRate: whtApplicable ? whtRate : undefined,
    };
  }

  async function doSaveDraft() {
    setDraftSaving(true);
    setError("");
    try {
      const payload = buildPayload(false);
      let saved: any;
      if (activeDraftId) {
        saved = await invoiceApi.updateDraftFields(activeDraftId, payload);
      } else {
        saved = await invoiceApi.saveDraft(payload);
        setActiveDraftId((saved as any).id);
      }
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setDraftSaving(false);
    }
  }

  async function doSubmit() {
    setError("");
    setLoading(true);
    try {
      const payload = buildPayload(true);
      const invoice = activeDraftId
        ? await invoiceApi.submitDraft(activeDraftId, payload) as { id: string }
        : await invoiceApi.create(payload) as { id: string };
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
                <select className={sel()} value={form.invoiceType} onChange={uf("invoiceType")}>
                  {invoiceTypes.length === 0 ? (
                    <option value="381">381 — Commercial Invoice</option>
                  ) : (
                    invoiceTypes.map((t) => (
                      <option key={t.code} value={t.code}>{t.code} — {t.value}</option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Kind</label>
                <select className={sel()} value={form.invoiceKind} onChange={uf("invoiceKind")}>
                  <option value="B2B">B2B</option>
                  <option value="B2C">B2C</option>
                  <option value="B2G">B2G</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Currency</label>
                <select className={sel()} value={form.currency} onChange={uf("currency")}>
                  {currencies.length === 0 ? (
                    <>
                      <option value="NGN">NGN — Nigerian Naira (₦)</option>
                      <option value="USD">USD — US Dollar ($)</option>
                      <option value="EUR">EUR — Euro (€)</option>
                      <option value="GBP">GBP — British Pound (£)</option>
                    </>
                  ) : (
                    currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name} ({c.symbolNative})
                      </option>
                    ))
                  )}
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
            {/* Advanced options */}
            <div className="mt-4 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-sm text-muted hover:text-green transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {showAdvanced ? "Hide advanced options" : "Show advanced options"}
              </button>
              {showAdvanced && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Buyer reference (PO number)" placeholder="PO-2026-001" value={form.buyerReference} onChange={uf("buyerReference")} />
                    <Input label="Order reference" placeholder="ORD-001" value={form.orderReference} onChange={uf("orderReference")} />
                  </div>
                  <Input label="Note" placeholder="e.g. Payment due within 30 days" value={form.note} onChange={uf("note")} />
                  <Input label="Payment terms" placeholder="e.g. Net 30 days" value={form.paymentTermsNote} onChange={uf("paymentTermsNote")} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Actual delivery date" type="date" value={form.actualDeliveryDate} onChange={uf("actualDeliveryDate")} />
                    <Input label="Delivery period start" type="date" value={form.deliveryPeriodStart} onChange={uf("deliveryPeriodStart")} />
                    <Input label="Delivery period end" type="date" value={form.deliveryPeriodEnd} onChange={uf("deliveryPeriodEnd")} />
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Supplier + Buyer ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard title="Supplier">
              <div className="space-y-3">
                <Input label="Company name" placeholder="Your company name" value={form.sellerName} onChange={uf("sellerName")} required />
                <Input label="TIN" placeholder="12345678-0001" value={form.sellerTin} onChange={uf("sellerTin")} required />
                <Input label="Street address" placeholder="1 Broad Street" value={form.sellerAddress} onChange={uf("sellerAddress")} required />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">State</label>
                    <select className={sel()} value={form.sellerState} onChange={uf("sellerState")}>
                      <option value="">Select state…</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">LGA</label>
                    <select className={sel()} value={form.sellerLga}
                      onChange={(e) => setForm((f) => ({ ...f, sellerLga: e.target.value }))}
                      disabled={!form.sellerState}>
                      <option value="">{form.sellerState ? "Select LGA…" : "Select state first"}</option>
                      {sellerLgas.map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <Input label="Telephone (optional)" type="tel" placeholder="+2348012345678" value={form.sellerTelephone} onChange={uf("sellerTelephone")} />
                <Input label="Business description (optional)" placeholder="e.g. Software services company" value={form.sellerBusinessDescription} onChange={uf("sellerBusinessDescription")} />
              </div>
            </SectionCard>
            <SectionCard title="Buyer">
              <div className="space-y-3">
                <Input label="Name / company" placeholder="Buyer name or company" value={form.buyerName} onChange={uf("buyerName")} required />
                <Input label="TIN (optional)" placeholder="12345678-0001" value={form.buyerTin} onChange={uf("buyerTin")} />
                <Input label="Email" type="email" placeholder="buyer@company.com" value={form.buyerEmail} onChange={uf("buyerEmail")} />
                <Input label="Street address" placeholder="1 Marina Street" value={form.buyerAddress} onChange={uf("buyerAddress")} required />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">State</label>
                    <select className={sel()} value={form.buyerState} onChange={uf("buyerState")}>
                      <option value="">Select state…</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">LGA</label>
                    <select className={sel()} value={form.buyerLga}
                      onChange={(e) => setForm((f) => ({ ...f, buyerLga: e.target.value }))}
                      disabled={!form.buyerState}>
                      <option value="">{form.buyerState ? "Select LGA…" : "Select state first"}</option>
                      {buyerLgas.map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <Input label="Telephone (optional)" type="tel" placeholder="+2348098765432" value={form.buyerTelephone} onChange={uf("buyerTelephone")} />
                <Input label="Business description (optional)" placeholder="e.g. Manufacturing company" value={form.buyerBusinessDescription} onChange={uf("buyerBusinessDescription")} />
              </div>
            </SectionCard>
          </div>

          {/* ── Line items ───────────────────────────────────────────────────── */}
          <SectionCard title="Line items">
            <div className="space-y-3">
              {lineItems.map((item, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-surface/30">
                  {/* Row 1: description, qty, unit price, subtotal, remove */}
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5 flex gap-1">
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
                    <div className="col-span-1">
                      <input type="number" min="1" className={inp()} value={item.quantity}
                        onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} required />
                    </div>
                    <div className="col-span-3">
                      <input type="number" min="0" step="0.01" className={inp()} placeholder="Unit price" value={item.unitPrice}
                        onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))} required />
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-dark">
                      {(item.quantity * item.unitPrice * (1 + item.vatRate / 100)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </div>
                    <div className="col-span-1 flex justify-end">
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

                  {/* Row 2: product/service toggle, code search, tax category */}
                  <div className="flex gap-2 items-center flex-wrap">
                    {/* Toggle */}
                    <div className="flex rounded-md border border-border overflow-hidden shrink-0 text-xs">
                      <button
                        type="button"
                        className={`px-3 py-1.5 transition-colors ${item.itemType === "product" ? "bg-green text-white" : "bg-white text-muted hover:bg-surface"}`}
                        onClick={() => updateLine(i, "itemType", "product")}
                      >
                        Product
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 border-l border-border transition-colors ${item.itemType === "service" ? "bg-green text-white" : "bg-white text-muted hover:bg-surface"}`}
                        onClick={() => updateLine(i, "itemType", "service")}
                      >
                        Service
                      </button>
                    </div>
                    {/* Code search */}
                    <div className="flex-1 min-w-48">
                      <CodeSearch
                        key={`${i}-${item.itemType}`}
                        type={item.itemType === "service" ? "service" : "hs"}
                        value={item.itemType === "service" ? (item.isicCode ?? "") : (item.hsnCode ?? "")}
                        onSelect={(code) =>
                          updateLine(i, item.itemType === "service" ? "isicCode" : "hsnCode", code)
                        }
                      />
                    </div>
                    {/* Tax category */}
                    <div className="w-52">
                      <select
                        className={sel()}
                        value={item.taxCategory}
                        onChange={(e) => updateLineTaxCategory(i, e.target.value)}
                      >
                        {taxCategories.length === 0 ? (
                          <>
                            <option value="S">S — Standard VAT (7.5%)</option>
                            <option value="Z">Z — Zero-rated (0%)</option>
                            <option value="E">E — Exempt</option>
                            <option value="WHT">WHT — Withholding Tax</option>
                            <option value="O">O — Outside scope</option>
                          </>
                        ) : (
                          taxCategories.map((t) => (
                            <option key={t.code} value={t.code}>{t.code} — {t.value}</option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-4 mt-1">
                <button type="button" onClick={addLine}
                  className="text-sm text-green hover:underline flex items-center gap-1">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add line item
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const idx = lineItems.length - 1;
                    addLine();
                    setShowCatalog(idx + 1);
                  }}
                  className="text-sm text-muted hover:text-green flex items-center gap-1 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  Add from catalog
                </button>
              </div>
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

            {/* WHT section */}
            <div className="border-t border-border pt-4 mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={whtApplicable}
                  onChange={(e) => setWhtApplicable(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-green"
                />
                <span className="text-sm font-medium text-dark">Withholding Tax (WHT) applicable</span>
              </label>
              {whtApplicable && (
                <div className="mt-3 ml-6 space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-muted w-20">WHT Rate</label>
                    <select
                      className={sel("w-36")}
                      value={whtRate}
                      onChange={(e) => setWhtRate(Number(e.target.value))}
                    >
                      <option value={5}>5%</option>
                      <option value={10}>10%</option>
                    </select>
                  </div>
                  <div className="text-sm text-muted space-y-1 mt-2 p-3 bg-surface rounded-lg border border-border max-w-xs">
                    <div className="flex justify-between">
                      <span>Invoice total</span>
                      <span>₦{totals.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-amber-700">
                      <span>WHT ({whtRate}%)</span>
                      <span>-₦{(totals.total * whtRate / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-dark border-t border-border pt-1">
                      <span>Expected cash</span>
                      <span>₦{(totals.total * (1 - whtRate / 100)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
          )}

          {draftSaved && (
            <div className="p-3 bg-green-50 border border-green/20 rounded-xl text-sm text-green-700 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Draft saved — you can resume it from the invoices list.
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <Button type="submit" size="lg">Preview &amp; submit →</Button>
            <Button type="button" variant="secondary" size="lg" loading={draftSaving} onClick={doSaveDraft}>
              {draftSaved ? "✓ Saved" : "Save draft"}
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/invoices")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>

      {showCatalog !== null && (
        <CatalogPicker onPick={pickFromCatalog} onClose={() => setShowCatalog(null)} />
      )}

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
