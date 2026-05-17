import { Injectable } from "@nestjs/common";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

// These element names can legitimately appear multiple times in one document.
const ARRAY_TAGS = new Set([
  "InvoiceLine",
  "TaxTotal",
  "TaxSubtotal",
  "PaymentMeans",
  "AllowanceCharge",
  "BillingReference",
  "AdditionalDocumentReference",
]);

// Maps the Billinx stored enum name back to the NRS/UBL numeric type code.
const STORED_TYPE_TO_NRS: Record<string, string> = {
  STANDARD: "380",
  CREDIT_NOTE: "381",
  DEBIT_NOTE: "383",
  PROFORMA: "325",
};

@Injectable()
export class XmlInvoiceBuilder {
  private readonly builder: XMLBuilder;
  private readonly parser: XMLParser;

  constructor() {
    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: "  ",
      suppressEmptyNode: true,
    });

    this.parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: true,
      trimValues: true,
      isArray: (tagName) => ARRAY_TAGS.has(tagName),
    });
  }

  /** Converts a Billinx DB invoice record to NRS-compliant XML. */
  build(invoice: any, businessId?: string): string {
    const doc = { Invoice: this.toXmlObject(invoice, businessId) };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + this.builder.build(doc);
  }

  /** Parses NRS XML into the Billinx internal invoice request format. */
  parse(xml: string): Record<string, any> {
    const result = this.parser.parse(xml);
    const root: any = result.Invoice ?? result;
    return this.fromXmlObject(root);
  }

  // ---------------------------------------------------------------------------
  // Build (internal → XML)
  // ---------------------------------------------------------------------------

  private toXmlObject(inv: any, businessId?: string): Record<string, any> {
    const meta: any = inv.metadata ?? {};
    const seller: any = meta.sellerParty ?? null;
    const buyer: any = meta.buyerParty ?? null;
    const docRefs: any = inv.documentReferences ?? {};

    const x: Record<string, any> = {};

    if (businessId) x.BusinessId = businessId;
    x.IRN = inv.platformIrn;
    x.IssueDate = this.fmtDate(inv.issueDate);
    if (inv.issueTime) x.IssueTime = inv.issueTime;
    if (inv.dueDate) x.DueDate = this.fmtDate(inv.dueDate);
    x.InvoiceTypeCode = STORED_TYPE_TO_NRS[inv.invoiceTypeCode] ?? inv.invoiceTypeCode;
    if (inv.invoiceKind) x.InvoiceKind = inv.invoiceKind;
    if (inv.paymentStatus) x.PaymentStatus = inv.paymentStatus;
    x.DocumentCurrencyCode = inv.currency;
    if (inv.taxCurrencyCode) x.TaxCurrencyCode = inv.taxCurrencyCode;
    if (inv.note) x.Note = inv.note;
    if (inv.taxPointDate) x.TaxPointDate = this.fmtDate(inv.taxPointDate);
    if (inv.accountingCost) x.AccountingCost = inv.accountingCost;
    if (inv.buyerReference) x.BuyerReference = inv.buyerReference;
    if (inv.orderReference) x.OrderReference = inv.orderReference;
    if (inv.actualDeliveryDate) x.ActualDeliveryDate = this.fmtDate(inv.actualDeliveryDate);
    if (inv.paymentTermsNote) x.PaymentTermsNote = inv.paymentTermsNote;

    if (seller) x.AccountingSupplierParty = this.buildParty(seller);
    if (buyer) x.AccountingCustomerParty = this.buildParty(buyer);

    if (inv.invoiceDeliveryPeriod) {
      const dp: any = inv.invoiceDeliveryPeriod;
      x.InvoiceDeliveryPeriod = { StartDate: dp.startDate, EndDate: dp.endDate };
    }

    const billingRef: any[] = inv.billingReference ?? [];
    if (billingRef.length > 0) {
      x.BillingReference = billingRef.map((b: any) => ({
        IRN: b.irn,
        IssueDate: b.issueDate,
      }));
    }

    if (docRefs.dispatch) x.DispatchDocumentReference = this.buildDocRef(docRefs.dispatch);
    if (docRefs.receipt) x.ReceiptDocumentReference = this.buildDocRef(docRefs.receipt);
    if (docRefs.originator) x.OriginatorDocumentReference = this.buildDocRef(docRefs.originator);
    if (docRefs.contract) x.ContractDocumentReference = this.buildDocRef(docRefs.contract);

    const additional: any[] = docRefs.additional ?? [];
    if (additional.length > 0) {
      x.AdditionalDocumentReference = additional.map((d: any) => this.buildDocRef(d));
    }

    const paymentMeans: any[] = inv.paymentMeans ?? [];
    if (paymentMeans.length > 0) {
      x.PaymentMeans = paymentMeans.map((pm: any) => {
        const p: Record<string, any> = { PaymentMeansCode: pm.paymentMeansCode };
        if (pm.paymentDueDate) p.PaymentDueDate = pm.paymentDueDate;
        return p;
      });
    }

    const allowanceCharges: any[] = inv.allowanceCharges ?? [];
    if (allowanceCharges.length > 0) {
      x.AllowanceCharge = allowanceCharges.map((ac: any) => ({
        ChargeIndicator: ac.chargeIndicator,
        Amount: ac.amount,
      }));
    }

    const taxTotal: any[] = inv.taxTotal ?? [];
    if (taxTotal.length > 0) {
      x.TaxTotal = taxTotal.map((tt: any) => ({
        TaxAmount: tt.taxAmount,
        TaxSubtotal: (tt.taxSubtotal ?? []).map((ts: any) => ({
          TaxableAmount: ts.taxableAmount,
          TaxAmount: ts.taxAmount,
          TaxCategory: {
            ID: ts.taxCategory?.id,
            Percent: ts.taxCategory?.percent,
          },
        })),
      }));
    }

    const lmt: any = inv.legalMonetaryTotal ?? {};
    x.LegalMonetaryTotal = {
      LineExtensionAmount: lmt.lineExtensionAmount,
      TaxExclusiveAmount: lmt.taxExclusiveAmount,
      TaxInclusiveAmount: lmt.taxInclusiveAmount,
      PayableAmount: lmt.payableAmount,
    };
    if (lmt.allowanceTotalAmount != null) {
      x.LegalMonetaryTotal.AllowanceTotalAmount = lmt.allowanceTotalAmount;
    }
    if (lmt.chargeTotalAmount != null) {
      x.LegalMonetaryTotal.ChargeTotalAmount = lmt.chargeTotalAmount;
    }

    const lineItems: any[] = inv.lineItems ?? [];
    if (lineItems.length > 0) {
      x.InvoiceLine = lineItems.map((li: any) => this.buildLineItem(li));
    }

    return x;
  }

  private buildParty(p: any): Record<string, any> {
    const party: Record<string, any> = {
      PartyName: p.partyName,
      TIN: p.tin,
    };
    if (p.email) party.Email = p.email;
    if (p.telephone) party.Telephone = p.telephone;
    if (p.businessDescription) party.BusinessDescription = p.businessDescription;

    const addr: any = p.postalAddress ?? {};
    party.PostalAddress = {
      StreetName: addr.streetName,
      CityName: addr.cityName,
      Country: addr.countryCode,
    };
    if (addr.postalZone) party.PostalAddress.PostalZone = addr.postalZone;
    if (addr.lga) party.PostalAddress.LGA = addr.lga;
    if (addr.state) party.PostalAddress.State = addr.state;

    return party;
  }

  private buildLineItem(li: any): Record<string, any> {
    const line: Record<string, any> = {};
    if (li.hsnCode) line.HSNCode = li.hsnCode;
    if (li.productCategory) line.ProductCategory = li.productCategory;
    line.InvoicedQuantity = li.invoicedQuantity;
    line.LineExtensionAmount = li.lineExtensionAmount;
    if (li.discountRate != null) line.DiscountRate = li.discountRate;
    if (li.discountAmount != null) line.DiscountAmount = li.discountAmount;
    if (li.feeRate != null) line.FeeRate = li.feeRate;
    if (li.feeAmount != null) line.FeeAmount = li.feeAmount;

    const item: any = li.item ?? {};
    line.Item = { Name: item.name };
    if (item.description) line.Item.Description = item.description;
    if (item.sellersItemIdentification) {
      line.Item.SellersItemIdentification = item.sellersItemIdentification;
    }

    const price: any = li.price ?? {};
    line.Price = { PriceAmount: price.priceAmount };
    if (price.baseQuantity != null) line.Price.BaseQuantity = price.baseQuantity;
    if (price.priceUnit) line.Price.PriceUnit = price.priceUnit;

    return line;
  }

  private buildDocRef(d: any): Record<string, any> {
    const ref: Record<string, any> = { IRN: d.irn };
    if (d.issueDate) ref.IssueDate = d.issueDate;
    return ref;
  }

  // ---------------------------------------------------------------------------
  // Parse (XML → internal)
  // ---------------------------------------------------------------------------

  fromXmlObject(xml: any): Record<string, any> {
    const req: Record<string, any> = {
      invoiceTypeCode: String(xml.InvoiceTypeCode ?? ""),
      issueDate: xml.IssueDate,
      currency: xml.DocumentCurrencyCode,
      seller: xml.AccountingSupplierParty
        ? this.fromXmlParty(xml.AccountingSupplierParty)
        : undefined,
      buyer: xml.AccountingCustomerParty
        ? this.fromXmlParty(xml.AccountingCustomerParty)
        : undefined,
      taxTotal: (xml.TaxTotal ?? []).map((tt: any) => ({
        taxAmount: tt.TaxAmount,
        taxSubtotal: (tt.TaxSubtotal ?? []).map((ts: any) => ({
          taxableAmount: ts.TaxableAmount,
          taxAmount: ts.TaxAmount,
          taxCategory: {
            id: ts.TaxCategory?.ID,
            percent: ts.TaxCategory?.Percent,
          },
        })),
      })),
      legalMonetaryTotal: xml.LegalMonetaryTotal
        ? {
            lineExtensionAmount: xml.LegalMonetaryTotal.LineExtensionAmount,
            taxExclusiveAmount: xml.LegalMonetaryTotal.TaxExclusiveAmount,
            taxInclusiveAmount: xml.LegalMonetaryTotal.TaxInclusiveAmount,
            payableAmount: xml.LegalMonetaryTotal.PayableAmount,
          }
        : {},
      lineItems: (xml.InvoiceLine ?? []).map((li: any) => ({
        hsnCode: li.HSNCode,
        productCategory: li.ProductCategory,
        invoicedQuantity: li.InvoicedQuantity,
        lineExtensionAmount: li.LineExtensionAmount,
        discountRate: li.DiscountRate,
        discountAmount: li.DiscountAmount,
        feeRate: li.FeeRate,
        feeAmount: li.FeeAmount,
        item: {
          name: li.Item?.Name,
          description: li.Item?.Description,
          sellersItemIdentification: li.Item?.SellersItemIdentification,
        },
        price: {
          priceAmount: li.Price?.PriceAmount,
          baseQuantity: li.Price?.BaseQuantity,
          priceUnit: li.Price?.PriceUnit,
        },
      })),
    };

    if (xml.IssueTime) req.issueTime = xml.IssueTime;
    if (xml.DueDate) req.dueDate = xml.DueDate;
    if (xml.InvoiceKind) req.invoiceKind = xml.InvoiceKind;
    if (xml.PaymentStatus) req.paymentStatus = xml.PaymentStatus;
    if (xml.TaxCurrencyCode) req.taxCurrencyCode = xml.TaxCurrencyCode;
    if (xml.Note) req.note = xml.Note;
    if (xml.TaxPointDate) req.taxPointDate = xml.TaxPointDate;
    if (xml.AccountingCost) req.accountingCost = xml.AccountingCost;
    if (xml.BuyerReference) req.buyerReference = xml.BuyerReference;
    if (xml.OrderReference) req.orderReference = xml.OrderReference;
    if (xml.ActualDeliveryDate) req.actualDeliveryDate = xml.ActualDeliveryDate;
    if (xml.PaymentTermsNote) req.paymentTermsNote = xml.PaymentTermsNote;

    if (xml.InvoiceDeliveryPeriod) {
      req.invoiceDeliveryPeriod = {
        startDate: xml.InvoiceDeliveryPeriod.StartDate,
        endDate: xml.InvoiceDeliveryPeriod.EndDate,
      };
    }

    if (xml.BillingReference) {
      req.billingReference = xml.BillingReference.map((b: any) => ({
        irn: b.IRN,
        issueDate: b.IssueDate,
      }));
    }

    if (xml.PaymentMeans) {
      req.paymentMeans = xml.PaymentMeans.map((pm: any) => ({
        paymentMeansCode: pm.PaymentMeansCode,
        paymentDueDate: pm.PaymentDueDate,
      }));
    }

    if (xml.AllowanceCharge) {
      req.allowanceCharges = xml.AllowanceCharge.map((ac: any) => ({
        chargeIndicator: ac.ChargeIndicator,
        amount: ac.Amount,
      }));
    }

    if (xml.DispatchDocumentReference) {
      req.dispatchDocumentReference = this.fromXmlDocRef(xml.DispatchDocumentReference);
    }
    if (xml.ReceiptDocumentReference) {
      req.receiptDocumentReference = this.fromXmlDocRef(xml.ReceiptDocumentReference);
    }
    if (xml.OriginatorDocumentReference) {
      req.originatorDocumentReference = this.fromXmlDocRef(xml.OriginatorDocumentReference);
    }
    if (xml.ContractDocumentReference) {
      req.contractDocumentReference = this.fromXmlDocRef(xml.ContractDocumentReference);
    }
    if (xml.AdditionalDocumentReference) {
      req.additionalDocumentReference = xml.AdditionalDocumentReference.map(
        (d: any) => this.fromXmlDocRef(d),
      );
    }

    return req;
  }

  private fromXmlParty(p: any): Record<string, any> {
    const addr: any = p.PostalAddress ?? {};
    return {
      tin: p.TIN,
      partyName: p.PartyName,
      email: p.Email,
      telephone: p.Telephone,
      businessDescription: p.BusinessDescription,
      postalAddress: {
        streetName: addr.StreetName,
        cityName: addr.CityName,
        postalZone: addr.PostalZone,
        lga: addr.LGA,
        state: addr.State,
        countryCode: addr.Country,
      },
    };
  }

  private fromXmlDocRef(d: any): Record<string, any> {
    return { irn: d.IRN, issueDate: d.IssueDate };
  }

  private fmtDate(d: Date | string | null | undefined): string | undefined {
    if (!d) return undefined;
    if (typeof d === "string") return d.substring(0, 10);
    return d.toISOString().substring(0, 10);
  }
}
