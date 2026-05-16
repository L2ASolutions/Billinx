export type WebhookEventType =
  | 'invoice.created'
  | 'invoice.accepted'
  | 'invoice.rejected'
  | 'invoice.cancelled';

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'invoice.created',
  'invoice.accepted',
  'invoice.rejected',
  'invoice.cancelled',
];

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD_LETTERED';

export interface WebhookInvoiceEvent {
  tenantId: string;
  eventType: WebhookEventType;
  invoiceId: string;
  platformIrn: string;
  data: Record<string, unknown>;
}

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

export interface CreateSubscriptionRequest {
  url: string;
  eventTypes: WebhookEventType[];
  description?: string;
}

export interface UpdateSubscriptionRequest {
  url?: string;
  eventTypes?: WebhookEventType[];
  isActive?: boolean;
  description?: string;
}

export interface WebhookSubscriptionResponse {
  id: string;
  tenantId: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryResponse {
  id: string;
  subscriptionId: string;
  tenantId: string;
  eventType: string;
  eventId: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastResponseCode: number | null;
  lastResponseBody: string | null;
  deliveredAt: string | null;
  createdAt: string;
}
