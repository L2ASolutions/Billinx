export interface OriginalInvoiceReference {
  originalIrn: string;
  issueDate: string;
  buyer: {
    partyName?: string;
    tin?: string;
    email?: string;
    telephone?: string;
    businessDescription?: string;
    postalAddress?: { streetName?: string; state?: string; lga?: string };
  };
}

// "found": the IRN resolved to an invoice in this tenant — date and buyer are
// locked to the stored original (the backend enforces the same values).
// "manual": not in Billinx (external, typo, or another tenant's) — user types them.
export type OriginalRefStatus = "idle" | "loading" | "found" | "manual" | "error";

export function originalReferenceToFormFields(ref: OriginalInvoiceReference) {
  const b = ref.buyer ?? {};
  return {
    billingReferenceDate: ref.issueDate ?? "",
    buyerName: b.partyName ?? "",
    buyerTin: b.tin ?? "",
    buyerEmail: b.email ?? "",
    buyerTelephone: b.telephone ?? "",
    buyerBusinessDescription: b.businessDescription ?? "",
    buyerAddress: b.postalAddress?.streetName ?? "",
    buyerState: b.postalAddress?.state ?? "",
    buyerLga: b.postalAddress?.lga ?? "",
  };
}

export function statusForLookupError(err: unknown): OriginalRefStatus {
  return (err as { status?: number })?.status === 404 ? "manual" : "error";
}
