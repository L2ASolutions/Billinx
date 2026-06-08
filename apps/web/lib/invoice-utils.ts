export interface StatusPill {
  label: string;
  cls: string;
  strikethrough?: boolean;
}

export function getInvoiceStatusPill(inv: {
  status: string;
  paymentStatus?: string;
  isOverdue?: boolean;
  dueDate?: string;
  paymentDueDate?: string;
}): StatusPill {
  const isPaid = inv.paymentStatus === "PAID";
  const isAccepted = inv.status === "ACCEPTED";

  // 1. Overdue — accepted + unpaid + past due
  if (isAccepted && !isPaid && (inv.isOverdue || isEffectivelyOverdue(inv.paymentDueDate ?? inv.dueDate))) {
    return { label: "Overdue", cls: "bg-red-100 text-red-800" };
  }

  // 2. Needs attention — FIRS rejected or failed states
  if (["REJECTED", "SUBMISSION_FAILED", "DEAD_LETTERED", "VALIDATION_FAILED", "PENDING_RESUBMISSION"].includes(inv.status)) {
    return { label: "Needs attention", cls: "bg-amber-100 text-amber-800" };
  }

  // 3. Accepted — FIRS accepted, not yet paid
  if (isAccepted && !isPaid) {
    return { label: "Accepted", cls: "bg-green-50 text-green-700 ring-1 ring-green-200" };
  }

  // 4. Paid
  if (isPaid) {
    return { label: "Paid", cls: "bg-green-100 text-green-800" };
  }

  // 5. Partial payment
  if (inv.paymentStatus === "PARTIAL") {
    return { label: "Part paid", cls: "bg-teal-50 text-teal-700" };
  }

  // 6. In-flight FIRS states
  if (inv.status === "SUBMITTING") {
    return { label: "Submitting", cls: "bg-blue-50 text-blue-700" };
  }
  if (inv.status === "QUEUED" || inv.status === "VALIDATING") {
    return { label: "Processing", cls: "bg-amber-50 text-amber-700" };
  }

  // 7. Draft
  if (inv.status === "DRAFT") {
    return { label: "Draft", cls: "bg-gray-100 text-gray-500" };
  }

  // 8. Cancelled
  if (inv.status === "CANCELLED" || inv.status === "CANCELLATION_REQUESTED") {
    return { label: "Cancelled", cls: "bg-gray-100 text-gray-400", strikethrough: true };
  }

  return { label: inv.status.replace(/_/g, " "), cls: "bg-gray-100 text-gray-600" };
}

function isEffectivelyOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}
