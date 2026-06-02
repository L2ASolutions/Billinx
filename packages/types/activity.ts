export type ActivityEventType =
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_LOGIN_FAILED"
  | "USER_INVITED"
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "WEBHOOK_CREATED"
  | "INVOICE_CREATED"
  | "INVOICE_VALIDATED"
  | "INVOICE_SUBMITTED"
  | "INVOICE_ACCEPTED"
  | "INVOICE_REJECTED"
  | "INVOICE_CANCELLED"
  | "INVOICE_VIEWED"
  | "TENANT_CREATED"
  | "TENANT_UPDATED"
  | "TENANT_DEACTIVATED"
  | "WEBHOOK_DELIVERED"
  | "WEBHOOK_FAILED"
  | "EXPORT_GENERATED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "USER_CREATED"
  | "USER_DEACTIVATED"
  | "PASSWORD_RESET"
  | "SYSTEM_ERROR"
  | "PAYMENT_RECORDED"
  | "INVOICE_OVERDUE"
  | "REMINDER_SENT"
  | "INCOMING_INVOICE_RECEIVED"
  | "INCOMING_INVOICE_VALIDATED"
  | "INCOMING_INVOICE_APPROVED"
  | "INCOMING_INVOICE_REJECTED"
  | "INCOMING_INVOICE_PAID"
  | "INVOICE_SENT_TO_BUYER";

export type ErrorSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ── Activity Event Payloads ───────────────────────────────────────────────────

export interface UserLoginPayload {
  email: string;
  success: boolean;
  failureReason?: string;
  sessionId?: string;
}

export interface ApiKeyEventPayload {
  keyId: string;
  keyName: string;
  environment: string;
}

export interface InvoiceCreatedPayload {
  invoiceId: string;
  platformIrn: string;
  invoiceTypeCode: string;
  buyerName: string;
  buyerTin?: string;
  totalAmount: number;
  currency: string;
  lineItemCount: number;
}

export interface InvoiceStatusPayload {
  invoiceId: string;
  platformIrn: string;
  fromStatus: string;
  toStatus: string;
  reason?: string;
  firsConfirmedIrn?: string;
}

export interface TenantEventPayload {
  tenantId: string;
  tenantName: string;
  tin: string;
  appAdapterKey?: string;
  environment?: string;
}

export interface SystemErrorPayload {
  errorCode: string;
  errorMessage: string;
  endpoint?: string;
  method?: string;
  stackTrace?: string;
}

// ── Track Event Request ───────────────────────────────────────────────────────
export interface TrackEventRequest {
  tenantId?: string;
  eventType: ActivityEventType;
  actor: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
}

// ── Activity Response ─────────────────────────────────────────────────────────
export interface ActivityEventResponse {
  id: string;
  tenantId?: string;
  eventType: ActivityEventType;
  actor: string;
  actorEmail?: string;
  actorName?: string;
  entityType?: string;
  entityId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ActivityListResponse {
  data: ActivityEventResponse[];
  total: number;
  page: number;
  limit: number;
}

// ── System Error Response ─────────────────────────────────────────────────────
export interface SystemErrorResponse {
  id: string;
  tenantId?: string;
  errorCode: string;
  errorMessage: string;
  stackTrace?: string;
  endpoint?: string;
  method?: string;
  actor?: string;
  requestId?: string;
  severity: ErrorSeverity;
  isResolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  occurredAt: string;
}

export interface SystemErrorListResponse {
  data: SystemErrorResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface ErrorStatsResponse {
  total: number;
  unresolved: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// ── Report Filters ────────────────────────────────────────────────────────────
export interface ActivityFilterParams {
  tenantId?: string;
  eventType?: ActivityEventType;
  actor?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface ErrorFilterParams {
  tenantId?: string;
  severity?: ErrorSeverity;
  isResolved?: boolean;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}