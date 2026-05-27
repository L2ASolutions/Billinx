// packages/types/invoice.ts

export type InvoiceStatus =
  | "DRAFT"
  | "VALIDATING"
  | "VALIDATION_FAILED"
  | "QUEUED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "SUBMISSION_FAILED"
  | "DEAD_LETTERED"
  | "CANCELLATION_REQUESTED"
  | "CANCELLED";

export type InvoiceTypeCode =
  | "380" | "381" | "383" | "325" | "386" | "388"
  | "389" | "390" | "393" | "394" | "395" | "396"
  | "420" | "456" | "457";

export interface CancelInvoiceRequest {
  reason: string;
}

export interface InvoiceFilterParams {
  status?: InvoiceStatus;
  invoiceTypeCode?: InvoiceTypeCode;
  sellerTin?: string;
  buyerTin?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  // Dashboard filters (BUG-012)
  search?: string;
  paymentStatus?: string;
  isOverdue?: boolean;
}

export interface InvoiceResponse {
  id: string;
  tenantId: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  sourceReference?: string;
  invoiceTypeCode: InvoiceTypeCode;
  invoiceType?: string;
  invoiceKind?: string;
  status: InvoiceStatus;
  sellerTin: string;
  sellerName: string;
  buyerTin?: string;
  buyerName: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  subtotal: number;
  vatAmount: number;
  taxAmount?: number;
  totalAmount: number;
  amountPaid?: number;
  paymentStatus?: string;
  paymentDueDate?: string;
  isOverdue?: boolean;
  lineItems: any[];
  taxTotal: any[];
  legalMonetaryTotal: any;
  paymentMeans?: any[];
  allowanceCharges?: any[];
  note?: string;
  qrCodeBase64?: string;
  stateHistory?: any[];
  submissionAttempts?: any[];
  submittedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListResponse {
  data: InvoiceResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface InvoiceStatusResponse {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  status: InvoiceStatus;
  history: InvoiceStateHistoryResponse[];
  qrCodeBase64?: string;
}

export interface InvoiceStateHistoryResponse {
  fromStatus?: InvoiceStatus;
  toStatus: InvoiceStatus;
  actor: string;
  reason?: string;
  occurredAt: string;
}

export interface SubmitInvoiceResponse {
  id: string;
  platformIrn: string;
  status: string;
  message: string;
  trackingUrl: string;
}

export interface ValidationResponse {
  valid: boolean;
  platformIrn?: string;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
}

export interface ValidationErrorItem {
  field: string;
  code: string;
  message: string;
  severity: "ERROR" | "WARNING";
}