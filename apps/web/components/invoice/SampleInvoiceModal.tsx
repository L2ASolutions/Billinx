"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { invoiceApi } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";

interface SampleInvoice {
  invoiceNumber: string;
  invoiceTypeCode: string;
  invoiceKind: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  note?: string;
  seller: {
    partyName: string;
    tin: string;
    email: string;
    telephone: string;
    postalAddress: { streetName: string; cityName: string; state: string; country: string };
  };
  buyer: {
    partyName: string;
    tin: string;
    email: string;
    telephone: string;
    postalAddress: { streetName: string; cityName: string; state: string; country: string };
  };
  lineItems: Array<{
    hsnCode: string;
    productCategory: string;
    invoicedQuantity: number;
    lineExtensionAmount: number;
    item: { name: string; description: string };
    price: { priceAmount: number; baseQuantity: number; priceUnit: string };
    taxCategory: { id: string; percent: number };
  }>;
  legalMonetaryTotal: {
    lineExtensionAmount: number;
    taxExclusiveAmount: number;
    taxInclusiveAmount: number;
    payableAmount: number;
  };
  taxTotal: Array<{ taxAmount: number }>;
  irn: string;
  annotations: Record<string, string>;
}

function AnnotationTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="absolute z-50 bottom-full left-0 mb-1.5 w-56 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg leading-relaxed pointer-events-none">
          {text}
          <span className="absolute top-full left-4 -mt-px border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}

export function SampleInvoiceModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [sample, setSample] = useState<SampleInvoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoiceApi.getSample()
      .then((d) => setSample(d as SampleInvoice))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleCreateLikeThis() {
    onClose();
    router.push("/invoices/new");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-dark">Sample Invoice — For Reference Only</h2>
            <p className="text-xs text-muted mt-0.5">Hover over sections to see guidance</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="space-y-3">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : !sample ? (
            <p className="text-muted text-sm text-center py-8">Could not load sample invoice.</p>
          ) : (
            <div className="space-y-5 font-sans text-sm">
              {/* Header row */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-bold text-dark">INVOICE</p>
                  <p className="font-mono text-xs text-muted mt-0.5">{sample.invoiceNumber}</p>
                </div>
                <div className="text-right text-xs text-muted space-y-0.5">
                  <p>Issue date: <span className="text-dark font-medium">{sample.issueDate}</span></p>
                  <p>Due date: <span className="text-dark font-medium">{sample.dueDate}</span></p>
                  <p>Currency: <span className="text-dark font-medium">{sample.currency}</span></p>
                </div>
              </div>

              {/* Seller / Buyer */}
              <div className="grid grid-cols-2 gap-4">
                <AnnotationTooltip text="Fill in your company details here. Pre-filled from your company profile.">
                  <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl hover:border-blue-300 transition-colors">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">From (Seller)</p>
                    <p className="font-semibold text-dark">{sample.seller.partyName}</p>
                    <p className="text-muted text-xs mt-0.5">TIN: {sample.seller.tin}</p>
                    <p className="text-muted text-xs">{sample.seller.email}</p>
                    <p className="text-muted text-xs">{sample.seller.postalAddress.streetName}</p>
                    <p className="text-muted text-xs">{sample.seller.postalAddress.cityName}, {sample.seller.postalAddress.state}</p>
                  </div>
                </AnnotationTooltip>

                <AnnotationTooltip text="Enter your customer details here. Or select from your saved clients.">
                  <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-xl hover:border-amber-300 transition-colors">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">To (Buyer)</p>
                    <p className="font-semibold text-dark">{sample.buyer.partyName}</p>
                    <p className="text-muted text-xs mt-0.5">TIN: {sample.buyer.tin}</p>
                    <p className="text-muted text-xs">{sample.buyer.email}</p>
                    <p className="text-muted text-xs">{sample.buyer.postalAddress.streetName}</p>
                    <p className="text-muted text-xs">{sample.buyer.postalAddress.cityName}, {sample.buyer.postalAddress.state}</p>
                  </div>
                </AnnotationTooltip>
              </div>

              {/* Line items */}
              <AnnotationTooltip text="Add what you are selling. Search for the HSN or service code from the FIRS reference list.">
                <div className="rounded-xl border border-border overflow-hidden hover:border-green/40 transition-colors">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface border-b border-border">
                        <th className="px-3 py-2 text-left font-semibold text-muted uppercase tracking-wide">Description</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted uppercase tracking-wide">HSN</th>
                        <th className="px-3 py-2 text-right font-semibold text-muted uppercase tracking-wide">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold text-muted uppercase tracking-wide">Unit price</th>
                        <th className="px-3 py-2 text-right font-semibold text-muted uppercase tracking-wide">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sample.lineItems.map((li, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">
                            <p className="font-medium text-dark">{li.item.name}</p>
                            <p className="text-muted">{li.item.description}</p>
                          </td>
                          <td className="px-3 py-2 font-mono text-muted">{li.hsnCode}</td>
                          <td className="px-3 py-2 text-right text-dark">{li.invoicedQuantity}</td>
                          <td className="px-3 py-2 text-right text-dark">{formatCurrency(li.price.priceAmount, sample.currency)}</td>
                          <td className="px-3 py-2 text-right font-medium text-dark">{formatCurrency(li.lineExtensionAmount, sample.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AnnotationTooltip>

              {/* Totals */}
              <AnnotationTooltip text="All amounts are calculated automatically by Billinx based on your line items.">
                <div className="ml-auto w-64 space-y-1.5 hover:bg-surface rounded-xl p-3 -mr-1 transition-colors">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Subtotal</span>
                    <span>{formatCurrency(sample.legalMonetaryTotal.lineExtensionAmount, sample.currency)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>VAT (7.5%)</span>
                    <span>{formatCurrency(sample.taxTotal[0]?.taxAmount ?? 0, sample.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-dark border-t border-border pt-2 mt-1">
                    <span>Total payable</span>
                    <span>{formatCurrency(sample.legalMonetaryTotal.payableAmount, sample.currency)}</span>
                  </div>
                </div>
              </AnnotationTooltip>

              {/* IRN */}
              <AnnotationTooltip text="This Invoice Reference Number is generated automatically by Billinx when you submit to FIRS. You don't need to fill this in.">
                <div className="p-3 bg-green-50 border border-green/20 rounded-xl hover:border-green/40 transition-colors">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Invoice Reference Number (IRN)</p>
                  <p className="font-mono text-xs text-green-800 break-all">{sample.irn}</p>
                  <p className="text-xs text-green-600 mt-1">Auto-generated when submitted to FIRS</p>
                </div>
              </AnnotationTooltip>

              {sample.note && (
                <div className="p-3 bg-surface border border-border rounded-xl text-xs text-muted">
                  <span className="font-semibold text-dark mr-1">Note:</span>{sample.note}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0">
          <p className="text-xs text-muted">This is a reference only — no real data will be submitted.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={handleCreateLikeThis}>
              Create invoice like this
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
