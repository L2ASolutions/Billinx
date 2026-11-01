// Credit/debit notes reference an original invoice by IRN. When that original
// lives in the same tenant, its stored issue date and buyer snapshot are the
// source of truth: a note must name the same buyer as the original (a buyer or
// TIN change means crediting the original in full and issuing a new invoice),
// so a client-supplied value that differs is rejected, never replaced.

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

const MISMATCH_LABELS: Record<string, string> = {
  'buyer.partyName': 'buyer name',
  'buyer.tin': 'buyer TIN',
  'buyer.email': 'buyer email',
  'billingReference.issueDate': 'original invoice date',
};

function normalise(value: unknown, caseInsensitive: boolean): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return caseInsensitive ? text.toLowerCase() : text;
}

// Compares only the fields the client actually supplied — an omitted field is
// not a difference and is filled from the original. Buyer identity is name,
// TIN and email; the rest of the party (address, phone) always comes from the
// original snapshot.
export function findOriginalInvoiceMismatches(
  request: Record<string, any>,
  ref: OriginalInvoiceReference,
): string[] {
  const mismatches: string[] = [];
  const clientBuyer = request.buyer ?? {};
  const checks: Array<[string, boolean]> = [
    ['partyName', true],
    ['tin', false],
    ['email', true],
  ];
  for (const [field, caseInsensitive] of checks) {
    const supplied = normalise(clientBuyer[field], caseInsensitive);
    if (supplied && supplied !== normalise(ref.buyer[field], caseInsensitive)) {
      mismatches.push(`buyer.${field}`);
    }
  }

  const clientDate = normalise(request.billingReference?.[0]?.issueDate, false);
  if (clientDate && clientDate.slice(0, 10) !== ref.issueDate) {
    mismatches.push('billingReference.issueDate');
  }
  return mismatches;
}

export function describeOriginalInvoiceMismatch(
  originalIrn: string,
  mismatches: string[],
): string {
  const fields = mismatches.map((m) => MISMATCH_LABELS[m] ?? m).join(', ');
  return (
    `A credit/debit note must match original invoice ${originalIrn}. ` +
    `Mismatched: ${fields}. To change the buyer or TIN, credit the original ` +
    'invoice in full and issue a new invoice to the correct buyer.'
  );
}

export function applyOriginalInvoiceReference<T extends Record<string, any>>(
  request: T,
  ref: OriginalInvoiceReference,
): T & {
  buyer: Record<string, unknown>;
  billingReference: Array<{ irn: string; issueDate: string }>;
} {
  return {
    ...request,
    buyer: ref.buyer,
    billingReference: [{ irn: ref.originalIrn, issueDate: ref.issueDate }],
  };
}
