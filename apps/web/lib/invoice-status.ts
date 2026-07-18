export type PillVariant =
  | 'red'
  | 'amber'
  | 'green-outline'
  | 'green'
  | 'grey'
  | 'grey-strikethrough';

export interface StatusPill {
  label: string;
  variant: PillVariant;
}

export function getInvoiceStatusPill(inv: {
  status: string;
  paymentStatus?: string;
  isOverdue?: boolean;
  dueDate?: string;
  paymentDueDate?: string;
}): StatusPill {
  const isPaid = inv.paymentStatus === 'PAID';
  const isAccepted = inv.status === 'ACCEPTED';

  // 1. Overdue — accepted + unpaid + past due date
  if (
    isAccepted &&
    !isPaid &&
    (inv.isOverdue || isEffectivelyOverdue(inv.paymentDueDate ?? inv.dueDate))
  ) {
    return { label: 'Overdue', variant: 'red' };
  }

  // 2. Needs attention — FIRS rejected or stuck
  if (
    [
      'REJECTED',
      'SUBMISSION_FAILED',
      'DEAD_LETTERED',
      'VALIDATION_FAILED',
      'PENDING_RESUBMISSION',
    ].includes(inv.status)
  ) {
    return { label: 'Needs attention', variant: 'amber' };
  }

  // 3. Accepted — FIRS accepted, payment not yet received
  if (isAccepted && !isPaid) {
    return { label: 'Accepted', variant: 'green-outline' };
  }

  // 4. Paid
  if (isPaid) {
    return { label: 'Paid', variant: 'green' };
  }

  // 5. Draft
  if (inv.status === 'DRAFT') {
    return { label: 'Draft', variant: 'grey' };
  }

  // 6. Cancelled
  if (inv.status === 'CANCELLED' || inv.status === 'CANCELLATION_REQUESTED') {
    return { label: 'Cancelled', variant: 'grey-strikethrough' };
  }

  // In-flight FIRS states
  if (['QUEUED', 'VALIDATING', 'SUBMITTING'].includes(inv.status)) {
    return { label: 'Pending', variant: 'grey' };
  }

  return { label: inv.status.replace(/_/g, ' '), variant: 'grey' };
}

export function getReceivedInvoiceStatusPill(inv: {
  status: string;
  paymentStatus?: string;
}): StatusPill {
  if (inv.paymentStatus === 'PAID' || inv.status === 'PAID') {
    return { label: 'Paid', variant: 'green' };
  }
  if (inv.status === 'APPROVED') {
    return { label: 'Approved', variant: 'green-outline' };
  }
  if (inv.status === 'RECEIVED' || inv.status === 'VALIDATED') {
    return { label: 'To review', variant: 'amber' };
  }
  if (inv.status === 'REJECTED') {
    return { label: 'Rejected', variant: 'red' };
  }
  return { label: inv.status.replace(/_/g, ' '), variant: 'grey' };
}

function isEffectivelyOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}
