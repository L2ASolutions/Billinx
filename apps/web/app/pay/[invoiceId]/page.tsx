"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { publicPayApi } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicInvoice {
  id: string;
  invoiceNumber: string;
  irn: string;
  firsReference: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  paymentStatus: string;
  acceptedAt: string | null;
  currency: string;
  seller: {
    partyName: string;
    tin: string;
    address: unknown;
    telephone: string | null;
    bankName: string | null;
    bankAccount: string | null;
    bankAccountName: string | null;
  };
  buyer: { partyName: string; tin: string | null; email: string | null };
  lineItems: Array<{
    // Canonical shape (post PR #224 normaliseLineItems())
    item?: { name?: string; description?: string };
    invoicedQuantity?: number;
    price?: { priceAmount?: number };
    lineExtensionAmount?: number;
    // Legacy flat shape — fallback for invoices stored before normalisation
    description?: string;
    itemName?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    vatAmount?: number;
  }>;
  taxTotal?: Array<{ taxAmount?: number }>;
  legalMonetaryTotal: { payableAmount: number };
  amountPaid: number;
  amountOutstanding: number;
  qrCode: string | null;
  paymentLink: string;
  whtApplicable: boolean;
  whtAmount: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    minimumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

// ── Payment email modal ───────────────────────────────────────────────────────

function PayModal({
  invoice,
  onClose,
}: {
  invoice: PublicInvoice;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(invoice.buyer.email ?? "");
  const [mode, setMode] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function pay(provider: "paystack" | "flutterwave") {
    if (!email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setMode("loading");
    setErrorMsg("");
    try {
      if (provider === "paystack") {
        const result = await publicPayApi.paystackInit(invoice.id, email);
        window.location.href = result.authorizationUrl;
      } else {
        const result = await publicPayApi.flutterwaveInit(invoice.id, email);
        window.location.href = result.paymentLink;
      }
    } catch (err: unknown) {
      setMode("error");
      setErrorMsg(err instanceof Error ? err.message : "Payment initialization failed.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <p className="font-semibold text-gray-900">Enter your email to pay</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
            <input
              type="email"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={mode === "loading"}
            />
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
            <div className="flex justify-between text-gray-600 mb-1">
              <span>Invoice</span>
              <span className="font-mono text-xs truncate ml-2">{invoice.irn}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900 text-base pt-1 border-t border-gray-200 mt-1">
              <span>Amount due</span>
              <span>{fmt(invoice.amountOutstanding, invoice.currency)}</span>
            </div>
          </div>
          {errorMsg && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errorMsg}</p>
          )}
          <button
            onClick={() => pay("paystack")}
            disabled={mode === "loading"}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-[#0BA4DB] hover:bg-[#0993c5] disabled:opacity-50 transition-colors"
          >
            {mode === "loading" ? "Redirecting…" : "Pay with Paystack"}
          </button>
          <button
            onClick={() => pay("flutterwave")}
            disabled={mode === "loading"}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-[#F5A623] hover:bg-[#e09510] disabled:opacity-50 transition-colors"
          >
            {mode === "loading" ? "Redirecting…" : "Pay with Flutterwave"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublicPayPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [bankPaid, setBankPaid] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    publicPayApi.getInvoice(invoiceId)
      .then((data) => setInvoice(data as PublicInvoice))
      .catch(() => setError("Invoice not found or not available."))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  function copyLink() {
    const link = invoice?.paymentLink ?? window.location.href;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
          <span className="text-xl font-bold text-gray-900">Billinx</span>
          <span className="text-sm text-gray-400">Invoice Payment</span>
        </header>
        <div className="flex-1 max-w-xl mx-auto w-full p-4 space-y-4 pt-8">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-4">
          <span className="text-xl font-bold text-gray-900">Billinx</span>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-lg font-medium text-gray-700 mb-2">Invoice not found</p>
            <p className="text-sm text-gray-500">{error || "This invoice link may be invalid or expired."}</p>
          </div>
        </div>
      </div>
    );
  }

  const isPaid = invoice.paymentStatus === "PAID";
  const isCancelled = invoice.status === "CANCELLED";
  const isAccepted = invoice.status === "ACCEPTED";
  const canPay = isAccepted && !isPaid && !isCancelled && invoice.amountOutstanding > 0;
  const hasBankDetails = !!(invoice.seller.bankName && invoice.seller.bankAccount);

  return (
    <>
      <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">Billinx</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">Invoice Payment</span>
          </div>
          <button onClick={copyLink} className="text-xs text-green-700 font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 hover:bg-green-100 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </header>

        <div className="flex-1 max-w-xl mx-auto w-full p-4 space-y-4 pt-6">
          {/* Invoice header */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Invoice from</p>
                <p className="text-lg font-bold text-gray-900">{invoice.seller.partyName}</p>
              </div>
              {isAccepted && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  FIRS Accepted
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Invoice Reference (IRN)</span>
                <span className="font-mono text-gray-800 text-xs">{invoice.irn}</span>
              </div>
              {invoice.firsReference && (
                <div className="flex justify-between">
                  <span className="text-gray-500">FIRS Reference</span>
                  <span className="font-mono text-gray-600 text-xs">{invoice.firsReference}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Invoice date</span>
                <span className="text-gray-800">{fmtDate(invoice.issueDate)}</span>
              </div>
              {invoice.dueDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Due date</span>
                  <span className="font-medium text-gray-900">{fmtDate(invoice.dueDate)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">To</span>
                <span className="text-gray-800">{invoice.buyer.partyName}</span>
              </div>
            </div>
          </div>

          {/* Already paid banner */}
          {isPaid && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-green-800">This invoice has been paid</p>
                <p className="text-sm text-green-700 mt-0.5">
                  {fmt(invoice.amountPaid, invoice.currency)} received
                </p>
              </div>
            </div>
          )}

          {/* Cancelled banner */}
          {isCancelled && (
            <div className="bg-gray-100 border border-gray-300 rounded-2xl p-5">
              <p className="font-semibold text-gray-700">This invoice has been cancelled</p>
            </div>
          )}

          {/* Line items */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <span>Item</span>
              <span>Amount</span>
            </div>
            <div className="divide-y divide-gray-100">
              {(invoice.lineItems as PublicInvoice["lineItems"]).map((item, i) => {
                const description =
                  item.item?.description ?? item.description ?? item.itemName ?? "";
                const quantity = item.invoicedQuantity ?? item.quantity ?? 0;
                const unitPrice = item.price?.priceAmount ?? item.unitPrice ?? 0;
                const totalPrice =
                  item.lineExtensionAmount ?? item.totalPrice ?? 0;
                return (
                  <div key={i} className="px-5 py-3 flex justify-between items-start gap-4 text-sm">
                    <div className="flex-1">
                      <p className="text-gray-800">{description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {quantity} × {fmt(unitPrice, invoice.currency)}
                      </p>
                    </div>
                    <span className="font-medium text-gray-900 shrink-0">
                      {fmt(totalPrice, invoice.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-gray-200 px-5 py-3 space-y-1.5 bg-gray-50">
              <div className="flex justify-between text-sm text-gray-600">
                <span>VAT</span>
                <span>
                  {fmt(
                    invoice.taxTotal && invoice.taxTotal.length > 0
                      ? invoice.taxTotal.reduce((s, t) => s + (t.taxAmount ?? 0), 0)
                      : invoice.lineItems.reduce((s, i) => s + (i.vatAmount ?? 0), 0),
                    invoice.currency,
                  )}
                </span>
              </div>
              {invoice.whtApplicable && invoice.whtAmount && (
                <div className="flex justify-between text-sm text-amber-700">
                  <span>WHT deduction</span>
                  <span>-{fmt(invoice.whtAmount, invoice.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 text-base pt-1 border-t border-gray-200 mt-1">
                <span>Total Payable</span>
                <span>{fmt(invoice.legalMonetaryTotal.payableAmount, invoice.currency)}</span>
              </div>
              {invoice.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-sm text-green-700">
                    <span>Amount paid</span>
                    <span>-{fmt(invoice.amountPaid, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200 mt-1">
                    <span>Outstanding</span>
                    <span>{fmt(invoice.amountOutstanding, invoice.currency)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Payment options */}
          {canPay && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Pay now</p>
              <button
                onClick={() => setShowPayModal(true)}
                className="w-full py-3.5 rounded-xl font-semibold text-white text-sm bg-[#0BA4DB] hover:bg-[#0993c5] transition-colors"
              >
                Pay with Paystack
              </button>
              <button
                onClick={() => setShowPayModal(true)}
                className="w-full py-3.5 rounded-xl font-semibold text-white text-sm bg-[#F5A623] hover:bg-[#e09510] transition-colors"
              >
                Pay with Flutterwave
              </button>
            </div>
          )}

          {/* Bank transfer */}
          {canPay && hasBankDetails && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-sm font-semibold text-gray-700 mb-3">Bank transfer</p>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-500">Bank</span>
                  <span className="font-medium text-gray-800">{invoice.seller.bankName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Account number</span>
                  <span className="font-mono font-medium text-gray-800">{invoice.seller.bankAccount}</span>
                </div>
                {invoice.seller.bankAccountName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Account name</span>
                    <span className="font-medium text-gray-800">{invoice.seller.bankAccountName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Reference</span>
                  <span className="font-mono text-xs text-gray-800">{invoice.irn}</span>
                </div>
              </div>
              {!bankPaid ? (
                <button
                  onClick={() => setBankPaid(true)}
                  className="w-full py-3 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  I have paid via bank transfer →
                </button>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700 text-center">
                  Thank you! The seller will confirm your payment and update the invoice.
                </div>
              )}
            </div>
          )}

          {/* QR code */}
          {invoice.qrCode && isAccepted && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col items-center gap-3">
              <p className="text-sm text-gray-500">Scan to verify with FIRS</p>
              <div className="p-3 border border-gray-200 rounded-xl bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={invoice.qrCode.startsWith("data:") ? invoice.qrCode : `data:image/png;base64,${invoice.qrCode}`}
                  alt="FIRS QR Code"
                  width={160}
                  height={160}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 text-center">
        <p className="text-xs text-gray-400">
          Powered by{" "}
          <a href="https://billinx.ng" target="_blank" rel="noreferrer" className="font-medium text-gray-500 hover:text-gray-700">
            Billinx
          </a>{" "}
          · FIRS e-Invoicing Platform
        </p>
      </div>

      {showPayModal && (
        <PayModal invoice={invoice} onClose={() => setShowPayModal(false)} />
      )}
    </>
  );
}
