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
  const method = (options.method ?? 'GET').toUpperCase();

  // Debug: log every outgoing request so proxy/header issues are immediately
  // visible in the browser console.
  console.log('[API]', method, url, {
    hasAuth: !!headers['Authorization'],
    contentType: headers['Content-Type'],
  });

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !skipAuthRedirect) {
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
    throw Object.assign(new Error(body?.message ?? `Request failed: ${res.status}`), { status: res.status });
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
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body?.message ?? `Request failed: ${res.status}`), { status: res.status });
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
  verifyMfa: (mfaToken: string, code: string) =>
    api.post<{ accessToken: string }>('/v1/auth/mfa/challenge', {
      mfaToken,
      code,
    }),
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
  get: (id: string) => api.get<unknown>(`/v1/invoices/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/invoices/dashboard', data),
  cancel: (id: string, reason: string) =>
    api.post(`/v1/invoices/${id}/cancel`, { reason }),
  stats: () => api.get<unknown>('/v1/invoices/dashboard/stats'),
  getXml: (id: string) => requestBlob(`/v1/invoices/${id}/xml`),
  getStatus: (id: string) => api.get<unknown>(`/v1/invoices/${id}/status`),
  // Payments
  recordPayment: (id: string, data: {
    amount: number;
    reference: string;
    provider: string;
    paidAt: string;
    notes?: string;
  }) => api.post<unknown>(`/v1/invoices/${id}/payments`, data),
  listPayments: (id: string) => api.get<unknown>(`/v1/invoices/${id}/payments`),
  // Bulk
  bulkUploadCsv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return requestMultipart<unknown>('/v1/invoices/bulk/csv', fd);
  },
  getBulkStatus: (batchId: string) =>
    api.get<unknown>(`/v1/invoices/bulk/${batchId}/status`),
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
    requestBlob(`/v1/invoices/export/csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
  json: (startDate: string, endDate: string) =>
    request<unknown>(`/v1/invoices/export/json?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
  monthly: (year: number, month: number) =>
    request<unknown>(`/v1/invoices/export/monthly?year=${year}&month=${month}`),
};

// Reminder Rules
export const reminderApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/reminder-rules'),
  create: (data: {
    name: string;
    triggerType: string;
    triggerDays: number;
    message: string;
  }) => api.post<unknown>('/v1/reminder-rules', data),
  update: (id: string, data: Partial<{
    name: string;
    triggerType: string;
    triggerDays: number;
    message: string;
    isActive: boolean;
  }>) => api.patch<unknown>(`/v1/reminder-rules/${id}`, data),
  delete: (id: string) => api.delete<void>(`/v1/reminder-rules/${id}`),
};

// Products
export const productApi = {
  list: (params?: { search?: string; category?: string; isActive?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return api.get<{ data: unknown[]; total: number }>(`/v1/products${qs}`);
  },
  get: (id: string) => api.get<unknown>(`/v1/products/${id}`),
  create: (data: unknown) => api.post<unknown>('/v1/products', data),
  update: (id: string, data: unknown) => api.patch<unknown>(`/v1/products/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/v1/products/${id}`),
  asLineItem: (id: string) => api.get<unknown>(`/v1/products/${id}/as-line-item`),
};

// Team / Users
export const userApi = {
  me: () => api.get<unknown>('/v1/users/me'),
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/users'),
  invite: (email: string, role: string) =>
    api.post('/v1/users/invite', { email, role }),
  updateRole: (userId: string, role: string) =>
    api.patch(`/v1/users/${userId}/role`, { role }),
  remove: (userId: string) => api.delete(`/v1/users/${userId}`),
};

// API Keys
export const apiKeyApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/api-keys'),
  create: (label: string, environment: string) =>
    api.post<{ key: string }>('/v1/api-keys', { label, environment }),
  revoke: (id: string) => api.delete(`/v1/api-keys/${id}`),
  rotate: (id: string) =>
    api.post<{ key: string }>(`/v1/api-keys/${id}/rotate`),
};

// Webhooks
export const webhookApi = {
  list: () => api.get<{ data: unknown[]; total: number }>('/v1/webhooks'),
  create: (data: unknown) => api.post<unknown>('/v1/webhooks', data),
  update: (id: string, data: unknown) => api.patch(`/v1/webhooks/${id}`, data),
  delete: (id: string) => api.delete(`/v1/webhooks/${id}`),
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
  consentRecords: (params?: { tenantId?: string; email?: string; consentType?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return aApi.get<{ data: unknown[]; total: number }>(`/v1/admin/consent-records${qs}`);
  },
  // Erasure requests
  erasureRequests: (status?: string) => {
    const qs = status ? `?status=${status}` : '';
    return aApi.get<{ data: unknown[]; total: number }>(`/v1/admin/erasure-requests${qs}`);
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
    requestBlob(`/v1/admin/export/platform-csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, {}, true),
  // Unlock user
  unlockAccount: (tenantId: string, email: string) =>
    aApi.post('/v1/admin/users/unlock', { tenantId, email }),
};
