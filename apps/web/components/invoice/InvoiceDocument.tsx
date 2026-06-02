import { formatDate, formatCurrency } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  vatRate: number;
  vatAmount: number;
  hsnCode?: string;
}

export interface InvoiceDocumentProps {
  platformIrn: string;
  firsConfirmedIrn?: string;
  status: string;
  rejectionCode?: string;
  issueDate: string;
  paymentDueDate?: string;
  sellerName: string;
  sellerTin: string;
  sellerAddress?: string;
  buyerName: string;
  buyerTin?: string;
  buyerAddress?: string;
  currency: string;
  totalAmount: number;
  taxAmount: number;
  lineItems: LineItem[];
  qrCode?: string;
  qrCodeBase64?: string;
  invoiceId?: string;
  paymentLink?: string;
}

// ── Field-level rejection highlighting ────────────────────────────────────────

const INVALID_FIELD_CODES: Record<string, string[]> = {
  INVALID_TIN:           ["sellerTin", "buyerTin"],
  MISSING_HSN:           ["hsnCode"],
  VAT_MISMATCH:          ["vat"],
  INVALID_ISSUE_DATE:    ["issueDate"],
  INVALID_CURRENCY:      ["currency"],
  MISSING_BUYER_ADDRESS: ["buyerAddress"],
};

// ── Component ─────────────────────────────────────────────────────────────────

export function InvoiceDocument({
  platformIrn,
  firsConfirmedIrn,
  status,
  rejectionCode,
  issueDate,
  paymentDueDate,
  sellerName,
  sellerTin,
  sellerAddress,
  buyerName,
  buyerTin,
  buyerAddress,
  currency,
  totalAmount,
  taxAmount,
  lineItems,
  qrCode,
  qrCodeBase64,
  invoiceId,
  paymentLink,
}: InvoiceDocumentProps) {
  const isAccepted = status === "ACCEPTED";
  const isRejected = ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(status);
  const irn = firsConfirmedIrn ?? platformIrn;
  const invalidFields = rejectionCode ? (INVALID_FIELD_CODES[rejectionCode] ?? []) : [];

  const qrSrc = (() => {
    const raw = qrCode ?? qrCodeBase64;
    if (!raw) return null;
    return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  })();

  const subtotal = totalAmount - taxAmount;
  const vatRates = [...new Set(lineItems.map((i) => i.vatRate))];
  const vatLabel = vatRates.length === 1 ? `VAT (${vatRates[0]}%)` : "VAT";

  function hi(value: string, fieldKey: string) {
    return invalidFields.includes(fieldKey)
      ? <span className="text-red-600 font-semibold">{value} <span className="text-xs font-normal">(invalid)</span></span>
      : <span>{value}</span>;
  }

  return (
    <div
      className={`max-w-[800px] mx-auto bg-white rounded-xl shadow-sm p-10 ${
        isRejected ? "border-2 border-red-300" : "border border-[#E2E8E5]"
      }`}
    >
      {/* ── Header: seller company + FIRS status badge ──────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1a1a2e] leading-tight">{sellerName}</h2>
          <p className="text-sm text-[#6B7B74] mt-1">
            TIN: {hi(sellerTin, "sellerTin")}
          </p>
          {sellerAddress && (
            <p className="text-sm text-[#6B7B74] mt-0.5">{sellerAddress}</p>
          )}
        </div>
        <div className="shrink-0 mt-1">
          {isAccepted && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-green-50 text-green-700 border border-green-200">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              FIRS Accepted
            </span>
          )}
          {isRejected && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-50 text-red-600 border border-red-200">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              FIRS Rejected
            </span>
          )}
        </div>
      </div>

      <hr className="border-[#E2E8E5] mb-6" />

      {/* ── Invoice reference + dates ────────────────────────────────────────── */}
      <div className="mb-6 space-y-1.5">
        <p className="text-sm text-[#1a1a2e]">
          <span className="text-[#6B7B74]">Invoice Reference: </span>
          <span className="font-mono font-semibold">{irn}</span>
        </p>
        <p className={`text-sm ${invalidFields.includes("issueDate") ? "text-red-600 font-medium" : "text-[#6B7B74]"}`}>
          Issue date: {formatDate(issueDate)}
          {invalidFields.includes("issueDate") && <span className="ml-1 text-xs">(invalid)</span>}
        </p>
        {paymentDueDate && (
          <p className="text-sm text-[#6B7B74]">Due date: {formatDate(paymentDueDate)}</p>
        )}
        {invalidFields.includes("currency") && (
          <p className="text-sm text-red-600 font-medium">Currency: {currency} (invalid — use NGN, USD, EUR or GBP)</p>
        )}
      </div>

      <hr className="border-[#E2E8E5] mb-6" />

      {/* ── Bill to ─────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <p className="text-[10px] font-semibold text-[#6B7B74] uppercase tracking-widest mb-2">Bill to</p>
        <p className="font-semibold text-[#1a1a2e]">{buyerName}</p>
        {buyerTin && (
          <p className="text-sm text-[#6B7B74] mt-0.5">
            TIN: {hi(buyerTin, "buyerTin")}
          </p>
        )}
        {buyerAddress ? (
          <p className={`text-sm mt-0.5 ${invalidFields.includes("buyerAddress") ? "text-red-600 font-medium" : "text-[#6B7B74]"}`}>
            {buyerAddress}
          </p>
        ) : invalidFields.includes("buyerAddress") ? (
          <p className="text-sm text-red-600 mt-0.5 font-medium">Address missing (required for B2B invoices)</p>
        ) : null}
      </div>

      <hr className="border-[#E2E8E5]" />

      {/* ── Line items ──────────────────────────────────────────────────────── */}
      {lineItems.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E2E8E5]">
              <th className="text-left py-3 pr-4 text-[10px] font-semibold text-[#6B7B74] uppercase tracking-widest">
                Description
              </th>
              <th className="text-right py-3 px-2 text-[10px] font-semibold text-[#6B7B74] uppercase tracking-widest w-14">
                Qty
              </th>
              <th className="text-right py-3 px-2 text-[10px] font-semibold text-[#6B7B74] uppercase tracking-widest">
                Unit price
              </th>
              <th className="text-right py-3 pl-2 text-[10px] font-semibold text-[#6B7B74] uppercase tracking-widest">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, i) => (
              <tr
                key={i}
                className={`border-b border-[#E2E8E5] last:border-0 ${i % 2 === 1 ? "bg-[#F4F6F5]" : "bg-white"}`}
              >
                <td className="py-3 pr-4">
                  <p className="text-sm text-[#1a1a2e]">{item.description}</p>
                  {item.hsnCode ? (
                    <p className={`text-xs mt-0.5 ${invalidFields.includes("hsnCode") ? "text-red-500 font-medium" : "text-[#6B7B74]"}`}>
                      HSN: {item.hsnCode}
                    </p>
                  ) : invalidFields.includes("hsnCode") ? (
                    <p className="text-xs text-red-500 mt-0.5 font-medium">HSN code missing</p>
                  ) : null}
                </td>
                <td className="py-3 px-2 text-sm text-[#1a1a2e] text-right tabular-nums">
                  {item.quantity}
                </td>
                <td className="py-3 px-2 text-sm text-[#1a1a2e] text-right tabular-nums">
                  {formatCurrency(item.unitPrice, currency)}
                </td>
                <td className="py-3 pl-2 text-sm font-medium text-[#1a1a2e] text-right tabular-nums">
                  {formatCurrency(item.totalPrice, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr className="border-[#E2E8E5]" />

      {/* ── Totals ──────────────────────────────────────────────────────────── */}
      <div className="flex justify-end py-5">
        <div className="w-64 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-[#6B7B74]">Subtotal</span>
            <span className="text-[#1a1a2e] tabular-nums">{formatCurrency(subtotal, currency)}</span>
          </div>
          <div className={`flex justify-between text-sm ${invalidFields.includes("vat") ? "text-red-600 font-medium" : ""}`}>
            <span className={invalidFields.includes("vat") ? "text-red-600" : "text-[#6B7B74]"}>
              {vatLabel}
              {invalidFields.includes("vat") && <span className="ml-1 text-xs">(mismatch)</span>}
            </span>
            <span className="tabular-nums">{formatCurrency(taxAmount, currency)}</span>
          </div>
          <div className="pt-2.5 border-t border-[#E2E8E5] flex justify-between items-baseline">
            <span className="font-semibold text-[#1a1a2e]">Total payable</span>
            <span className="font-bold text-[#1a1a2e] text-xl tabular-nums">
              {formatCurrency(totalAmount, currency)}
            </span>
          </div>
        </div>
      </div>

      <hr className="border-[#E2E8E5]" />

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between pt-6">
        <div className="space-y-1 text-xs text-[#6B7B74] max-w-xs">
          <p>
            <span className="font-medium text-[#1a1a2e]">Invoice Reference:</span>{" "}
            <span className="font-mono">{irn}</span>
          </p>
          <p>Validated by FIRS via Interswitch NRS</p>
          {isAccepted && (invoiceId || paymentLink) && (
            <p>
              <span className="font-medium text-[#1a1a2e]">Pay online: </span>
              <a
                href={paymentLink ?? `/pay/${invoiceId}`}
                className="text-[#1D9E75] hover:underline break-all"
                target="_blank"
                rel="noreferrer"
              >
                {paymentLink ?? `/pay/${invoiceId}`}
              </a>
            </p>
          )}
          <p>Invoice generated by billinx.ng</p>
        </div>

        {isAccepted && qrSrc && (
          <div className="shrink-0 ml-8 text-center">
            <div className="inline-block border border-[#E2E8E5] rounded-lg p-2 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc}
                alt="Scan to verify this invoice with FIRS"
                width={120}
                height={120}
                className="block"
              />
            </div>
            <p className="text-[11px] text-[#6B7B74] mt-2">Scan to verify with FIRS</p>
          </div>
        )}
      </div>
    </div>
  );
}
