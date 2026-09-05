export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface SupportTicketListItem {
  id: string;
  tenantId: string | null;
  tenantName?: string | null;
  userId: string | null;
  errorMessage: string;
  pageUrl: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketDetail extends SupportTicketListItem {
  stackTrace: string | null;
  browserInfo: string;
  userDescription: string | null;
  screenshotUrl: string | null;
}

export interface UpdateSupportTicketStatusRequest {
  status: SupportTicketStatus;
}
