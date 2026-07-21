"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { recurringInvoiceApi } from "@/lib/api";

const sel =
  "w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUALLY", label: "Annually" },
];

const TAX_CATEGORIES: { value: string; label: string; rate: number }[] = [
  { value: "S", label: "Standard VAT (7.5%)", rate: 7.5 },
  { value: "Z", label: "Zero-rated (0%)", rate: 0 },
  { value: "E", label: "Exempt (0%)", rate: 0 },
  { value: "WHT", label: "Withholding tax (0%)", rate: 0 },
];

interface LineItemForm {
  description: string;
  quantity: string;
  unitPrice: string;
  taxCategory: string;
  itemType: "product" | "service";
  hsnCode: string;
  productCategory: string;
  isicCode: string;
  serviceCategory: string;
  priceUnit: string;
}

const EMPTY_LINE_ITEM: LineItemForm = {
  description: "",
  quantity: "1",
  unitPrice: "",
  taxCategory: "S",
  itemType: "product",
  hsnCode: "",
  productCategory: "",
  isicCode: "",
  serviceCategory: "",
  priceUnit: "EA",
};

export interface RecurringScheduleRecord {
  id: string;
  name: string;
  frequency: string;
  startDate: string;
  endDate?: string | null;
  autoSubmit: boolean;
  autoSend: boolean;
  templateData: {
    invoiceKind: string;
    invoiceTypeCode: string | number;
    currency?: string;
    notes?: string;
    buyer: { name: string; tin?: string; email?: string; address?: string };
    lineItems: Array<Record<string, unknown>>;
  };
}

interface Props {
  schedule?: RecurringScheduleRecord;
  onClose: () => void;
  onSave: () => void;
}

function toLineItemForm(raw: Record<string, unknown>): LineItemForm {
  const itemType =
    String(raw.itemType ?? "product").toUpperCase() === "SERVICE"
      ? "service"
      : "product";
  const taxCategory =
    typeof raw.taxCategory === "string" ? raw.taxCategory : "S";
  return {
    description: String(raw.description ?? ""),
    quantity: String(raw.quantity ?? "1"),
    unitPrice: String(raw.unitPrice ?? ""),
    taxCategory,
    itemType,
    hsnCode: String(raw.hsnCode ?? ""),
    productCategory: String(raw.productCategory ?? ""),
    isicCode: String(raw.isicCode ?? ""),
    serviceCategory: String(raw.serviceCategory ?? ""),
    priceUnit: String(raw.priceUnit ?? "EA"),
  };
}

function toDateInputValue(iso?: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function RecurringInvoiceFormModal({ schedule, onClose, onSave }: Props) {
  const t = schedule?.templateData;

  const [name, setName] = useState(schedule?.name ?? "");
  const [frequency, setFrequency] = useState(schedule?.frequency ?? "MONTHLY");
  const [startDate, setStartDate] = useState(
    toDateInputValue(schedule?.startDate) ||
      new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState(toDateInputValue(schedule?.endDate));
  const [autoSubmit, setAutoSubmit] = useState(schedule?.autoSubmit ?? false);
  const [autoSend, setAutoSend] = useState(schedule?.autoSend ?? false);
  const [invoiceKind, setInvoiceKind] = useState(t?.invoiceKind ?? "B2B");
  const [currency, setCurrency] = useState(t?.currency ?? "NGN");
  const [notes, setNotes] = useState(t?.notes ?? "");

  const [buyerName, setBuyerName] = useState(t?.buyer?.name ?? "");
  const [buyerTin, setBuyerTin] = useState(t?.buyer?.tin ?? "");
  const [buyerEmail, setBuyerEmail] = useState(t?.buyer?.email ?? "");
  const [buyerAddress, setBuyerAddress] = useState(t?.buyer?.address ?? "");

  const [lineItems, setLineItems] = useState<LineItemForm[]>(
    t?.lineItems?.length
      ? t.lineItems.map(toLineItemForm)
      : [{ ...EMPTY_LINE_ITEM }],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateLineItem(index: number, patch: Partial<LineItemForm>) {
    setLineItems((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addLineItem() {
    setLineItems((items) => [...items, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(index: number) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  const totals = lineItems.reduce(
    (acc, item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const rate = TAX_CATEGORIES.find((c) => c.value === item.taxCategory)?.rate ?? 7.5;
      const sub = qty * price;
      return { subtotal: acc.subtotal + sub, tax: acc.tax + sub * (rate / 100) };
    },
    { subtotal: 0, tax: 0 },
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Schedule name is required");
      return;
    }
    if (!buyerName.trim()) {
      setError("Buyer name is required");
      return;
    }
    if (lineItems.length === 0 || lineItems.some((li) => !li.description || !li.unitPrice)) {
      setError("Every line item needs a description and unit price");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        frequency,
        startDate,
        endDate: endDate || undefined,
        autoSubmit,
        autoSend,
        templateData: {
          invoiceKind,
          invoiceTypeCode: "381",
          currency,
          notes: notes || undefined,
          buyer: {
            name: buyerName.trim(),
            tin: buyerTin || undefined,
            email: buyerEmail || undefined,
            address: buyerAddress || undefined,
          },
          lineItems: lineItems.map((li) => ({
            description: li.description,
            quantity: Number(li.quantity) || 0,
            unitPrice: Number(li.unitPrice) || 0,
            taxCategory: li.taxCategory,
            vatRate: TAX_CATEGORIES.find((c) => c.value === li.taxCategory)?.rate ?? 7.5,
            itemType: li.itemType,
            priceUnit: li.priceUnit || "EA",
            ...(li.itemType === "product"
              ? { hsnCode: li.hsnCode || undefined, productCategory: li.productCategory || undefined }
              : { isicCode: li.isicCode || undefined, serviceCategory: li.serviceCategory || undefined }),
          })),
        },
      };

      if (schedule) {
        await recurringInvoiceApi.update(schedule.id, payload);
      } else {
        await recurringInvoiceApi.create(payload);
      }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save recurring invoice schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-dark">
            {schedule ? "Edit recurring invoice" : "New recurring invoice"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <Input
            label="Schedule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Monthly retainer - Acme Ltd"
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Frequency</label>
              <select className={sel} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Invoice kind</label>
              <select className={sel} value={invoiceKind} onChange={(e) => setInvoiceKind(e.target.value)}>
                <option value="B2B">B2B — Business</option>
                <option value="B2C">B2C — Consumer</option>
                <option value="B2G">B2G — Government</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <Input
              label="End date (optional)"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
            />
          </div>

          <div className="space-y-3">
            <ToggleRow
              label="Automatically submit to NRS when generated"
              checked={autoSubmit}
              onChange={setAutoSubmit}
            />
            <ToggleRow
              label="Automatically send to buyer when generated"
              checked={autoSend}
              onChange={setAutoSend}
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Buyer</p>
            <div className="space-y-3">
              <Input
                label="Buyer name"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Acme Ltd"
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={`Buyer TIN${invoiceKind !== "B2C" ? " (required for B2B/B2G)" : " (optional)"}`}
                  value={buyerTin}
                  onChange={(e) => setBuyerTin(e.target.value)}
                  placeholder="87654321-0001"
                />
                <Input
                  label="Buyer email (optional)"
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="accounts@acme.com"
                />
              </div>
              <Input
                label="Buyer address (optional)"
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                placeholder="1 Marina Street, Lagos"
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Line items</p>
              <button type="button" onClick={addLineItem} className="text-xs text-green hover:underline font-medium">
                + Add line item
              </button>
            </div>

            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={index} className="p-3 bg-surface rounded-lg border border-border space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        label="Description"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, { description: e.target.value })}
                        placeholder="Monthly retainer fee"
                      />
                    </div>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="mt-6 text-red-500 hover:text-red-600 text-xs font-medium shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      label="Quantity"
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
                    />
                    <Input
                      label="Unit price (NGN)"
                      type="number"
                      min="0"
                      value={item.unitPrice}
                      onChange={(e) => updateLineItem(index, { unitPrice: e.target.value })}
                    />
                    <div>
                      <label className="block text-sm font-medium text-dark mb-1">Tax category</label>
                      <select
                        className={sel}
                        value={item.taxCategory}
                        onChange={(e) => updateLineItem(index, { taxCategory: e.target.value })}
                      >
                        {TAX_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-dark mb-1">Item type</label>
                      <select
                        className={sel}
                        value={item.itemType}
                        onChange={(e) =>
                          updateLineItem(index, { itemType: e.target.value as "product" | "service" })
                        }
                      >
                        <option value="product">Product</option>
                        <option value="service">Service</option>
                      </select>
                    </div>
                    {item.itemType === "product" ? (
                      <>
                        <Input
                          label="HSN code"
                          value={item.hsnCode}
                          onChange={(e) => updateLineItem(index, { hsnCode: e.target.value })}
                          placeholder="8471"
                        />
                        <Input
                          label="Product category"
                          value={item.productCategory}
                          onChange={(e) => updateLineItem(index, { productCategory: e.target.value })}
                          placeholder="Software services"
                        />
                      </>
                    ) : (
                      <>
                        <Input
                          label="ISIC code"
                          value={item.isicCode}
                          onChange={(e) => updateLineItem(index, { isicCode: e.target.value })}
                          placeholder="6201"
                        />
                        <Input
                          label="Service category"
                          value={item.serviceCategory}
                          onChange={(e) => updateLineItem(index, { serviceCategory: e.target.value })}
                          placeholder="Consulting"
                        />
                      </>
                    )}
                  </div>
                  {autoSubmit && (
                    <p className="text-xs text-muted">
                      Classification fields are required for auto-submit — NRS rejects line items
                      missing {item.itemType === "product" ? "an HSN code and product category" : "an ISIC code and service category"}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Currency</label>
              <select className={sel} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="NGN">NGN — Nigerian Naira (₦)</option>
                <option value="USD">USD — US Dollar ($)</option>
                <option value="EUR">EUR — Euro (€)</option>
                <option value="GBP">GBP — British Pound (£)</option>
              </select>
            </div>
            <div className="text-right self-end text-sm">
              <p className="text-muted">Subtotal: {totals.subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</p>
              <p className="font-semibold text-dark">
                Total: {(totals.subtotal + totals.tax).toLocaleString("en-NG", { minimumFractionDigits: 2 })} {currency}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
            <textarea
              className={`${sel} resize-none`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Included on every generated invoice"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {schedule ? "Save changes" : "Save schedule"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 bg-surface rounded-lg border border-border">
      <span className="text-sm text-dark">{label}</span>
      <button
        type="button"
        className={`w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-green" : "bg-gray-200"}`}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}
