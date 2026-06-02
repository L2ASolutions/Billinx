"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { publicPayApi } from "@/lib/api";

type VerifyStatus = "loading" | "success" | "failed" | "pending";

interface VerifyResult {
  status: string;
  amount?: number;
  reference?: string;
  paidAt?: string;
  customerEmail?: string;
}

export default function PaymentCallbackPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const searchParams = useSearchParams();
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [currency, setCurrency] = useState("NGN");

  useEffect(() => {
    const reference = searchParams.get("reference") ?? searchParams.get("trxref");
    const flwStatus = searchParams.get("status");

    if (flwStatus === "successful" || flwStatus === "completed") {
      setVerifyStatus("success");
      setResult({ status: "success", reference: searchParams.get("tx_ref") ?? undefined });
      return;
    }

    if (!reference) {
      setVerifyStatus("failed");
      return;
    }

    publicPayApi.paystackVerify(reference)
      .then((data: unknown) => {
        const d = data as VerifyResult;
        setResult(d);
        if (d.status === "success") {
          setVerifyStatus("success");
        } else if (d.status === "pending") {
          setVerifyStatus("pending");
        } else {
          setVerifyStatus("failed");
        }
      })
      .catch(() => {
        // verification failed — treat as success if Flutterwave redirected here with status=successful
        if (flwStatus) {
          setVerifyStatus(flwStatus === "successful" ? "success" : "failed");
        } else {
          setVerifyStatus("failed");
        }
      });

    // Also get currency from invoice
    publicPayApi.getInvoice(invoiceId)
      .then((inv: unknown) => setCurrency((inv as { currency: string }).currency ?? "NGN"))
      .catch(() => {});
  }, [invoiceId, searchParams]);

  function fmt(amount: number) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-2">
        <span className="text-xl font-bold text-gray-900">Billinx</span>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-500">Payment Result</span>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm w-full max-w-sm p-8 text-center">

          {verifyStatus === "loading" && (
            <>
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <svg className="animate-spin text-blue-500" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                </svg>
              </div>
              <p className="font-semibold text-gray-700 text-lg mb-1">Verifying payment…</p>
              <p className="text-sm text-gray-500">Please wait while we confirm your payment.</p>
            </>
          )}

          {verifyStatus === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="font-bold text-gray-900 text-xl mb-1">Payment successful!</p>
              {result?.amount && (
                <p className="text-2xl font-bold text-green-600 mb-3">{fmt(result.amount)}</p>
              )}
              <p className="text-sm text-gray-500 mb-6">Your payment has been recorded.</p>

              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-left space-y-2 mb-6 text-sm">
                {result?.reference && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Reference</span>
                    <span className="font-mono text-xs text-gray-700">{result.reference}</span>
                  </div>
                )}
                {result?.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Date</span>
                    <span className="text-gray-700">{new Date(result.paidAt).toLocaleString("en-NG")}</span>
                  </div>
                )}
                {result?.customerEmail && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Email</span>
                    <span className="text-gray-700">{result.customerEmail}</span>
                  </div>
                )}
              </div>

              <Link
                href={`/pay/${invoiceId}`}
                className="block w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-colors"
              >
                View invoice →
              </Link>
            </>
          )}

          {verifyStatus === "pending" && (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <p className="font-bold text-gray-900 text-xl mb-1">Payment pending</p>
              <p className="text-sm text-gray-500 mb-6">Your payment is being processed. You will receive a confirmation once it clears.</p>
              <Link
                href={`/pay/${invoiceId}`}
                className="block w-full py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
              >
                Back to invoice
              </Link>
            </>
          )}

          {verifyStatus === "failed" && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-600">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <p className="font-bold text-gray-900 text-xl mb-1">Payment was not completed</p>
              <p className="text-sm text-gray-500 mb-6">Your payment was not successful. No amount was charged.</p>
              <Link
                href={`/pay/${invoiceId}`}
                className="block w-full py-3 rounded-xl bg-gray-900 text-white font-semibold text-sm hover:bg-gray-700 transition-colors"
              >
                Try again →
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="py-4 text-center">
        <p className="text-xs text-gray-400">
          Powered by{" "}
          <a href="https://billinx.ng" target="_blank" rel="noreferrer" className="font-medium text-gray-500">
            Billinx
          </a>{" "}
          · FIRS e-Invoicing Platform
        </p>
      </div>
    </div>
  );
}
