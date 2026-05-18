export type SubmissionStatus =
  | "QUEUED"
  | "PROCESSING"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "FAILED"
  | "DEAD_LETTERED";

export type AppAdapterKey =
  | "mock"
  | "interswitch"
  | "pillarcraft"
  | "remita";

export interface SubmissionRequest {
  invoiceId: string;
  tenantId: string;
  platformIrn: string;
  adapterKey: AppAdapterKey;
  payload: Record<string, unknown>;
  attempt?: number;
}

export interface SubmissionResult {
  success: boolean;
  firsConfirmedIrn?: string;
  csid?: string;
  qrCodeBase64?: string;
  rawResponse?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface SubmissionAttemptResponse {
  id: string;
  invoiceId: string;
  tenantId: string;
  adapterKey: string;
  attempt: number;
  status: SubmissionStatus;
  firsConfirmedIrn?: string;
  errorCode?: string;
  errorMessage?: string;
  submittedAt?: string;
  respondedAt?: string;
  createdAt: string;
}

export interface QueueJobData {
  invoiceId: string;
  tenantId: string;
  platformIrn: string;
  adapterKey: AppAdapterKey;
  attempt: number;
  batchId?: string;
}