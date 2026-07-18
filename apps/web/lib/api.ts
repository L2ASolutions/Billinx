// Server-side: call backend directly.
// Client-side: use /api prefix so requests go through the Next.js proxy API
// route (app/api/[...path]/route.ts) which explicitly forwards all headers —
// including Authorization — to the backend.

// ── Client-side request cache (30 s TTL) ─────────────────────────────────────
const _cache = new Map<string, { data: unknown; time: number }>();

export function cachedGet<T>(url: string, ttlMs = 30_000): Promise<T> {
  if (typeof window !== 'undefined') {
    const hit = _cache.get(url);
    if (hit && Date.now() - hit.time < ttlMs) {
      return Promise.resolve(hit.data as T);
    }
  }
  return api.get<T>(url).then((data) => {
    if (typeof window !== 'undefined') {
      _cache.set(url, { data, time: Date.now() });
    }
    return data;
  });
}

export function invalidateCache(url: string) {
  _cache.delete(url);
}

const API_BASE =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3000')
    : '/api';

function getToken(admin = false): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(admin ? 'adminToken' : 'accessToken');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  admin = false,
  skipAuthRedirect = false,
): Promise<T> {
  const token = getToken(admin);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${API_BASE}${path}`;

  const _t0 = Date.now();
  const res = await fetch(url, { ...options, headers });
  const _ms = Date.now() - _t0;
  if (_ms > 1000) console.warn(`[Billinx] Slow API: ${path} took ${_ms}ms`);

  if (!res.ok) {
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      !skipAuthRedirect
    ) {
      // BUG-021: Store a message for the login page to display so the user
      // knows why they were redirected rather than being silently logged out.
      sessionStorage.setItem(
        'authError',
        'Your session has expired. Please sign in again.',
      );
      localStorage.clear();
      window.location.href = admin ? '/admin/login' : '/login';
    }

    const body = await res.json().catch(() => ({}));
    const message = body?.message ?? `Request failed: ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, body });
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestBlob(
  path: string,
  options: RequestInit = {},
  admin = false,
): Promise<{ blob: Blob; filename: string }> {
  const token = getToken(admin);
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(body?.message ?? `Request failed: ${res.status}`),
      { status: res.status },
    );
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? 'export';
  return { blob: await res.blob(), filename };
}

async function requestMultipart<T>(
  path: string,
  formData: FormData,
  admin = false,
): Promise<T> {
  const token = getToken(admin);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(body?.message ?? `Request failed: ${res.status}`),
      { status: res.status },
    );
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{
      accessToken?: string;
      mfaRequired?: boolean;
      mfaToken?: string;
      mfaSetupRequired?: boolean;
    }>('/v1/auth/login', { email, password }),
  refresh: () => api.post<{ accessToken: string }>('/v1/auth/refresh'),
  revoke: () => api.post('/v1/auth/revoke', { all: true }),
  verifyMfa: (mfaToken: string, code: string, isBackupCode = false) =>
    api.post<{ accessToken: string }>('/v1/auth/mfa/challenge', {
      mfaToken,
      code,
      ...(isBackupCode && { type: 'backup' }),
    }),
  resendMfa: (mfaToken: string) =>
    api.post('/v1/auth/mfa/resend', { mfaToken }),
  setupMfa: () =>
    request<{ qrCodeBase64: string; manualKey: string }>(
      '/v1/auth/mfa/setup',
      { method: 'POST' },
      false,
      true,
    ),
  enableMfa: (code: string) =>
    request<void>(
      '/v1/auth/mfa/verify-setup',
      { method: 'POST', body: JSON.stringify({ code }) },
      false,
      true,
    ),
  forgotPassword: (email: string) =>
    api.post('/v1/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post('/v1/auth/reset-password', { token, newPassword: password }),
  requestAccess: (data: {
    companyName: string;
    tin: string;
    contactName: string;
    email: string;
    phone?: string;
    estimatedVolume?: string;
    useCase?: string;
  }) => api.post('/v1/request-access', data),
  acceptInvitation: (token: string, password: string, firstName: string) =>
    api.post('/v1/auth/accept-invitation', { token, password, firstName }),
};

// Invoices
export const invoiceApi = {
  list: (params?: Record<string, string | number>) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return api.get<{
      data: unknown[];
      total: number;
      page: number;
      limit: number;
    }>(`/v1/invoices/dashboard/list${qs}`);
  },
  // Single-invoice dashboard routes — use JWT-guarded /dashboard/:id paths (BUG-002)
  get: (id: string) => api.get<unknown>(`/v1/invoices/dashboard/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/invoices/dashboard', data),
  // BUG-003 fix: PATCH, not POST; BUG-002 fix: dashboard path with JWT guard
  cancel: (id: string, reason: string) =>
    api.patch(`/v1/invoices/dashboard/${id}/cancel`, { reason }),
  export: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return requestBlob(`/v1/invoices/dashboard/export${qs}`);
  },
  stats: () => cachedGet<unknown>('/v1/invoices/dashboard/stats'),
  paymentStats: () => api.get<unknown>('/v1/invoices/dashboard/payment-stats'),
  paymentCharts: () =>
    api.get<unknown>('/v1/invoices/dashboard/payment-charts'),
  getPdf: (id: string) => requestBlob(`/v1/invoices/dashboard/${id}/pdf`),
  getNrsPayload: (id: string) =>
    requestBlob(`/v1/invoices/dashboard/${id}/nrs-payload`),
  getStatus: (id: string) =>
    api.get<unknown>(`/v1/invoices/dashboard/${id}/status`),
  // Submit an existing DRAFT invoice without creating a duplicate.
  // Updates the draft's fields then queues it for FIRS submission.
  submitDraft: (id: string, data: unknown) =>
    api.post<unknown>(`/v1/invoices/dashboard/${id}/submit`, data),
  // Save incomplete form as DRAFT without submitting to FIRS.
  saveDraft: (data: unknown) =>
    api.post<unknown>('/v1/invoices/dashboard/save-draft', data),
  // Update an existing DRAFT's fields without submitting.
  updateDraftFields: (id: string, data: unknown) =>
    api.patch<unknown>(`/v1/invoices/dashboard/${id}`, data),
  // Payments — dashboard routes (BUG-002)
  recordPayment: (
    id: string,
    data: {
      amount: number;
      reference: string;
      provider: string;
      paidAt: string;
      notes?: string;
      whtDeducted?: number;
    },
  ) => api.post<unknown>(`/v1/invoices/dashboard/${id}/payments`, data),
  listPayments: (id: string) =>
    api.get<unknown>(`/v1/invoices/dashboard/${id}/payments`),
  // Bulk — dashboard routes so JWT is accepted (BUG-005)
  bulkUploadCsv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return requestMultipart<unknown>('/v1/invoices/bulk/dashboard/csv', fd);
  },
  getBulkStatus: (batchId: string) =>
    api.get<unknown>(`/v1/invoices/bulk/dashboard/${batchId}/status`),
  sendToBuyer: (id: string) =>
    api.post<unknown>(`/v1/invoices/dashboard/${id}/send`),
  sendReminder: (id: string) =>
    api.post<unknown>(`/v1/invoices/dashboard/${id}/reminder`),
  duplicate: (id: string) =>
    api.post<unknown>(`/v1/invoices/dashboard/${id}/duplicate`, {}),
  getSample: () => api.get<unknown>('/v1/invoices/dashboard/sample'),
  dashboardCharts: () =>
    api.get<{
      revenueTrend: { month: string; monthKey: string; amount: number }[];
      invoiceStatusBreakdown: { status: string; count: number }[];
      sentVsReceived: { month: string; sent: number; received: number }[];
    }>('/v1/invoices/dashboard/charts'),
  dashboardRejections: () =>
    api.get<{
      totalRejected: number;
      allResolved: boolean;
      reasons: {
        errorCode: string;
        errorMessage: string;
        count: number;
        invoiceIds: string[];
      }[];
    }>('/v1/invoices/dashboard/rejections'),
  createCreditNote: (id: string, data: unknown) =>
    api.post<unknown>(`/v1/invoices/${id}/credit-notes`, data),
  listCreditNotes: (startDate: string, endDate: string) =>
    api.get<unknown>(
      `/v1/invoices/credit-notes?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
};

// VAT Return
export const vatReturnApi = {
  summary: (startDate: string, endDate: string) =>
    api.get<unknown>(
      `/v1/vat-return/summary?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
  export: (startDate: string, endDate: string) =>
    requestBlob(
      `/v1/vat-return/export?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
};

// Payments list (tenant-wide)
export const paymentApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<unknown>(`/v1/invoices/dashboard/list${qs}`);
  },
};

// Exports / Reports
export const exportApi = {
  csv: (startDate: string, endDate: string) =>
    requestBlob(
      `/v1/invoices/export/csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
  json: (startDate: string, endDate: string) =>
    request<unknown>(
      `/v1/invoices/export/json?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
  monthly: (year: number, month: number) =>
    request<unknown>(`/v1/invoices/export/monthly?year=${year}&month=${month}`),
};

export const submissionApi = {
  export: (params?: { startDate?: string; endDate?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return requestBlob(`/v1/submissions/export${qs}`);
  },
};

// Reminder Rules — backend field is `reminderMessage` (BUG-011)
export const reminderApi = {
  list: () =>
    cachedGet<{ data: unknown[]; total: number }>('/v1/reminder-rules'),
  create: (data: {
    name: string;
    triggerType: string;
    triggerDays: number;
    reminderMessage: string;
  }) => api.post<unknown>('/v1/reminder-rules', data),
  update: (
    id: string,
    data: Partial<{
      name: string;
      triggerType: string;
      triggerDays: number;
      reminderMessage: string;
      isActive: boolean;
    }>,
  ) => api.patch<unknown>(`/v1/reminder-rules/${id}`, data),
  delete: (id: string) => api.delete<void>(`/v1/reminder-rules/${id}`),
};

// Products
export const productApi = {
  list: (params?: {
    search?: string;
    category?: string;
    isActive?: string;
  }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return cachedGet<{ data: unknown[]; total: number }>(`/v1/products${qs}`);
  },
  get: (id: string) => api.get<unknown>(`/v1/products/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/products', data),
  update: (id: string, data: unknown) =>
    api.patch<unknown>(`/v1/products/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/v1/products/${id}`),
  asLineItem: (id: string) =>
    api.get<unknown>(`/v1/products/${id}/as-line-item`),
};

// Activity
export interface ActivityEvent {
  id: string;
  eventType: string;
  actorEmail?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

export const activityApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return cachedGet<{ data: ActivityEvent[]; total: number }>(
      `/v1/activity${qs}`,
    );
  },
  exportExcel: (params?: {
    startDate?: string;
    endDate?: string;
    eventType?: string;
  }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return requestBlob(`/v1/activity/export-excel${qs}`);
  },
};

// Team / Users
export const userApi = {
  me: () => api.get<unknown>('/v1/users/me'),
  list: () => cachedGet<{ data: unknown[]; total: number }>('/v1/users'),
  invite: (email: string, role: string) =>
    api.post('/v1/users/invite', { email, role }),
  // BUG-010: POST (not PATCH) to /roles (plural, not /role)
  updateRole: (userId: string, role: string) =>
    api.post(`/v1/users/${userId}/roles`, { role }),
  // BUG-009: DELETE /v1/users/:id now exists (soft-delete)
  remove: (userId: string) => api.delete(`/v1/users/${userId}`),
  getPreferences: () =>
    api.get<{ dashboardWidgets: Record<string, boolean>; hidden: string[] }>(
      '/v1/users/me/preferences',
    ),
  savePreferences: (body: {
    dashboardWidgets?: Record<string, boolean>;
    hidden?: string[];
  }) =>
    api.patch<{ dashboardWidgets: Record<string, boolean>; hidden: string[] }>(
      '/v1/users/me/preferences',
      body,
    ),
};

export interface DashboardVisibility {
  receivables: boolean;
  vat_strip: boolean;
  revenue_chart: boolean;
  pipeline_chart: boolean;
  activity_chart: boolean;
  needs_attention: boolean;
}

export const tenantApi = {
  getMe: () => api.get<unknown>('/v1/tenants/me'),
  updateMe: (data: Record<string, unknown>) =>
    api.patch<unknown>('/v1/tenants/me', data),
  getDashboardVisibility: () =>
    api.get<{ VIEWER: DashboardVisibility; ACCOUNTANT: DashboardVisibility }>(
      '/v1/tenants/me/dashboard-visibility',
    ),
  updateDashboardVisibility: (
    role: 'VIEWER' | 'ACCOUNTANT',
    section: string,
    visible: boolean,
  ) =>
    api.patch<unknown>('/v1/tenants/me/dashboard-visibility', {
      role,
      section,
      visible,
    }),
};

// API Keys — use JWT-guarded /users/api-keys routes (BUG-004)
// BUG-016: backend stores as `name`, not `label` — translate at the API boundary
const READ_ONLY_SCOPES = [
  'invoices:read',
  'submissions:read',
  'products:read',
  'reports:read',
];

export const apiKeyApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/users/api-keys'),
  create: (label: string, environment: string, access: 'read' | 'full' = 'full') =>
    api.post<{ key: string }>('/v1/users/api-keys', {
      name: label,
      environment,
      scopes: access === 'read' ? READ_ONLY_SCOPES : ['*'],
    }),
  revoke: (id: string) => api.delete(`/v1/users/api-keys/${id}`),
  rotate: (id: string) =>
    api.post<{ key: string }>(`/v1/users/api-keys/${id}/rotate`),
};

// Webhooks — use /subscriptions/ path (BUG-001)
export const webhookApi = {
  list: () =>
    api.get<{ data: unknown[]; total: number }>('/v1/webhooks/subscriptions'),
  create: (data: unknown) =>
    api.post<unknown>('/v1/webhooks/subscriptions', data),
  update: (id: string, data: unknown) =>
    api.patch(`/v1/webhooks/subscriptions/${id}`, data),
  delete: (id: string) => api.delete(`/v1/webhooks/subscriptions/${id}`),
};

// Incoming Invoices
export const incomingInvoiceApi = {
  list: (params?: {
    status?: string;
    supplierTin?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return api.get<{
      data: unknown[];
      total: number;
      page: number;
      limit: number;
    }>(`/v1/incoming-invoices${qs}`);
  },
  get: (id: string) => api.get<unknown>(`/v1/incoming-invoices/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/incoming-invoices', data),
  validate: (id: string) =>
    api.patch<unknown>(`/v1/incoming-invoices/${id}/validate`),
  approve: (id: string) =>
    api.patch<unknown>(`/v1/incoming-invoices/${id}/approve`),
  reject: (id: string, reason: string) =>
    api.patch<unknown>(`/v1/incoming-invoices/${id}/reject`, { reason }),
  markPaid: (
    id: string,
    data: {
      amount: number;
      reference: string;
      provider: string;
      paidAt: string;
      notes?: string;
      sendReceiptToSupplier?: boolean;
    },
  ) => api.patch<unknown>(`/v1/incoming-invoices/${id}/mark-paid`, data),
  sendReceipt: (id: string) =>
    api.post<{ sent: boolean; to?: string }>(
      `/v1/incoming-invoices/${id}/send-receipt`,
      {},
    ),
  uploadAttachment: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return requestMultipart<{
      attachmentName: string;
      attachmentMime: string;
      attachmentSize: number;
      uploadedAt: string;
    }>(`/v1/incoming-invoices/${id}/attachment`, fd);
  },
  downloadAttachment: (id: string) =>
    requestBlob(`/v1/incoming-invoices/${id}/attachment`),
  deleteAttachment: (id: string) =>
    api.delete<{ deleted: boolean }>(`/v1/incoming-invoices/${id}/attachment`),
  stats: () =>
    cachedGet<{
      total: number;
      received: number;
      validated: number;
      approved: number;
      paid: number;
      totalOutstanding: number;
      outstandingCount: number;
      totalVatOutstanding: number;
      totalWhtOutstanding?: number;
      netPayableAfterWht?: number;
    }>('/v1/incoming-invoices/stats'),
};

// VAT Reconciliation
export const vatApi = {
  summary: (period: string) =>
    cachedGet<unknown>(
      `/v1/vat/summary?period=${encodeURIComponent(period)}`,
      30_000,
    ),
  annualSummary: (year: number) =>
    cachedGet<unknown>(`/v1/vat/summary/annual?year=${year}`, 30_000),
  entries: (params?: {
    type?: string;
    period?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return cachedGet<unknown>(`/v1/vat/entries${qs}`, 30_000);
  },
  reconcile: (entryId: string) =>
    api.patch<unknown>(`/v1/vat/entries/${entryId}/reconcile`),
  mismatches: (period: string) =>
    cachedGet<unknown>(
      `/v1/vat/mismatches?period=${encodeURIComponent(period)}`,
      30_000,
    ),
};

// Reference data — public endpoints, no auth required, 5-minute cache
const REF = '/v1/reference';

export const referenceApi = {
  invoiceTypes: () =>
    cachedGet<{ code: string; value: string }[]>(
      `${REF}/invoice-types`,
      300_000,
    ),
  paymentMeans: () =>
    cachedGet<{ code: string; value: string }[]>(
      `${REF}/payment-means`,
      300_000,
    ),
  taxCategories: () =>
    cachedGet<{ code: string; value: string }[]>(
      `${REF}/tax-categories`,
      300_000,
    ),
  currencies: () =>
    cachedGet<
      { code: string; name: string; symbol: string; symbolNative: string }[]
    >(`${REF}/currencies`, 300_000),
  quantityCodes: () =>
    cachedGet<{ code: string; name: string }[]>(
      `${REF}/quantity-codes`,
      300_000,
    ),
  states: () =>
    cachedGet<{ code: string; name: string }[]>(`${REF}/states`, 300_000),
  lgas: (stateCode: string) =>
    cachedGet<{ code: string; name: string }[]>(
      `${REF}/lgas?stateCode=${stateCode}`,
      300_000,
    ),
  hsCodes: (search: string, limit = 10) =>
    api.get<{ data: { code: string; description: string }[]; total: number }>(
      `${REF}/hs-codes?search=${encodeURIComponent(search)}&limit=${limit}`,
    ),
  serviceCodes: (search: string, limit = 10) =>
    api.get<{ data: { code: string; description: string }[]; total: number }>(
      `${REF}/service-codes?search=${encodeURIComponent(search)}&limit=${limit}`,
    ),
  countries: (search?: string) => {
    const url = search
      ? `${REF}/countries?search=${encodeURIComponent(search)}`
      : `${REF}/countries`;
    return cachedGet<{ alpha2: string; alpha3: string; name: string }[]>(
      url,
      300_000,
    );
  },
};

function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true);
}

const aApi = {
  get: <T>(path: string) => adminRequest<T>(path),
  post: <T>(path: string, data?: unknown) =>
    adminRequest<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    adminRequest<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
};

// Admin
export const adminApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string }>('/v1/admin/auth/login', {
      email,
      password,
    }),
  dashboard: () => aApi.get<unknown>('/v1/admin/dashboard'),
  metrics: () => aApi.get<unknown>('/v1/admin/metrics'),
  accessRequests: (status?: string) => {
    const qs = status ? `?status=${status}` : '';
    return aApi.get<{ data: unknown[]; total: number }>(
      `/v1/admin/access-requests${qs}`,
    );
  },
  approveRequest: (id: string, data: unknown) =>
    aApi.post(`/v1/admin/access-requests/${id}/provision`, data),
  rejectRequest: (id: string, reason: string) =>
    adminRequest(`/v1/admin/access-requests/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ reviewNote: reason }),
    }),
  tenants: () =>
    aApi.get<{ data: unknown[]; total: number }>('/v1/admin/tenants'),
  getTenant: (id: string) => aApi.get<unknown>(`/v1/admin/tenants/${id}`),
  activity: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return aApi.get<{ data: unknown[]; total: number }>(
      `/v1/admin/activity${qs}`,
    );
  },
  // Consent records
  consentRecords: (params?: {
    tenantId?: string;
    email?: string;
    consentType?: string;
  }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return aApi.get<{ data: unknown[]; total: number }>(
      `/v1/admin/consent-records${qs}`,
    );
  },
  // Erasure requests
  erasureRequests: (status?: string) => {
    const qs = status ? `?status=${status}` : '';
    return aApi.get<{ data: unknown[]; total: number }>(
      `/v1/admin/erasure-requests${qs}`,
    );
  },
  approveErasure: (id: string, reviewNote?: string) =>
    aApi.post(`/v1/admin/erasure-requests/${id}/approve`, { reviewNote }),
  rejectErasure: (id: string, reviewNote?: string) =>
    aApi.post(`/v1/admin/erasure-requests/${id}/reject`, { reviewNote }),
  // Queue
  queueStatus: () => aApi.get<unknown>('/v1/admin/queue/status'),
  bulkQueueStatus: () => aApi.get<unknown>('/v1/admin/queue/bulk/status'),
  retryFailed: () => aApi.post('/v1/admin/queue/retry-failed'),
  // Recovery & reminders
  runRecovery: () => aApi.post('/v1/admin/recovery/run'),
  runReminders: (tenantId?: string) => {
    const qs = tenantId ? `?tenantId=${tenantId}` : '';
    return aApi.post(`/v1/admin/reminders/run${qs}`);
  },
  // Retention
  retentionStats: () => aApi.get<unknown>('/v1/admin/retention/stats'),
  runRetention: () => aApi.post('/v1/admin/retention/run'),
  // Audit
  verifyAudit: () => aApi.get<unknown>('/v1/admin/audit/verify'),
  // Platform CSV export
  exportPlatformCsv: (startDate: string, endDate: string) =>
    requestBlob(
      `/v1/admin/export/platform-csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      {},
      true,
    ),
  // Unlock user
  unlockAccount: (tenantId: string, email: string) =>
    aApi.post('/v1/admin/users/unlock', { tenantId, email }),
};

// ── Public payment API (no auth) ──────────────────────────────────────────────

const PUBLIC_BASE =
  typeof window === 'undefined'
    ? (process.env.API_URL ?? 'http://localhost:3000')
    : '/api';

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(body?.message ?? `Request failed: ${res.status}`),
      {
        status: res.status,
      },
    );
  }
  return res.json();
}

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(b?.message ?? `Request failed: ${res.status}`),
      {
        status: res.status,
      },
    );
  }
  return res.json();
}

export const publicPayApi = {
  getInvoice: (invoiceId: string) =>
    publicGet<unknown>(`/v1/invoices/pay/${invoiceId}`),
  paystackInit: (invoiceId: string, email: string) =>
    publicPost<{ authorizationUrl: string; reference: string }>(
      '/v1/payments/paystack/initialize',
      { invoiceId, email },
    ),
  paystackVerify: (reference: string) =>
    publicGet<unknown>(
      `/v1/payments/paystack/verify/${encodeURIComponent(reference)}`,
    ),
  flutterwaveInit: (invoiceId: string, email: string) =>
    publicPost<{ paymentLink: string }>('/v1/payments/flutterwave/initialize', {
      invoiceId,
      email,
    }),
};

export interface ClientRecord {
  id: string;
  companyName: string;
  tin?: string;
  email?: string;
  telephone?: string;
  businessDescription?: string;
  contactPerson?: string;
  notes?: string;
  postalAddress?: Record<string, string>;
  totalInvoices: number;
  totalBilled: number;
  lastInvoiceAt?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const clientApi = {
  list: (params?: { search?: string; page?: number; limit?: number }) => {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : '';
    return api.get<{
      data: ClientRecord[];
      total: number;
      page: number;
      limit: number;
    }>(`/v1/clients${qs}`);
  },
  frequent: () => api.get<ClientRecord[]>('/v1/clients/frequent'),
  get: (id: string) => api.get<ClientRecord>(`/v1/clients/${id}`),
  create: (data: Partial<ClientRecord>) =>
    api.post<ClientRecord>('/v1/clients', data),
  update: (id: string, data: Partial<ClientRecord>) =>
    api.patch<ClientRecord>(`/v1/clients/${id}`, data),
  delete: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/v1/clients/${id}`),
};

// Inventory
export const inventoryApi = {
  list: (params?: { lowStock?: boolean; page?: number; limit?: number }) => {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : '';
    return api.get<{
      data: unknown[];
      total: number;
      page: number;
      limit: number;
    }>(`/v1/inventory${qs}`);
  },
  alerts: () =>
    api.get<{ data: unknown[]; total: number }>('/v1/inventory/alerts'),
  movements: (
    productId: string,
    params?: { page?: number; limit?: number },
  ) => {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : '';
    return api.get<{
      data: unknown[];
      total: number;
      page: number;
      limit: number;
    }>(`/v1/inventory/${productId}/movements${qs}`);
  },
  adjust: (
    productId: string,
    data: { quantity: number; type: string; notes?: string },
  ) => api.post<unknown>(`/v1/inventory/${productId}/adjust`, data),
  reorder: (productId: string) =>
    api.post<{ sent: boolean; to: string }>(
      `/v1/inventory/${productId}/reorder`,
    ),
};

export const analyticsApi = {
  topItemsSold: (period: 'month' | 'quarter' | 'year' = 'year') =>
    api.get<unknown[]>(`/v1/analytics/top-items-sold?period=${period}`),
  topPurchases: (period: 'month' | 'quarter' | 'year' = 'year') =>
    api.get<unknown[]>(`/v1/analytics/top-purchases?period=${period}`),
  topSuppliers: () => api.get<unknown[]>('/v1/analytics/top-suppliers'),
  topClients: () => api.get<unknown[]>('/v1/analytics/top-clients'),
  priceTrends: (itemName: string, months = 6) =>
    api.get<unknown[]>(
      `/v1/analytics/price-trends?itemName=${encodeURIComponent(itemName)}&months=${months}`,
    ),
  revenueVsExpenses: (months = 6) =>
    api.get<
      { month: string; revenue: number; expenses: number; net: number }[]
    >(`/v1/analytics/revenue-vs-expenses?months=${months}`),
};

export interface AppNotification {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export const notificationApi = {
  list: () => api.get<AppNotification[]>('/v1/notifications'),
  markRead: (id: string) =>
    api.patch<{ ok: boolean }>(`/v1/notifications/${id}/read`, {}),
  markAllRead: () =>
    api.patch<{ ok: boolean }>('/v1/notifications/read-all', {}),
};
