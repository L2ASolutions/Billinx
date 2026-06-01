export type IncomingInvoiceStatus =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'REJECTED'
  | 'APPROVED'
  | 'PAID';

export interface IncomingInvoiceItemResponse {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  vatAmount: number;
  hsnCode?: string;
}

export interface IncomingInvoiceResponse {
  id: string;
  tenantId: string;
  supplierName: string;
  supplierTin: string;
  invoiceNumber: string;
  invoiceAmount: number;
  vatAmount: number;
  currency: string;
  invoiceDate: string;
  dueDate?: string;
  status: IncomingInvoiceStatus;
  description?: string;
  sourceReference?: string;
  rejectionReason?: string;
  whtApplicable: boolean;
  whtRate?: number;
  whtAmount?: number;
  netPayable?: number;
  items: IncomingInvoiceItemResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface IncomingInvoiceListResponse {
  data: IncomingInvoiceResponse[];
  total: number;
  page: number;
  limit: number;
}
