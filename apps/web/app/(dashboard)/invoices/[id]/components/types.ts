export interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  paymentReference: string;
  paidAt: string;
  notes?: string;
}

export interface CreditNoteRecord {
  id: string;
  originalAmount: number;
  adjustedAmount: number;
  adjustmentReason: string;
  customerName: string;
  customerTin?: string;
  transactionDate: string;
  createdBy: string;
}

export interface InvoiceDetail {
  id: string;
  platformIrn: string;
  firsConfirmedIrn?: string;
  csid?: string;
  acceptedAt?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  status: string;
  invoiceType: string;
  invoiceKind: string;
  currency: string;
  totalAmount: number;
  taxAmount: number;
  amountPaid?: number;
  paymentStatus?: string;
  paymentDueDate?: string;
  isOverdue?: boolean;
  sellerName: string;
  sellerTin: string;
  sellerAddress?: string;
  buyerName: string;
  buyerTin?: string;
  buyerAddress?: string;
  buyerEmail?: string;
  issueDate: string;
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  rejectionCode?: string;
  errorMessage?: string;
  whtApplicable?: boolean;
  whtRate?: number;
  whtAmount?: number;
  expectedCash?: number;
  creditNotes?: CreditNoteRecord[];
  hasCreditNote?: boolean;
  netAmount?: number;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    vatRate: number;
    vatAmount: number;
    hsnCode?: string;
  }>;
  stateHistory: Array<{
    fromStatus: string;
    toStatus: string;
    createdAt: string;
    reason?: string;
  }>;
  submissionAttempts?: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    createdAt: string;
    errorMessage?: string;
  }>;
}

export interface RecordPaymentForm {
  amount: string;
  provider: string;
  reference: string;
  paidAt: string;
  notes: string;
  whtDeducted: string;
}
