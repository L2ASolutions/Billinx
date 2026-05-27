// Server-side: call backend directly.
// Client-side: use /api prefix so requests go through the Next.js proxy API
// route (app/api/[...path]/route.ts) which explicitly forwards all headers —
// including Authorization — to the backend.
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

  const res = await fetch(url, { ...options, headers });

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
  stats: () => api.get<unknown>('/v1/invoices/dashboard/stats'),
  getXml: (id: string) => requestBlob(`/v1/invoices/dashboard/${id}/xml`),
  getStatus: (id: string) =>
    api.get<unknown>(`/v1/invoices/dashboard/${id}/status`),
  // Submit an existing DRAFT invoice without creating a duplicate.
  // Updates the draft's fields then queues it for FIRS submission.
  submitDraft: (id: string, data: unknown) =>
    api.post<unknown>(`/v1/invoices/dashboard/${id}/submit`, data),
  // Payments — dashboard routes (BUG-002)
  recordPayment: (
    id: string,
    data: {
      amount: number;
      reference: string;
      provider: string;
      paidAt: string;
      notes?: string;
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

// Reminder Rules — backend field is `reminderMessage` (BUG-011)
export const reminderApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/reminder-rules'),
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
    return api.get<{ data: unknown[]; total: number }>(`/v1/products${qs}`);
  },
  get: (id: string) => api.get<unknown>(`/v1/products/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/products', data),
  update: (id: string, data: unknown) =>
    api.patch<unknown>(`/v1/products/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/v1/products/${id}`),
  asLineItem: (id: string) =>
    api.get<unknown>(`/v1/products/${id}/as-line-item`),
};

// Team / Users
export const userApi = {
  me: () => api.get<unknown>('/v1/users/me'),
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/users'),
  invite: (email: string, role: string) =>
    api.post('/v1/users/invite', { email, role }),
  // BUG-010: POST (not PATCH) to /roles (plural, not /role)
  updateRole: (userId: string, role: string) =>
    api.post(`/v1/users/${userId}/roles`, { role }),
  // BUG-009: DELETE /v1/users/:id now exists (soft-delete)
  remove: (userId: string) => api.delete(`/v1/users/${userId}`),
};

// API Keys — use JWT-guarded /users/api-keys routes (BUG-004)
// BUG-016: backend stores as `name`, not `label` — translate at the API boundary
export const apiKeyApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/users/api-keys'),
  create: (label: string, environment: string) =>
    api.post<{ key: string }>('/v1/users/api-keys', {
      name: label,
      environment,
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
