import type { DashboardVisibility } from '@/lib/api';

export interface RecentPayment {
  buyerName: string;
  amount: number;
  provider: string;
  paidAt: string;
}

export interface RecentRejection {
  invoiceNumber: string;
  buyerName: string;
  rejectionReason: string | null;
  rejectedAt: string | null;
}

export interface Stats {
  outstandingAmount?: number;
  outstandingInvoiceCount?: number;
  overdueCount?: number;
  outputVatOutstanding?: number;
  inputVatOutstanding?: number;
  netVatExposure?: number;
  collectedThisMonth?: number;
  rejectedCount?: number;
  rejected?: number;
  recentRejections?: RecentRejection[];
  incomingStats?: { total: number; toReview: number; approved: number; paid: number };
  recentPayments?: RecentPayment[];
  myVisibility?: DashboardVisibility;
}

export interface IncomingStats {
  totalOutstanding?: number;
  outstandingCount?: number;
}

export interface ChartData {
  revenueTrend: { month: string; monthKey: string; amount: number }[];
  invoiceStatusBreakdown: { status: string; count: number }[];
  sentVsReceived: { month: string; sent: number; received: number }[];
}

export interface RejectionsData {
  totalRejected: number;
  allResolved: boolean;
  reasons: { errorCode: string; errorMessage: string; count: number; invoiceIds: string[] }[];
}
