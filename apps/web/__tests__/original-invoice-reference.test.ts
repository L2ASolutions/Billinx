import { describe, expect, it } from "vitest";
import {
  originalReferenceToFormFields,
  statusForLookupError,
} from "@/lib/original-invoice-reference";

describe("originalReferenceToFormFields", () => {
  it("maps the stored original date and buyer snapshot onto the form fields", () => {
    expect(
      originalReferenceToFormFields({
        originalIrn: "INV-1",
        issueDate: "2026-10-01",
        buyer: {
          partyName: "Original Buyer Ltd",
          tin: "11111111-0001",
          email: "ap@original.ng",
          telephone: "+2348000000000",
          businessDescription: "Retail",
          postalAddress: { streetName: "1 Broad St", state: "NG-LA", lga: "NG-LA-IKJ" },
        },
      }),
    ).toEqual({
      billingReferenceDate: "2026-10-01",
      buyerName: "Original Buyer Ltd",
      buyerTin: "11111111-0001",
      buyerEmail: "ap@original.ng",
      buyerTelephone: "+2348000000000",
      buyerBusinessDescription: "Retail",
      buyerAddress: "1 Broad St",
      buyerState: "NG-LA",
      buyerLga: "NG-LA-IKJ",
    });
  });

  it("blanks fields the original never had, so stale values from a previous lookup are cleared", () => {
    const fields = originalReferenceToFormFields({
      originalIrn: "INV-2",
      issueDate: "2026-09-01",
      buyer: { partyName: "B2C Customer" },
    });
    expect(fields.buyerTin).toBe("");
    expect(fields.buyerEmail).toBe("");
    expect(fields.buyerAddress).toBe("");
    expect(fields.buyerState).toBe("");
  });
});

describe("statusForLookupError", () => {
  it("treats 404 (unknown or another tenant's IRN) as manual entry", () => {
    expect(statusForLookupError(Object.assign(new Error("x"), { status: 404 }))).toBe("manual");
  });

  it("treats other failures as a lookup error, not 'not found'", () => {
    expect(statusForLookupError(Object.assign(new Error("x"), { status: 500 }))).toBe("error");
    expect(statusForLookupError(new Error("network"))).toBe("error");
  });
});
