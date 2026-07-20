"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { invoiceApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

import { CreditNotesSection } from "./components/CreditNotesSection";
import { SubmissionProgress } from "./components/SubmissionProgress";
import { InvoiceHeader } from "./components/InvoiceHeader";
import { InvoiceStatusBanners } from "./components/InvoiceStatusBanners";
import { PaymentTrackingCard } from "./components/PaymentTrackingCard";
import { InvoiceHistorySections } from "./components/InvoiceHistorySections";
import { InvoiceBottomBar } from "./components/InvoiceBottomBar";
import { SendToBuyerModal } from "./components/SendToBuyerModal";
import { CancelInvoiceModal } from "./components/CancelInvoiceModal";
import { RecordPaymentModal } from "./components/RecordPaymentModal";
import { InvoiceToasts } from "./components/InvoiceToasts";
import { CreditNoteModal } from "./components/CreditNoteModal";
import type { PaymentRecord, InvoiceDetail, RecordPaymentForm } from "./components/types";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const canViewNrsPayload = user?.role === "OWNER" || user?.role === "ADMIN";
  const isDuplicated = searchParams.get("duplicated") === "true";
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [nrsPayloadDownloading, setNrsPayloadDownloading] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState<RecordPaymentForm>({
    amount: "", provider: "MANUAL", reference: "",
    paidAt: new Date().toISOString().slice(0, 10), notes: "", whtDeducted: "",
  });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const [payLinkCopied, setPayLinkCopied] = useState(false);
  const [payLinkToast, setPayLinkToast] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendingToBuyer, setSendingToBuyer] = useState(false);
  const [sendToBuyerError, setSendToBuyerError] = useState("");
  const [sentToBuyer, setSentToBuyer] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderToast, setReminderToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({
    adjustmentReason: "",
    adjustedAmount: "",
    transactionDate: new Date().toISOString().split("T")[0],
  });
  const [creditNoteSubmitting, setCreditNoteSubmitting] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState("");
  const [creditNoteSuccess, setCreditNoteSuccess] = useState(false);
  const [showingProgress, setShowingProgress] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadPayments = useCallback(async (invoiceId: string) => {
    setPaymentsLoading(true);
    try {
      const res = await invoiceApi.listPayments(invoiceId) as { data: PaymentRecord[] };
      setPayments(res.data ?? []);
    } catch {
      // payments are optional
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  const IN_PROGRESS_STATUSES = ["QUEUED", "SUBMITTING"];

  useEffect(() => {
    invoiceApi.get(id)
      .then((data) => {
        const inv = data as InvoiceDetail;
        setInvoice(inv);
        if (IN_PROGRESS_STATUSES.includes(inv.status)) setShowingProgress(true);
        if (inv.status === "ACCEPTED") loadPayments(id);
      })
      .catch(() => setError("Invoice not found"))
      .finally(() => setLoading(false));
  }, [id, loadPayments]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!invoice || !showingProgress) return;
    if (!IN_PROGRESS_STATUSES.includes(invoice.status)) return;

    pollRef.current = setInterval(async () => {
      try {
        const data = await invoiceApi.get(id) as InvoiceDetail;
        setInvoice(data);
        if (!IN_PROGRESS_STATUSES.includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === "ACCEPTED") {
            loadPayments(id);
            setTimeout(() => setShowingProgress(false), 3000);
          } else {
            setTimeout(() => setShowingProgress(false), 2000);
          }
        }
      } catch {
        // ignore transient errors
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [showingProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCancel() {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      await invoiceApi.cancel(id, cancelReason);
      setShowCancelConfirm(false);
      const updated = await invoiceApi.get(id);
      setInvoice(updated as InvoiceDetail);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  async function handleDownloadPdf() {
    setPdfDownloading(true);
    try {
      const { blob, filename } = await invoiceApi.getPdf(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `invoice-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setPdfDownloading(false);
    }
  }

  async function handleDownloadNrsPayload() {
    setNrsPayloadDownloading(true);
    try {
      const { blob, filename } = await invoiceApi.getNrsPayload(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `nrs-payload-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setNrsPayloadDownloading(false);
    }
  }

  async function handleRecordPayment() {
    if (!invoice) return;
    setPaymentError("");
    setPaymentSubmitting(true);
    try {
      await invoiceApi.recordPayment(invoice.id, {
        amount: parseFloat(paymentForm.amount),
        provider: paymentForm.provider,
        reference: paymentForm.reference,
        paidAt: new Date(paymentForm.paidAt).toISOString(),
        notes: paymentForm.notes || undefined,
        whtDeducted: paymentForm.whtDeducted ? parseFloat(paymentForm.whtDeducted) : undefined,
      });
      setShowPaymentModal(false);
      const updated = await invoiceApi.get(id) as InvoiceDetail;
      setInvoice(updated);
      loadPayments(id);
    } catch (err: unknown) {
      setPaymentError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function handleSendToBuyer() {
    setSendingToBuyer(true);
    setSendToBuyerError("");
    try {
      await invoiceApi.sendToBuyer(id);
      setSentToBuyer(true);
      setTimeout(() => setShowSendModal(false), 1800);
    } catch (err: unknown) {
      setSendToBuyerError(err instanceof Error ? err.message : "Failed to send invoice.");
    } finally {
      setSendingToBuyer(false);
    }
  }

  async function handleSendReminder() {
    if (!invoice) return;
    setSendingReminder(true);
    try {
      const res = await invoiceApi.sendReminder(id) as { sentTo: string };
      setReminderToast({ message: `Reminder sent to ${res.sentTo}`, type: "success" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send reminder.";
      setReminderToast({ message: msg, type: "error" });
    } finally {
      setSendingReminder(false);
      setTimeout(() => setReminderToast(null), 4000);
    }
  }

  function copyPaymentLink() {
    const link = `${window.location.origin}/pay/${invoice!.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setPayLinkCopied(true);
      setPayLinkToast(true);
      setTimeout(() => setPayLinkCopied(false), 2000);
      setTimeout(() => setPayLinkToast(false), 2500);
    });
  }

  function handleCreateCorrected() {
    if (!invoice) return;
    window.location.href = `/invoices/new?originalIrn=${encodeURIComponent(invoice.platformIrn)}&type=${invoice.invoiceType}`;
  }

  async function handleDuplicate() {
    if (!invoice) return;
    setDuplicating(true);
    try {
      const res = await invoiceApi.duplicate(invoice.id) as { id: string };
      router.push(`/invoices/${res.id}?duplicated=true`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to duplicate invoice.");
    } finally {
      setDuplicating(false);
    }
  }

  function handleCreateCreditNote() {
    if (!invoice) return;
    setCreditNoteForm({
      adjustmentReason: "",
      adjustedAmount: String(invoice.totalAmount),
      transactionDate: new Date().toISOString().split("T")[0],
    });
    setCreditNoteError("");
    setCreditNoteSuccess(false);
    setShowCreditNoteModal(true);
  }

  async function handleSubmitCreditNote() {
    if (!invoice) return;
    setCreditNoteSubmitting(true);
    setCreditNoteError("");
    try {
      await invoiceApi.createCreditNote(invoice.id, {
        adjustmentReason: creditNoteForm.adjustmentReason,
        adjustedAmount: Number(creditNoteForm.adjustedAmount),
        transactionDate: creditNoteForm.transactionDate,
      });
      setCreditNoteSuccess(true);
      setTimeout(() => setShowCreditNoteModal(false), 1800);
    } catch (err: unknown) {
      setCreditNoteError(err instanceof Error ? err.message : "Failed to issue credit note.");
    } finally {
      setCreditNoteSubmitting(false);
    }
  }

  function openSendModal() {
    setSendToBuyerError("");
    setSentToBuyer(false);
    setShowSendModal(true);
  }

  if (loading) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-6 space-y-6">
          <div className="bg-white rounded-xl border border-border p-6">
            <Skeleton className="h-7 w-28 mb-4" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-32 mb-2" />
              {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
            <div className="bg-white rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-24 mb-2" />
              {[0,1,2,3].map(i => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border p-6 space-y-3">
            <Skeleton className="h-5 w-32 mb-2" />
            {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        </div>
      </>
    );
  }

  if (error || !invoice) {
    return (
      <>
        <Topbar title="Invoice" />
        <div className="p-6">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
        </div>
      </>
    );
  }

  if (showingProgress && invoice) {
    return (
      <>
        <div className="bg-white border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-dark">Submitting to FIRS</h1>
            <p className="text-xs text-muted font-mono mt-0.5">{invoice.platformIrn}</p>
          </div>
          <Link href="/invoices"><Button variant="secondary" size="sm">← Sales Invoices</Button></Link>
        </div>
        <SubmissionProgress invoice={invoice} onCorrect={() => {
          window.location.href = `/invoices/new?originalIrn=${encodeURIComponent(invoice.platformIrn)}&type=${invoice.invoiceType}`;
        }} />
      </>
    );
  }

  const isAccepted = invoice.status === "ACCEPTED";
  const isDraft = invoice.status === "DRAFT";
  const isRejected = ["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED"].includes(invoice.status);
  const canCancel = ["DRAFT", "QUEUED", "VALIDATION_FAILED", "ACCEPTED"].includes(invoice.status);
  const canRecordPayment = isAccepted && invoice.paymentStatus !== "PAID";
  const canSendReminder = isAccepted && invoice.paymentStatus !== "PAID" && !!invoice.buyerEmail;
  const amountOutstanding = invoice.totalAmount - (invoice.amountPaid ?? 0);
  const collectedPct = invoice.totalAmount > 0
    ? Math.round(((invoice.amountPaid ?? 0) / invoice.totalAmount) * 100)
    : 0;

  const pageTitle = isAccepted ? "Invoice accepted" : isRejected ? "Invoice rejected" : "Invoice";
  const pageSubtitle = isAccepted
    ? `${invoice.platformIrn?.slice(0, 24) ?? invoice.id} · FIRS validated · IRN issued`
    : isRejected
    ? `${invoice.platformIrn?.slice(0, 24) ?? invoice.id} · Action required`
    : undefined;

  function openPaymentModal() {
    const defaultAmount = invoice?.whtApplicable
      ? (invoice.expectedCash ?? amountOutstanding)
      : (amountOutstanding > 0 ? amountOutstanding : invoice!.totalAmount);
    setPaymentForm({
      amount: String(defaultAmount),
      provider: "MANUAL", reference: "",
      paidAt: new Date().toISOString().slice(0, 10), notes: "",
      whtDeducted: invoice?.whtApplicable ? String(invoice.whtAmount ?? "") : "",
    });
    setPaymentError("");
    setShowPaymentModal(true);
  }

  return (
    <>
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <InvoiceHeader
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        invoiceId={invoice.id}
        isDraft={isDraft}
        isAccepted={isAccepted}
        isRejected={isRejected}
        canRecordPayment={canRecordPayment}
        canSendReminder={canSendReminder}
        canCancel={canCancel}
        canViewNrsPayload={canViewNrsPayload}
        payLinkCopied={payLinkCopied}
        pdfDownloading={pdfDownloading}
        nrsPayloadDownloading={nrsPayloadDownloading}
        duplicating={duplicating}
        sendingReminder={sendingReminder}
        onDownloadNrsPayload={handleDownloadNrsPayload}
        onCopyPaymentLink={copyPaymentLink}
        onDownloadPdf={handleDownloadPdf}
        onDuplicate={handleDuplicate}
        onCreateCorrected={handleCreateCorrected}
        onOpenPaymentModal={openPaymentModal}
        onSendReminder={handleSendReminder}
        onOpenCancelConfirm={() => setShowCancelConfirm(true)}
      />

      <div className="p-6 space-y-6 pb-24">
        <InvoiceStatusBanners
          invoice={invoice}
          isAccepted={isAccepted}
          isRejected={isRejected}
          showDuplicatedBanner={showDuplicatedBanner}
          onDismissDuplicatedBanner={() => setShowDuplicatedBanner(false)}
          payLinkCopied={payLinkCopied}
          onCopyPaymentLink={copyPaymentLink}
          onCreateCreditNote={handleCreateCreditNote}
          onCreateCorrected={handleCreateCorrected}
        />

        {/* Payment tracking — accepted invoices */}
        {isAccepted && (
          <PaymentTrackingCard
            invoice={invoice}
            payments={payments}
            paymentsLoading={paymentsLoading}
            canRecordPayment={canRecordPayment}
            amountOutstanding={amountOutstanding}
            collectedPct={collectedPct}
            onOpenPaymentModal={openPaymentModal}
          />
        )}

        {/* Credit notes — accepted invoices that have at least one credit note */}
        {isAccepted && invoice.creditNotes && invoice.creditNotes.length > 0 && (
          <CreditNotesSection
            creditNotes={invoice.creditNotes}
            currency={invoice.currency}
            totalAmount={invoice.totalAmount}
          />
        )}

        {/* Invoice document */}
        {(isAccepted || isRejected) && (
          <div>
            <h2 className="font-semibold text-dark mb-4">Invoice document</h2>
            <p className="text-sm text-muted mb-4">
              {isAccepted
                ? "This is the FIRS-certified document your buyer receives. The QR code lets them verify it directly with FIRS."
                : "Invoice document — fields highlighted in red indicate data rejected by FIRS."}
            </p>
            <InvoiceDocument
              platformIrn={invoice.platformIrn}
              firsConfirmedIrn={invoice.firsConfirmedIrn}
              status={invoice.status}
              rejectionCode={invoice.rejectionCode}
              issueDate={invoice.issueDate}
              paymentDueDate={invoice.paymentDueDate}
              sellerName={invoice.sellerName}
              sellerTin={invoice.sellerTin}
              sellerAddress={invoice.sellerAddress}
              buyerName={invoice.buyerName}
              buyerTin={invoice.buyerTin}
              buyerAddress={invoice.buyerAddress}
              currency={invoice.currency}
              totalAmount={invoice.totalAmount}
              taxAmount={invoice.taxAmount}
              lineItems={invoice.lineItems}
              qrCode={invoice.qrCode}
              qrCodeBase64={invoice.qrCodeBase64}
              invoiceId={invoice.id}
            />
          </div>
        )}

        <InvoiceHistorySections
          submissionAttempts={invoice.submissionAttempts}
          stateHistory={invoice.stateHistory}
        />
      </div>

      {/* ── Bottom sticky action bar ────────────────────────────────────────── */}
      <InvoiceBottomBar
        isAccepted={isAccepted}
        isRejected={isRejected}
        canRecordPayment={canRecordPayment}
        duplicating={duplicating}
        pdfDownloading={pdfDownloading}
        onOpenSendModal={openSendModal}
        onDuplicate={handleDuplicate}
        onDownloadPdf={handleDownloadPdf}
        onOpenPaymentModal={openPaymentModal}
        onCreateCorrected={handleCreateCorrected}
      />

      {/* ── Send to buyer modal ─────────────────────────────────────────────── */}
      <SendToBuyerModal
        open={showSendModal}
        invoice={invoice}
        sentToBuyer={sentToBuyer}
        sendingToBuyer={sendingToBuyer}
        sendToBuyerError={sendToBuyerError}
        onClose={() => setShowSendModal(false)}
        onSend={handleSendToBuyer}
      />

      {/* ── Cancel modal ───────────────────────────────────────────────────── */}
      <CancelInvoiceModal
        open={showCancelConfirm}
        cancelReason={cancelReason}
        cancelling={cancelling}
        onReasonChange={setCancelReason}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancel}
      />

      {/* ── Record payment modal ────────────────────────────────────────────── */}
      <RecordPaymentModal
        open={showPaymentModal}
        invoice={invoice}
        form={paymentForm}
        submitting={paymentSubmitting}
        error={paymentError}
        onFormChange={setPaymentForm}
        onClose={() => setShowPaymentModal(false)}
        onSubmit={handleRecordPayment}
      />

      <InvoiceToasts payLinkToast={payLinkToast} reminderToast={reminderToast} />

      {/* ── Issue credit note modal ─────────────────────────────────────────── */}
      <CreditNoteModal
        open={showCreditNoteModal}
        invoice={invoice}
        form={creditNoteForm}
        submitting={creditNoteSubmitting}
        error={creditNoteError}
        success={creditNoteSuccess}
        onFormChange={setCreditNoteForm}
        onClose={() => setShowCreditNoteModal(false)}
        onSubmit={handleSubmitCreditNote}
      />
    </>
  );
}
