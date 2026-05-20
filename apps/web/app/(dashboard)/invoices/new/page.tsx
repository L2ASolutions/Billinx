"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/dashboard/Topbar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { invoiceApi } from "@/lib/api";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  hsnCode?: string;
}

const EMPTY_LINE_ITEM: LineItem = { description: "", quantity: 1, unitPrice: 0, vatRate: 7.5 };

export default function NewInvoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    invoiceType: "STANDARD",
    invoiceKind: "B2B",
    currency: "NGN",
    issueDate: new Date().toISOString().slice(0, 10),
    // Seller
    sellerName: "",
    sellerTin: "",
    sellerAddress: "",
    // Buyer
    buyerName: "",
    buyerTin: "",
    buyerEmail: "",
    buyerAddress: "",
    // Optional
    originalIrn: "",
    sourceReference: "",
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...EMPTY_LINE_ITEM }]);

  function updateForm(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    setLineItems((items) => items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  }

  function addLine() {
    setLineItems((items) => [...items, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLine(index: number) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  const totals = lineItems.reduce(
    (acc, item) => {
      const sub = item.quantity * item.unitPrice;
      const vat = sub * (item.vatRate / 100);
      return { subtotal: acc.subtotal + sub, tax: acc.tax + vat, total: acc.total + sub + vat };
    },
    { subtotal: 0, tax: 0, total: 0 }
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = {
        ...form,
        issueDate: new Date(form.issueDate).toISOString(),
        lineItems: lineItems.map((item) => ({
          ...item,
          totalPrice: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
          vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
        })),
        totalAmount: totals.total,
        taxAmount: totals.tax,
      };
      const invoice = await invoiceApi.create(payload) as { id: string };
      router.push(`/invoices/${invoice.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create invoice";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  }

  const needsOriginalIrn = ["CREDIT_NOTE", "DEBIT_NOTE"].includes(form.invoiceType);

  return (
    <>
      <Topbar title="New Invoice" />
      <div className="p-6">
        <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
          {/* Invoice type */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invoice Type</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Type</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.invoiceType}
                  onChange={updateForm("invoiceType")}
                >
                  <option value="STANDARD">Standard</option>
                  <option value="CREDIT_NOTE">Credit Note</option>
                  <option value="DEBIT_NOTE">Debit Note</option>
                  <option value="PROFORMA">Proforma</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Kind</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.invoiceKind}
                  onChange={updateForm("invoiceKind")}
                >
                  <option value="B2B">B2B</option>
                  <option value="B2C">B2C</option>
                  <option value="B2G">B2G</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Currency</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.currency}
                  onChange={updateForm("currency")}
                >
                  <option value="NGN">NGN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Input
                label="Issue Date"
                type="date"
                value={form.issueDate}
                onChange={updateForm("issueDate")}
                required
              />
              {needsOriginalIrn && (
                <Input
                  label="Original IRN (required)"
                  placeholder="IRN of the original invoice"
                  value={form.originalIrn}
                  onChange={updateForm("originalIrn")}
                  required
                />
              )}
              <Input
                label="Source Reference (optional)"
                placeholder="Your internal invoice ID"
                value={form.sourceReference}
                onChange={updateForm("sourceReference")}
              />
            </div>
          </div>

          {/* Seller & Buyer */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-semibold text-dark mb-4">Seller</h2>
              <div className="space-y-3">
                <Input label="Name" placeholder="Company name" value={form.sellerName} onChange={updateForm("sellerName")} required />
                <Input label="TIN" placeholder="12345678-0001" value={form.sellerTin} onChange={updateForm("sellerTin")} required />
                <Input label="Address" placeholder="Street, City, State" value={form.sellerAddress} onChange={updateForm("sellerAddress")} required />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-semibold text-dark mb-4">Buyer</h2>
              <div className="space-y-3">
                <Input label="Name" placeholder="Buyer name or company" value={form.buyerName} onChange={updateForm("buyerName")} required />
                <Input label="TIN (optional)" placeholder="12345678-0001" value={form.buyerTin} onChange={updateForm("buyerTin")} />
                <Input label="Email" type="email" placeholder="buyer@company.com" value={form.buyerEmail} onChange={updateForm("buyerEmail")} />
                <Input label="Address" placeholder="Street, City, State" value={form.buyerAddress} onChange={updateForm("buyerAddress")} required />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Line Items</h2>
            <div className="space-y-3">
              {lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    {i === 0 && <label className="block text-xs font-medium text-muted mb-1">Description</label>}
                    <input
                      className="w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      placeholder="Item description"
                      value={item.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    {i === 0 && <label className="block text-xs font-medium text-muted mb-1">Qty</label>}
                    <input
                      type="number"
                      min="1"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      value={item.quantity}
                      onChange={(e) => updateLine(i, "quantity", Number(e.target.value))}
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label className="block text-xs font-medium text-muted mb-1">Unit Price</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      value={item.unitPrice}
                      onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))}
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    {i === 0 && <label className="block text-xs font-medium text-muted mb-1">VAT %</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      value={item.vatRate}
                      onChange={(e) => updateLine(i, "vatRate", Number(e.target.value))}
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label className="block text-xs font-medium text-muted mb-1">HSN Code</label>}
                    <input
                      className="w-full px-3 py-2 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                      placeholder="Optional"
                      value={item.hsnCode ?? ""}
                      onChange={(e) => updateLine(i, "hsnCode", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 text-right">
                    {i === 0 && <div className="text-xs font-medium text-muted mb-1">Subtotal</div>}
                    <div className="py-2 text-sm font-medium text-dark">
                      {(item.quantity * item.unitPrice * (1 + item.vatRate / 100)).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="col-span-0 flex justify-end">
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Remove line"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addLine}
                className="text-sm text-green hover:underline mt-2"
              >
                + Add line item
              </button>

              {/* Totals */}
              <div className="border-t border-border pt-4 mt-4 space-y-1">
                <div className="flex justify-between text-sm text-muted">
                  <span>Subtotal</span>
                  <span>{totals.subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm text-muted">
                  <span>VAT</span>
                  <span>{totals.tax.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-dark">
                  <span>Total ({form.currency})</span>
                  <span>{totals.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" loading={loading} size="lg">
              Create Invoice
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => router.push("/invoices")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
