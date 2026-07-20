"use client";

import { useState, FormEvent, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api, invoiceApi, productApi, referenceApi, clientApi, ClientRecord } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SampleInvoiceModal } from "@/components/invoice/SampleInvoiceModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  priceUnit: string;
  taxCategory: string;
  vatRate: number;
  itemType: "product" | "service";
  hsnCode?: string;
  isicCode?: string;
  productCategory?: string;
  serviceCategory?: string;
  productId?: string;
}

interface AllowanceCharge {
  chargeIndicator: boolean; // false = discount, true = surcharge
  description: string;
  amount: number;
}

interface PartyFields {
  name: string;
  tin: string;
  email: string;
  address: string;
}

const EMPTY_PARTY: PartyFields = { name: "", tin: "", email: "", address: "" };

function hasPartyData(p: PartyFields): boolean {
  return !!(p.name || p.tin || p.email || p.address);
}

interface DraftPostalAddress {
  streetName?: string;
  state?: string;
  lga?: string;
}

interface DraftParty {
  partyName?: string;
  tin?: string;
  email?: string;
  telephone?: string;
  businessDescription?: string;
  postalAddress?: DraftPostalAddress;
}

interface DraftLineItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  priceUnit?: string;
  taxCode?: string;
  taxCategory?: string;
  vatRate?: number;
  isicCode?: string;
  hsnCode?: string;
  productCategory?: string;
  serviceCategory?: string;
}

interface DraftAllowanceCharge {
  chargeIndicator?: boolean;
  description?: string;
  amount?: number;
}

interface DraftInvoiceResponse {
  status?: string;
  invoiceType?: string;
  invoiceKind?: string;
  currency?: string;
  issueDate?: string;
  paymentDueDate?: string;
  sellerName?: string;
  sellerTin?: string;
  seller?: DraftParty;
  buyerName?: string;
  buyerTin?: string;
  buyer?: DraftParty;
  originalIrn?: string;
  billingReference?: Array<{ issueDate?: string }>;
  sourceReference?: string;
  buyerReference?: string;
  note?: string;
  paymentTermsNote?: string;
  orderReference?: string;
  actualDeliveryDate?: string;
  deliveryPeriodStart?: string;
  deliveryPeriodEnd?: string;
  lineItems?: DraftLineItem[];
  allowanceCharges?: DraftAllowanceCharge[];
  metadata?: {
    payeeParty?: Partial<PartyFields>;
    shipToParty?: Partial<PartyFields>;
    taxRepresentativeParty?: Partial<PartyFields>;
  };
}

interface Product {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  currency: string;
  hsnCode?: string;
  isicCode?: string;
  productCategory?: string;
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
  description: "", quantity: 1, unitPrice: 0, priceUnit: "EA",
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
    <div className="bg-white rounded-xl border border-border shadow-card p-6">
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

// ── Quantity code select ──────────────────────────────────────────────────────

const qtyCodeCache: { codes: { code: string; name: string }[] } = { codes: [] };

function QuantityCodeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [codes, setCodes] = useState<{ code: string; name: string }[]>(qtyCodeCache.codes);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (qtyCodeCache.codes.length > 0) return;
    referenceApi.quantityCodes().then((c) => {
      qtyCodeCache.codes = c;
      setCodes(c);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setFilter(""); }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const filtered = filter
    ? codes.filter((c) => c.code.toLowerCase().includes(filter.toLowerCase()) || c.name.toLowerCase().includes(filter.toLowerCase()))
    : codes;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-20 px-2 py-2 rounded-lg border border-border bg-white text-dark text-xs focus:outline-none flex items-center justify-between gap-1 hover:border-green transition-colors"
      >
        <span className="font-mono truncate">{value || "EA"}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-muted">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 bg-white border border-border rounded-lg shadow-xl w-64">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              className="w-full px-2 py-1.5 text-xs rounded border border-border focus:outline-none focus:ring-1 focus:ring-green/30"
              placeholder="Search unit codes…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.slice(0, 60).map((c) => (
              <button
                key={c.code}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface border-b border-border last:border-0 ${value === c.code ? "bg-green-50 text-green font-semibold" : ""}`}
                onClick={() => { onChange(c.code); setOpen(false); setFilter(""); }}
              >
                <span className="font-mono font-medium">{c.code}</span>
                <span className="text-muted ml-1">— {c.name}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted">No match</p>}
          </div>
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
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

// Asterisk shown after first submit attempt
function Req({ show, submitAttempted }: { show?: boolean; submitAttempted: boolean }) {
  return submitAttempted && show !== false ? <span className="text-red-500 ml-0.5">*</span> : null;
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
  const [showSample, setShowSample] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  // Submit-time validation state
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tenantHasTin, setTenantHasTin] = useState<boolean | null>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

  const draftId = params.get("id");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(draftId);

  // ── Client picker state ─────────────────────────────────────────────────────
  const [clientSearch, setClientSearch] = useState("");
  const [clientResults, setClientResults] = useState<ClientRecord[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [clientPickerLoading, setClientPickerLoading] = useState(false);
  const [manualBuyer, setManualBuyer] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const clientSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reference data ──────────────────────────────────────────────────────────
  const [invoiceTypes, setInvoiceTypes] = useState<{ code: string; value: string }[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string; symbolNative: string }[]>([]);
  const [taxCategories, setTaxCategories] = useState<{ code: string; value: string }[]>([]);
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [sellerLgas, setSellerLgas] = useState<{ code: string; name: string }[]>([]);
  const [buyerLgas, setBuyerLgas] = useState<{ code: string; name: string }[]>([]);

  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [allowanceCharges, setAllowanceCharges] = useState<AllowanceCharge[]>([]);
  const [payeeParty, setPayeeParty] = useState<PartyFields>(EMPTY_PARTY);
  const [shipToParty, setShipToParty] = useState<PartyFields>(EMPTY_PARTY);
  const [taxRepParty, setTaxRepParty] = useState<PartyFields>(EMPTY_PARTY);
  const [showAdditionalParties, setShowAdditionalParties] = useState(false);
  const [whtApplicable, setWhtApplicable] = useState(false);
  const [whtRate, setWhtRate] = useState<number>(5);

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
    billingReferenceDate: "",
    sourceReference: "",
    buyerReference: "",
    // Advanced options
    note: "",
    paymentTermsNote: "",
    orderReference: "",
    actualDeliveryDate: "",
    deliveryPeriodStart: "",
    deliveryPeriodEnd: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Cascading LGA dropdowns
  useEffect(() => {
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!form.sellerState) { setSellerLgas([]); return; }
    referenceApi.lgas(form.sellerState).then(setSellerLgas).catch(() => setSellerLgas([]));
  }, [form.sellerState]);

  useEffect(() => {
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!form.buyerState) { setBuyerLgas([]); return; }
    referenceApi.lgas(form.buyerState).then(setBuyerLgas).catch(() => setBuyerLgas([]));
  }, [form.buyerState]);

  // Pre-fill seller from tenant profile
  useEffect(() => {
    if (draftId) return;
    api.get<{ name?: string; tin?: string; telephone?: string; businessDescription?: string; registeredAddress?: { street?: string; streetName?: string; state?: string; lga?: string }; taxRepresentative?: Partial<PartyFields> }>("/v1/tenants/me")
      .then((t) => {
        const addr = t?.registeredAddress ?? {};
        setTenantHasTin(!!t?.tin);
        setForm((f) => ({
          ...f,
          sellerName: t?.name ?? f.sellerName,
          sellerTin: t?.tin ?? f.sellerTin,
          sellerTelephone: t?.telephone ?? f.sellerTelephone,
          sellerBusinessDescription: t?.businessDescription ?? f.sellerBusinessDescription,
          sellerAddress: addr.street ?? addr.streetName ?? f.sellerAddress,
          sellerState: addr.state ?? f.sellerState,
          sellerLga: addr.lga ?? f.sellerLga,
        }));
        if (t?.taxRepresentative) {
          setTaxRepParty({
            name: t.taxRepresentative.name ?? "",
            tin: t.taxRepresentative.tin ?? "",
            email: t.taxRepresentative.email ?? "",
            address: t.taxRepresentative.address ?? "",
          });
        }
      })
      .catch(() => {
        if (user?.tenantName) setForm((f) => ({ ...f, sellerName: user.tenantName ?? "" }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Pre-load an existing DRAFT
  useEffect(() => {
    if (!draftId) return;
    invoiceApi.get(draftId).then((raw: unknown) => {
      const data = raw as DraftInvoiceResponse | null;
      if (!data || data.status !== "DRAFT") return;
      setForm({
        invoiceType: LEGACY_TYPE_TO_CODE[data.invoiceType ?? ""] ?? data.invoiceType ?? "381",
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
        billingReferenceDate: (data.billingReference?.[0]?.issueDate ?? "").slice(0, 10),
        sourceReference: data.sourceReference ?? "",
        buyerReference: data.buyerReference ?? "",
        note: data.note ?? "",
        paymentTermsNote: data.paymentTermsNote ?? "",
        orderReference: data.orderReference ?? "",
        actualDeliveryDate: data.actualDeliveryDate?.slice(0, 10) ?? "",
        deliveryPeriodStart: data.deliveryPeriodStart?.slice(0, 10) ?? "",
        deliveryPeriodEnd: data.deliveryPeriodEnd?.slice(0, 10) ?? "",
      });
      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        setLineItems(data.lineItems.map((li) => ({
          description: li.description ?? "",
          quantity: li.quantity ?? 1,
          unitPrice: li.unitPrice ?? 0,
          priceUnit: li.priceUnit ?? "EA",
          taxCategory: li.taxCode ?? li.taxCategory ?? "S",
          vatRate: li.vatRate ?? 7.5,
          itemType: li.isicCode ? "service" : "product",
          hsnCode: li.hsnCode ?? "",
          isicCode: li.isicCode ?? "",
          productCategory: li.productCategory ?? "",
          serviceCategory: li.serviceCategory ?? "",
        })));
      }
      if (Array.isArray(data.allowanceCharges)) {
        setAllowanceCharges(data.allowanceCharges.map((ac) => ({
          chargeIndicator: ac.chargeIndicator ?? false,
          description: ac.description ?? "",
          amount: ac.amount ?? 0,
        })));
      }
      const meta = data.metadata ?? {};
      if (meta.payeeParty) setPayeeParty({ name: meta.payeeParty.name ?? "", tin: meta.payeeParty.tin ?? "", email: meta.payeeParty.email ?? "", address: meta.payeeParty.address ?? "" });
      if (meta.shipToParty) setShipToParty({ name: meta.shipToParty.name ?? "", tin: meta.shipToParty.tin ?? "", email: meta.shipToParty.email ?? "", address: meta.shipToParty.address ?? "" });
      if (meta.taxRepresentativeParty) setTaxRepParty({ name: meta.taxRepresentativeParty.name ?? "", tin: meta.taxRepresentativeParty.tin ?? "", email: meta.taxRepresentativeParty.email ?? "", address: meta.taxRepresentativeParty.address ?? "" });
      setDraftLoaded(true);
    }).catch(() => {});
  }, [draftId]);

  const uf = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      // Clear the specific error when user changes the field
      if (fieldErrors[field]) {
        setFieldErrors((errs) => { const next = { ...errs }; delete next[field]; return next; });
      }
    };

  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    setLineItems((items) =>
      items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    // Clear the relevant error for this line
    const errorKey = field === "description" ? `line_${index}_desc`
      : field === "quantity" ? `line_${index}_qty`
      : field === "unitPrice" ? `line_${index}_price`
      : null;
    if (errorKey) {
      setFieldErrors((errs) => { const next = { ...errs }; delete next[errorKey]; return next; });
    }
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
              priceUnit: item.priceUnit || "EA",
              taxCategory: taxCode,
              vatRate: TAX_RATE_MAP[taxCode] ?? 7.5,
              itemType: hasIsic ? "service" : "product",
              hsnCode: product.hsnCode ?? (hasIsic ? undefined : item.hsnCode),
              isicCode: product.isicCode ?? (hasIsic ? item.isicCode : undefined),
              productCategory: hasIsic ? item.productCategory : (product.productCategory ?? item.productCategory),
              serviceCategory: hasIsic ? (product.productCategory ?? item.serviceCategory) : item.serviceCategory,
              productId: product.id,
            }
          : item
      )
    );
    setShowCatalog(null);
  }

  const lineSubtotals = lineItems.reduce(
    (acc, item) => {
      const sub = item.quantity * item.unitPrice;
      const vat = sub * (item.vatRate / 100);
      return { subtotal: acc.subtotal + sub, tax: acc.tax + vat };
    },
    { subtotal: 0, tax: 0 }
  );
  const totalDiscounts = allowanceCharges.filter((ac) => !ac.chargeIndicator).reduce((s, ac) => s + (ac.amount || 0), 0);
  const totalSurcharges = allowanceCharges.filter((ac) => ac.chargeIndicator).reduce((s, ac) => s + (ac.amount || 0), 0);
  const taxExclusive = lineSubtotals.subtotal - totalDiscounts + totalSurcharges;
  const totals = {
    subtotal: lineSubtotals.subtotal,
    tax: lineSubtotals.tax,
    discounts: totalDiscounts,
    surcharges: totalSurcharges,
    taxExclusive,
    total: taxExclusive + lineSubtotals.tax,
  };

  const needsOriginalIrn = ["380", "384"].includes(form.invoiceType);

  function buildPayload(forSubmit: boolean) {
    const activeAllowanceCharges = allowanceCharges.filter((ac) => ac.amount > 0);
    return {
      invoiceTypeCode: form.invoiceType,
      invoiceKind: form.invoiceKind,
      currency: form.currency,
      issueDate: new Date(form.issueDate).toISOString(),
      dueDate: form.paymentDueDate ? new Date(form.paymentDueDate).toISOString() : undefined,
      sourceReference: form.sourceReference || undefined,
      buyerReference: form.buyerReference || undefined,
      originalIrn: form.originalIrn || undefined,
      billingReference: (needsOriginalIrn && form.originalIrn)
        ? [{ irn: form.originalIrn, issueDate: form.billingReferenceDate || undefined }]
        : undefined,
      allowanceCharges: activeAllowanceCharges.length > 0 ? activeAllowanceCharges : undefined,
      note: form.note || undefined,
      paymentTermsNote: form.paymentTermsNote || undefined,
      orderReference: form.orderReference || undefined,
      actualDeliveryDate: form.actualDeliveryDate ? new Date(form.actualDeliveryDate).toISOString() : undefined,
      deliveryPeriodStart: form.deliveryPeriodStart ? new Date(form.deliveryPeriodStart).toISOString() : undefined,
      deliveryPeriodEnd: form.deliveryPeriodEnd ? new Date(form.deliveryPeriodEnd).toISOString() : undefined,
      metadata: {
        ...(hasPartyData(payeeParty) ? { payeeParty } : {}),
        ...(hasPartyData(shipToParty) ? { shipToParty } : {}),
        ...(hasPartyData(taxRepParty) ? { taxRepresentativeParty: taxRepParty } : {}),
      },
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
          priceUnit: item.priceUnit || "EA",
          taxCode: item.taxCategory,
          vatRate: item.vatRate,
          itemType: item.itemType === "service" ? "SERVICE" : "PRODUCT",
          hsnCode: item.itemType === "product" ? (item.hsnCode || undefined) : undefined,
          isicCode: item.itemType === "service" ? (item.isicCode || undefined) : undefined,
          productCategory: item.itemType === "product" ? (item.productCategory || undefined) : undefined,
          serviceCategory: item.itemType === "service" ? (item.serviceCategory || undefined) : undefined,
          totalPrice: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
          vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
        })),
      taxTotal: [{ taxAmount: totals.tax }],
      legalMonetaryTotal: {
        lineExtensionAmount: totals.subtotal,
        taxExclusiveAmount: totals.taxExclusive,
        ...(totals.discounts > 0 ? { allowanceTotalAmount: totals.discounts } : {}),
        ...(totals.surcharges > 0 ? { chargeTotalAmount: totals.surcharges } : {}),
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
      let saved: { id?: string };
      if (activeDraftId) {
        saved = await invoiceApi.updateDraftFields(activeDraftId, payload) as { id?: string };
      } else {
        saved = await invoiceApi.saveDraft(payload) as { id?: string };
        setActiveDraftId(saved.id ?? null);
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

  // ── Submit-time FIRS validation ──────────────────────────────────────────────

  function validateForSubmit(): Record<string, string> {
    const errors: Record<string, string> = {};
    const isB2B = form.invoiceKind === "B2B" || form.invoiceKind === "B2G";

    // Header
    if (!form.issueDate) errors.issueDate = "Issue date is required";
    if (isB2B && !form.paymentDueDate) errors.paymentDueDate = "Payment due date is required for B2B / B2G invoices";

    // Supplier
    if (!form.sellerName) errors.sellerName = "Company name is required";
    if (!form.sellerTin) errors.sellerTin = "TIN is required";
    if (!form.sellerAddress) errors.sellerAddress = "Street address is required";
    if (!form.sellerState) errors.sellerState = "State is required";
    if (!form.sellerLga) errors.sellerLga = "LGA is required";

    // Buyer
    if (!form.buyerName) errors.buyerName = "Name / company is required";
    if (isB2B && !form.buyerTin) errors.buyerTin = "Buyer TIN is required for B2B / B2G invoices";
    if (!form.buyerEmail) errors.buyerEmail = "Email is required for invoice delivery";
    if (!form.buyerAddress) errors.buyerAddress = "Street address is required";
    if (!form.buyerState) errors.buyerState = "State is required";

    // Line items
    const filledLines = lineItems.filter((li) => li.description.trim() || li.unitPrice > 0);
    if (filledLines.length === 0) {
      errors.lineItems = "At least one line item with a description and price is required";
    } else {
      lineItems.forEach((li, i) => {
        if (!li.description.trim()) errors[`line_${i}_desc`] = "Description is required";
        if (li.quantity <= 0) errors[`line_${i}_qty`] = "Must be > 0";
        if (li.unitPrice <= 0) errors[`line_${i}_price`] = "Must be > 0";
      });
    }

    // Total > 0
    if (totals.total <= 0) errors.total = "Invoice total must be greater than zero";

    return errors;
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    const errors = validateForSubmit();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setShowPreview(true);
  }

  // Error helper
  const errMsg = (key: string) => fieldErrors[key] ?? "";
  const errSel = (key: string) =>
    fieldErrors[key]
      ? "w-full px-3 py-2.5 rounded-lg border border-red-400 bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
      : sel();

  const hasErrors = Object.keys(fieldErrors).length > 0;
  const hasStandardVat = lineItems.some((li) => li.taxCategory === "S");
  const vatWarning = hasStandardVat && totals.tax === 0;

  return (
    <>
      <Topbar title={draftLoaded ? "Continue editing draft" : "Create invoice"} />
      <div className="p-6">
        <div className="max-w-4xl flex justify-end mb-2">
          <button
            type="button"
            onClick={() => setShowSample(true)}
            className="text-xs text-muted hover:text-green transition-colors"
          >
            View sample invoice →
          </button>
        </div>
        {showSample && <SampleInvoiceModal onClose={() => setShowSample(false)} />}
        {draftLoaded && (
          <div className="max-w-4xl mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Resuming a saved draft — review the details and submit when ready.
          </div>
        )}
        {tenantHasTin === false && (
          <div className="max-w-4xl mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-600">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Your company TIN is missing. Invoices cannot be submitted to FIRS without it.</span>
            </div>
            <a href="/settings?tab=company" className="text-amber-900 font-semibold hover:underline shrink-0 whitespace-nowrap">
              Add TIN in Settings →
            </a>
          </div>
        )}
        <form onSubmit={handleFormSubmit} className="max-w-4xl space-y-6">
          <div ref={formTopRef} />

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
              <Input
                label={form.invoiceKind === "B2C"
                  ? "Payment due date (optional)"
                  : <>Payment due date<Req submitAttempted={submitAttempted} /></>}
                type="date"
                value={form.paymentDueDate}
                onChange={uf("paymentDueDate")}
                error={errMsg("paymentDueDate")}
              />
              <Input label="Buyer PO / Reference (optional)" placeholder="e.g. PO-2026-00123" value={form.buyerReference} onChange={uf("buyerReference")} />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Input label="Your reference (optional)" placeholder="Internal invoice ID" value={form.sourceReference} onChange={uf("sourceReference")} />
            </div>
            {needsOriginalIrn && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                <p className="text-sm font-medium text-amber-900">Original invoice reference</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Original IRN *" placeholder="INV20260001-SVC00001-20260602" value={form.originalIrn} onChange={uf("originalIrn")} required />
                  <Input label="Original invoice date" type="date" value={form.billingReferenceDate} onChange={uf("billingReferenceDate")} />
                </div>
                <p className="text-xs text-amber-700">IRN of the invoice this credit/debit note relates to.</p>
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
                <Input label={<>Company name<Req submitAttempted={submitAttempted} /></>} placeholder="Your company name" value={form.sellerName} onChange={uf("sellerName")} required error={errMsg("sellerName")} />
                <Input label={<>TIN<Req submitAttempted={submitAttempted} /></>} placeholder="12345678-0001" value={form.sellerTin} onChange={uf("sellerTin")} required error={errMsg("sellerTin")} />
                <Input label={<>Street address<Req submitAttempted={submitAttempted} /></>} placeholder="1 Broad Street" value={form.sellerAddress} onChange={uf("sellerAddress")} required error={errMsg("sellerAddress")} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">State<Req submitAttempted={submitAttempted} /></label>
                    <select className={errSel("sellerState")} value={form.sellerState} onChange={uf("sellerState")}>
                      <option value="">Select state…</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                    {errMsg("sellerState") && <p className="mt-1 text-xs text-red-500">{errMsg("sellerState")}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">LGA<Req submitAttempted={submitAttempted} /></label>
                    <select className={errSel("sellerLga")} value={form.sellerLga}
                      onChange={(e) => setForm((f) => ({ ...f, sellerLga: e.target.value }))}
                      disabled={!form.sellerState}>
                      <option value="">{form.sellerState ? "Select LGA…" : "Select state first"}</option>
                      {sellerLgas.map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                    {errMsg("sellerLga") && <p className="mt-1 text-xs text-red-500">{errMsg("sellerLga")}</p>}
                  </div>
                </div>
                <Input label="Telephone (optional)" type="tel" placeholder="+2348012345678" value={form.sellerTelephone} onChange={uf("sellerTelephone")} />
                <Input label="Business description (optional)" placeholder="e.g. Software services company" value={form.sellerBusinessDescription} onChange={uf("sellerBusinessDescription")} />
              </div>
            </SectionCard>
            <SectionCard title="Buyer">
              <div className="space-y-3">
                {/* ── Client picker ── */}
                {!manualBuyer && (
                  <div className="relative">
                    <label className="block text-sm font-medium text-dark mb-1">Select existing client</label>
                    <input
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      placeholder="Search by name or TIN…"
                      value={selectedClient ? selectedClient.companyName : clientSearch}
                      onFocus={() => {
                        setShowClientDropdown(true);
                        if (!clientSearch && !selectedClient) {
                          setClientPickerLoading(true);
                          clientApi.frequent().then((res) => { setClientResults(res); setClientPickerLoading(false); }).catch(() => setClientPickerLoading(false));
                        }
                      }}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setSelectedClient(null);
                        setShowClientDropdown(true);
                        if (clientSearchRef.current) clearTimeout(clientSearchRef.current);
                        clientSearchRef.current = setTimeout(() => {
                          setClientPickerLoading(true);
                          clientApi.list({ search: e.target.value, limit: 8 }).then((res) => { setClientResults(res.data); setClientPickerLoading(false); }).catch(() => setClientPickerLoading(false));
                        }, 300);
                      }}
                      onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                    />
                    {showClientDropdown && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-border rounded-xl shadow-lg max-h-52 overflow-y-auto">
                        {clientPickerLoading && <div className="px-4 py-3 text-sm text-muted">Searching…</div>}
                        {!clientPickerLoading && clientResults.length === 0 && <div className="px-4 py-3 text-sm text-muted">No clients found</div>}
                        {!clientPickerLoading && clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface transition-colors border-b border-border/50 last:border-0"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSelectedClient(c);
                              setShowClientDropdown(false);
                              setForm((f) => ({
                                ...f,
                                buyerName: c.companyName,
                                buyerTin: c.tin ?? "",
                                buyerEmail: c.email ?? "",
                                buyerTelephone: c.telephone ?? "",
                                buyerAddress: (c.postalAddress?.streetName as string) ?? "",
                                buyerState: (c.postalAddress?.state as string) ?? "",
                                buyerLga: (c.postalAddress?.lga as string) ?? "",
                                buyerBusinessDescription: c.businessDescription ?? "",
                              }));
                            }}
                          >
                            <span className="font-medium text-dark">{c.companyName}</span>
                            {c.tin && <span className="text-muted ml-2 text-xs">TIN: {c.tin}</span>}
                            {c.totalInvoices > 0 && <span className="text-muted ml-2 text-xs">{c.totalInvoices} invoice{c.totalInvoices !== 1 ? "s" : ""}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedClient && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-muted hover:text-dark underline"
                        onClick={() => { setSelectedClient(null); setClientSearch(""); setManualBuyer(true); }}
                      >
                        Clear selection
                      </button>
                    )}
                    <div className="mt-2">
                      <button
                        type="button"
                        className="text-xs text-green hover:underline font-medium"
                        onClick={() => { setManualBuyer(true); setShowClientDropdown(false); }}
                      >
                        Or enter manually
                      </button>
                    </div>
                  </div>
                )}
                {manualBuyer && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted">Entering buyer manually</p>
                    <button type="button" className="text-xs text-green hover:underline" onClick={() => { setManualBuyer(false); setSelectedClient(null); setClientSearch(""); }}>Use client picker</button>
                  </div>
                )}
                <Input
                  label={<>Name / company<Req submitAttempted={submitAttempted} /></>}
                  placeholder="Buyer name or company"
                  value={form.buyerName}
                  onChange={uf("buyerName")}
                  required
                  error={errMsg("buyerName")}
                />
                <div>
                  <Input
                    label={form.invoiceKind === "B2C"
                      ? "TIN (optional for B2C)"
                      : <>TIN<Req submitAttempted={submitAttempted} /> <span className="text-xs text-muted font-normal">(required for B2B/B2G)</span></>}
                    placeholder="12345678-0001"
                    value={form.buyerTin}
                    onChange={uf("buyerTin")}
                    error={errMsg("buyerTin")}
                  />
                  <p className="mt-1 text-[11px] text-muted leading-snug">
                    No TIN? Use RC-XXXXXXX format (e.g. RC-847789). For foreign buyers, use their country tax ID.
                  </p>
                </div>
                <Input
                  label={<>Email<Req submitAttempted={submitAttempted} /></>}
                  type="email"
                  placeholder="buyer@company.com"
                  value={form.buyerEmail}
                  onChange={uf("buyerEmail")}
                  error={errMsg("buyerEmail")}
                />
                <Input
                  label={<>Street address<Req submitAttempted={submitAttempted} /></>}
                  placeholder="1 Marina Street"
                  value={form.buyerAddress}
                  onChange={uf("buyerAddress")}
                  required
                  error={errMsg("buyerAddress")}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">State<Req submitAttempted={submitAttempted} /></label>
                    <select className={errSel("buyerState")} value={form.buyerState} onChange={uf("buyerState")}>
                      <option value="">Select state…</option>
                      {states.map((s) => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                    {errMsg("buyerState") && <p className="mt-1 text-xs text-red-500">{errMsg("buyerState")}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">LGA (optional)</label>
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
                {manualBuyer && form.buyerName && !selectedClient && (
                  <button
                    type="button"
                    className="text-xs text-green hover:underline font-medium"
                    onClick={async () => {
                      try {
                        await clientApi.create({
                          companyName: form.buyerName,
                          tin: form.buyerTin || undefined,
                          email: form.buyerEmail || undefined,
                          telephone: form.buyerTelephone || undefined,
                          businessDescription: form.buyerBusinessDescription || undefined,
                          postalAddress: form.buyerAddress ? { streetName: form.buyerAddress, state: form.buyerState, lga: form.buyerLga, country: "NG" } : undefined,
                        });
                        alert("Client saved successfully!");
                      } catch {
                        alert("Could not save client (may already exist).");
                      }
                    }}
                  >
                    + Save as new client
                  </button>
                )}
              </div>
            </SectionCard>
          </div>

          {/* ── Line items ───────────────────────────────────────────────────── */}
          <SectionCard title="Line items">
            {errMsg("lineItems") && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {errMsg("lineItems")}
              </div>
            )}
            <div className="space-y-3">
              {lineItems.map((item, i) => (
                <div key={i} className={`border rounded-lg p-3 space-y-2 bg-surface/30 ${
                  (errMsg(`line_${i}_desc`) || errMsg(`line_${i}_qty`) || errMsg(`line_${i}_price`))
                    ? "border-red-300"
                    : "border-border"
                }`}>
                  {/* Row 1: description, qty, unit, unit price, subtotal, remove */}
                  <div className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-4 flex flex-col gap-1">
                      <div className="flex gap-1">
                        <input
                          className={inp(`flex-1 ${errMsg(`line_${i}_desc`) ? "border-red-400 focus:ring-red-200 focus:border-red-400" : ""}`)}
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
                      {errMsg(`line_${i}_desc`) && <p className="text-xs text-red-500">{errMsg(`line_${i}_desc`)}</p>}
                    </div>
                    <div className="col-span-1 flex flex-col gap-1">
                      <input type="number" min="1"
                        className={inp(errMsg(`line_${i}_qty`) ? "border-red-400 focus:ring-red-200 focus:border-red-400" : "")}
                        value={item.quantity}
                        onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} required />
                      {errMsg(`line_${i}_qty`) && <p className="text-xs text-red-500">{errMsg(`line_${i}_qty`)}</p>}
                    </div>
                    <div className="col-span-2">
                      <QuantityCodeSelect value={item.priceUnit} onChange={(v) => updateLine(i, "priceUnit", v)} />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <input type="number" min="0" step="0.01"
                        className={inp(errMsg(`line_${i}_price`) ? "border-red-400 focus:ring-red-200 focus:border-red-400" : "")}
                        placeholder="Unit price" value={item.unitPrice}
                        onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))} required />
                      {errMsg(`line_${i}_price`) && <p className="text-xs text-red-500">{errMsg(`line_${i}_price`)}</p>}
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

                  {/* Row 3: NRS classification category (product or service, mutually exclusive) */}
                  {item.itemType === "product" ? (
                    <div className="w-64">
                      <input
                        className={inp()}
                        placeholder="e.g. Electronics, Food, Services"
                        value={item.productCategory ?? ""}
                        onChange={(e) => updateLine(i, "productCategory", e.target.value)}
                      />
                      <p className="text-xs text-muted mt-1">Product category</p>
                    </div>
                  ) : (
                    <div className="w-64">
                      <input
                        className={inp()}
                        placeholder="e.g. Consulting, IT Services, Legal"
                        value={item.serviceCategory ?? ""}
                        onChange={(e) => updateLine(i, "serviceCategory", e.target.value)}
                      />
                      <p className="text-xs text-muted mt-1">Service category</p>
                    </div>
                  )}
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
                <span>Line items subtotal</span>
                <span>{totals.subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              </div>
              {totals.discounts > 0 && (
                <div className="flex justify-between text-sm text-green-700">
                  <span>Discounts</span>
                  <span>-{totals.discounts.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {totals.surcharges > 0 && (
                <div className="flex justify-between text-sm text-amber-700">
                  <span>Surcharges</span>
                  <span>+{totals.surcharges.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between text-sm text-muted">
                <span>VAT</span>
                <span>{totals.tax.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-dark border-t border-border pt-1.5">
                <span>Total payable ({form.currency})</span>
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

          {/* ── Allowance charges (discounts / surcharges) ──────────────────── */}
          <SectionCard title="Discounts &amp; charges (optional)">
            <div className="space-y-2">
              {allowanceCharges.map((ac, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center bg-surface/30 rounded-lg p-2 border border-border">
                  <div className="col-span-3">
                    <div className="flex rounded-md border border-border overflow-hidden text-xs">
                      <button type="button"
                        className={`flex-1 px-3 py-1.5 transition-colors ${!ac.chargeIndicator ? "bg-green text-white" : "bg-white text-muted hover:bg-surface"}`}
                        onClick={() => setAllowanceCharges((cs) => cs.map((c, j) => j === i ? { ...c, chargeIndicator: false } : c))}>
                        Discount
                      </button>
                      <button type="button"
                        className={`flex-1 px-3 py-1.5 border-l border-border transition-colors ${ac.chargeIndicator ? "bg-amber-500 text-white" : "bg-white text-muted hover:bg-surface"}`}
                        onClick={() => setAllowanceCharges((cs) => cs.map((c, j) => j === i ? { ...c, chargeIndicator: true } : c))}>
                        Surcharge
                      </button>
                    </div>
                  </div>
                  <div className="col-span-5">
                    <input className={inp()} placeholder="Description (e.g. Volume discount)" value={ac.description}
                      onChange={(e) => setAllowanceCharges((cs) => cs.map((c, j) => j === i ? { ...c, description: e.target.value } : c))} />
                  </div>
                  <div className="col-span-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">₦</span>
                      <input type="number" min="0" step="0.01" className={inp("pl-7")} placeholder="Amount"
                        value={ac.amount || ""}
                        onChange={(e) => setAllowanceCharges((cs) => cs.map((c, j) => j === i ? { ...c, amount: Number(e.target.value) } : c))} />
                    </div>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button type="button" onClick={() => setAllowanceCharges((cs) => cs.filter((_, j) => j !== i))}
                      className="text-red-300 hover:text-red-500 transition-colors">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              <button type="button"
                onClick={() => setAllowanceCharges((cs) => [...cs, { chargeIndicator: false, description: "", amount: 0 }])}
                className="text-sm text-green hover:underline flex items-center gap-1 mt-1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add discount / charge
              </button>
            </div>
          </SectionCard>

          {/* ── Additional parties ───────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-border shadow-card">
            <button type="button"
              onClick={() => setShowAdditionalParties((v) => !v)}
              className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-dark hover:bg-surface/50 transition-colors rounded-xl">
              <span>Additional parties (optional)</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={`transition-transform text-muted ${showAdditionalParties ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {showAdditionalParties && (
              <div className="px-6 pb-6 space-y-5 border-t border-border pt-4">
                {/* Payee */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-dark">Payee party</p>
                    <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">optional</span>
                  </div>
                  <p className="text-xs text-muted mb-3">Use when payment is received by a different entity than the seller.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Party name" placeholder="Payee company name" value={payeeParty.name}
                      onChange={(e) => setPayeeParty((p) => ({ ...p, name: e.target.value }))} />
                    <Input label="TIN" placeholder="12345678-0001" value={payeeParty.tin}
                      onChange={(e) => setPayeeParty((p) => ({ ...p, tin: e.target.value }))} />
                    <Input label="Email" type="email" placeholder="payee@company.com" value={payeeParty.email}
                      onChange={(e) => setPayeeParty((p) => ({ ...p, email: e.target.value }))} />
                    <Input label="Address" placeholder="Street address" value={payeeParty.address}
                      onChange={(e) => setPayeeParty((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                </div>
                <hr className="border-border" />
                {/* Ship to */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-dark">Ship to</p>
                    <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">optional</span>
                  </div>
                  <p className="text-xs text-muted mb-3">Use when goods are delivered to a different address than the buyer.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Party name" placeholder="Delivery recipient name" value={shipToParty.name}
                      onChange={(e) => setShipToParty((p) => ({ ...p, name: e.target.value }))} />
                    <Input label="Address" placeholder="Delivery address" value={shipToParty.address}
                      onChange={(e) => setShipToParty((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                </div>
                <hr className="border-border" />
                {/* Tax representative */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-dark">Tax representative</p>
                    <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded">optional</span>
                  </div>
                  <p className="text-xs text-muted mb-3">Pre-filled from company profile if set in Settings → Company profile.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Name" placeholder="Representative name" value={taxRepParty.name}
                      onChange={(e) => setTaxRepParty((p) => ({ ...p, name: e.target.value }))} />
                    <Input label="TIN" placeholder="12345678-0001" value={taxRepParty.tin}
                      onChange={(e) => setTaxRepParty((p) => ({ ...p, tin: e.target.value }))} />
                    <Input label="Email" type="email" placeholder="taxrep@company.com" value={taxRepParty.email}
                      onChange={(e) => setTaxRepParty((p) => ({ ...p, email: e.target.value }))} />
                    <Input label="Address" placeholder="Street address" value={taxRepParty.address}
                      onChange={(e) => setTaxRepParty((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {vatWarning && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-amber-600">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              VAT amount appears to be zero for standard-rated items. Please verify your unit prices and quantities.
            </div>
          )}

          {submitAttempted && hasErrors && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-start gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Please fill in all required fields before submitting. Scroll up to review highlighted fields.</span>
            </div>
          )}

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
            <Button type="submit" size="lg" className="font-semibold">Preview &amp; submit →</Button>
            <Button type="button" size="lg" loading={draftSaving} onClick={doSaveDraft} className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400">
              {draftSaved ? "✓ Saved" : "Save draft"}
            </Button>
            <Button type="button" size="lg" onClick={() => router.push("/invoices")} className="text-gray-400 hover:text-gray-600 bg-transparent hover:bg-transparent border-0 px-4">
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
