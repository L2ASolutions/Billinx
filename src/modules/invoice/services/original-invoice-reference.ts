// Credit/debit notes reference an original invoice by IRN. When that original
// lives in the same tenant, its stored issue date and buyer snapshot are the
// source of truth for the note — client-supplied values are overridden.

export const CREDIT_OR_DEBIT_NOTE_TYPES = new Set([
  'CREDIT_NOTE',
  'DEBIT_NOTE',
]);

export interface OriginalInvoiceSnapshot {
  issueDate: Date;
  buyerName: string;
  buyerTin: string | null;
  buyerEmail: string | null;
  metadata: unknown;
}

export interface OriginalInvoiceReference {
  originalIrn: string;
  issueDate: string;
  buyer: Record<string, unknown>;
}

// Same UTC YYYY-MM-DD formatting InterswitchAdapter uses for
// billing_reference[].issue_date, so the form shows exactly what NRS receives.
function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function toOriginalInvoiceReference(
  originalIrn: string,
  snapshot: OriginalInvoiceSnapshot,
): OriginalInvoiceReference {
  const storedParty = (snapshot.metadata as any)?.buyerParty;
  const party: Record<string, unknown> =
    storedParty && typeof storedParty === 'object' ? { ...storedParty } : {};
  const partyEmail = typeof party.email === 'string' ? party.email : undefined;
  delete party.partyName;
  delete party.tin;
  delete party.email;

  // The invoice's own columns win over metadata.buyerParty — they are what
  // InterswitchAdapter sends as accounting_customer_party.party_name/tin.
  const email = snapshot.buyerEmail ?? partyEmail;
  return {
    originalIrn,
    issueDate: toISODate(snapshot.issueDate),
    buyer: {
      ...party,
      partyName: snapshot.buyerName,
      ...(snapshot.buyerTin ? { tin: snapshot.buyerTin } : {}),
      ...(email ? { email } : {}),
    },
  };
}

export function applyOriginalInvoiceReference<T extends Record<string, any>>(
  request: T,
  ref: OriginalInvoiceReference,
): {
  request: T & {
    buyer: Record<string, unknown>;
    billingReference: Array<{ irn: string; issueDate: string }>;
  };
  overriddenFields: string[];
} {
  const overriddenFields: string[] = [];

  const clientBuyer = request.buyer;
  if (
    clientBuyer &&
    ((clientBuyer.partyName ?? '') !== (ref.buyer.partyName ?? '') ||
      (clientBuyer.tin ?? '') !== (ref.buyer.tin ?? '') ||
      (clientBuyer.email ?? '') !== (ref.buyer.email ?? ''))
  ) {
    overriddenFields.push('buyer');
  }

  const clientDate = request.billingReference?.[0]?.issueDate;
  if (clientDate && String(clientDate).slice(0, 10) !== ref.issueDate) {
    overriddenFields.push('billingReference.issueDate');
  }

  return {
    request: {
      ...request,
      buyer: ref.buyer,
      billingReference: [{ irn: ref.originalIrn, issueDate: ref.issueDate }],
    },
    overriddenFields,
  };
}
