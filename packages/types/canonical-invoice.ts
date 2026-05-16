export const SCHEMA_VERSION = "2.0";

export type InvoiceTypeCode = "380" | "381" | "383" | "325" | "386" | "388" | "389" | "390" | "393" | "394" | "395" | "396" | "420" | "456" | "457";

export type InvoiceStatus = "DRAFT" | "VALIDATING" | "VALIDATION_FAILED" | "QUEUED" | "SUBMITTING" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "SUBMISSION_FAILED" | "DEAD_LETTERED" | "CANCELLATION_REQUESTED" | "CANCELLED";

export type TaxCategoryId =
  | "STANDARD_VAT" | "ZERO_VAT" | "REDUCED_VAT"
  | "STANDARD_GST" | "ZERO_GST" | "REDUCED_GST"
  | "WITHHOLDING_TAX" | "STAMP_DUTY" | "LOCAL_SALES_TAX" | "STATE_SALES_TAX"
  | "SERVICE_TAX" | "LUXURY_TAX" | "TOURISM_TAX"
  | "ALCOHOL_EXCISE_TAX" | "TOBACCO_EXCISE_TAX" | "FUEL_EXCISE_TAX"
  | "CORPORATE_INCOME_TAX" | "PERSONAL_INCOME_TAX" | "SOCIAL_SECURITY_TAX"
  | "REAL_ESTATE_TAX" | "CARBON_TAX" | "PLASTIC_TAX"
  | "IMPORT_DUTY" | "EXPORT_DUTY" | "MEDICARE_TAX" | "PERSONAL_PROPERTY_TAX"
  | "EXEMPTED"
  // legacy aliases (still accepted, normalised on submission)
  | "VAT" | "WHT" | "EXEMPT" | "ZERO_RATED" | "NOT_APPLICABLE";

export type PaymentMeansCode = "10" | "20" | "30" | "42" | "43" | "48" | "49" | "57" | "58" | "97" | string;

export interface CanonicalAddress {
  streetName: string;
  cityName: string;
  postalZone?: string;
  lga?: string;
  state?: string;
  countryCode: string;
}

export interface CanonicalParty {
  tin: string;
  partyName: string;
  email?: string;
  telephone?: string;
  businessDescription?: string;
  postalAddress: CanonicalAddress;
}

export interface CanonicalTaxCategory {
  id: TaxCategoryId;
  percent: number;
  exemptionCode?: string;
  exemptionReason?: string;
}

export interface CanonicalTaxSubtotal {
  taxableAmount: number;
  taxAmount: number;
  taxCategory: CanonicalTaxCategory;
}

export interface CanonicalTaxTotal {
  taxAmount: number;
  taxSubtotal: CanonicalTaxSubtotal[];
}

export interface CanonicalLegalMonetaryTotal {
  lineExtensionAmount: number;
  taxExclusiveAmount: number;
  taxInclusiveAmount: number;
  allowanceTotalAmount?: number;
  chargeTotalAmount?: number;
  payableAmount: number;
  payableRoundingAmount?: number;
}

export interface CanonicalPrice {
  priceAmount: number;
  baseQuantity?: number;
  priceUnit?: string;
}

export interface CanonicalItem {
  name: string;
  description?: string;
  sellersItemIdentification?: string;
  buyersItemIdentification?: string;
  standardItemIdentification?: string;
}

export interface CanonicalLineItem {
  lineNumber: number;
  hsnCode?: string;
  productCategory?: string;
  invoicedQuantity: number;
  unitOfMeasure?: string;
  lineExtensionAmount: number;
  discountRate?: number;
  discountAmount?: number;
  feeRate?: number;
  feeAmount?: number;
  item: CanonicalItem;
  price: CanonicalPrice;
  taxTotal?: CanonicalTaxTotal;
}

export interface CanonicalPaymentMeans {
  paymentMeansCode: PaymentMeansCode;
  paymentDueDate?: string;
  paymentChannelCode?: string;
  paymentNote?: string;
  bankAccountNumber?: string;
  bankName?: string;
}

export interface CanonicalAllowanceCharge {
  chargeIndicator: boolean;
  amount: number;
  baseAmount?: number;
  multiplierFactorNumeric?: number;
  reason?: string;
  reasonCode?: string;
  taxCategory?: CanonicalTaxCategory;
}

export interface CanonicalDocumentReference {
  irn: string;
  issueDate?: string;
  documentType?: string;
  documentDescription?: string;
}

export interface CanonicalDeliveryPeriod {
  startDate: string;
  endDate: string;
}

export interface CanonicalInvoice {
  schemaVersion: string;
  invoiceTypeCode: InvoiceTypeCode;
  platformIrn?: string;
  firsConfirmedIrn?: string;
  sourceReference?: string;
  buyerReference?: string;
  orderReference?: string;
  accountingCost?: string;
  seller: CanonicalParty;
  buyer: CanonicalParty;
  issueDate: string;
  dueDate?: string;
  taxPointDate?: string;
  actualDeliveryDate?: string;
  invoiceDeliveryPeriod?: CanonicalDeliveryPeriod;
  currency: string;
  taxCurrencyCode?: string;
  exchangeRate?: number;
  exchangeRateSource?: string;
  billingReference?: CanonicalDocumentReference[];
  dispatchDocumentReference?: CanonicalDocumentReference;
  receiptDocumentReference?: CanonicalDocumentReference;
  originatorDocumentReference?: CanonicalDocumentReference;
  contractDocumentReference?: CanonicalDocumentReference;
  additionalDocumentReference?: CanonicalDocumentReference[];
  paymentMeans?: CanonicalPaymentMeans[];
  paymentTermsNote?: string;
  allowanceCharges?: CanonicalAllowanceCharge[];
  taxTotal: CanonicalTaxTotal[];
  legalMonetaryTotal: CanonicalLegalMonetaryTotal;
  lineItems: CanonicalLineItem[];
  note?: string;
  metadata?: Record<string, unknown>;
  readonly id?: string;
  readonly status?: InvoiceStatus;
  readonly qrCodeBase64?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type CreateInvoiceRequest = Omit<CanonicalInvoice, "platformIrn" | "firsConfirmedIrn" | "id" | "status" | "qrCodeBase64" | "createdAt" | "updatedAt">;

export interface InvoiceResponse {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  status: InvoiceStatus;
  qrCodeBase64?: string;
  submittedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  createdAt: string;
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface ValidationResult {
  valid: boolean;
  invoiceTypeCode: InvoiceTypeCode;
  platformIrn?: string;
  errors: ValidationError[];
  warnings: ValidationError[];
}
