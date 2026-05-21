// Server-side: call backend directly. Client-side: use relative URL so Next.js
// rewrites proxy the request (avoids CORS — browser calls :3001, Next proxies to :3000).
const API_BASE =
  typeof window === "undefined"
    ? (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000")
    : "";

function getToken(admin = false): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(admin ? "adminToken" : "accessToken");
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  admin = false
): Promise<T> {
  const token = getToken(admin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.message ?? `Request failed: ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, body });
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{
      accessToken?: string;
      mfaRequired?: boolean;
      mfaToken?: string;
      mfaSetupRequired?: boolean;
    }>("/v1/auth/login", { email, password }),
  refresh: () =>
    api.post<{ accessToken: string }>("/v1/auth/refresh"),
  revoke: () =>
    api.post("/v1/auth/revoke", { all: true }),
  verifyMfa: (mfaToken: string, code: string) =>
    api.post<{ accessToken: string }>("/v1/auth/mfa/challenge", { mfaToken, code }),
  setupMfa: () => api.post<{ qrCode: string; secret: string }>("/v1/auth/mfa/setup"),
  enableMfa: (code: string) => api.post("/v1/auth/mfa/verify-setup", { code }),
  forgotPassword: (email: string) => api.post("/v1/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    api.post("/v1/auth/reset-password", { token, newPassword: password }),
  requestAccess: (data: {
    companyName: string;
    tin: string;
    contactName: string;
    email: string;
    phone?: string;
    estimatedVolume?: string;
    useCase?: string;
  }) => api.post("/v1/request-access", data),
  acceptInvitation: (token: string, password: string, firstName: string) =>
    api.post("/v1/auth/accept-invitation", { token, password, firstName }),
};

// Invoices
export const invoiceApi = {
  list: (params?: Record<string, string | number>) => {
    const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
    return api.get<{ data: unknown[]; total: number; page: number; limit: number }>(`/v1/invoices${qs}`);
  },
  get: (id: string) => api.get<unknown>(`/v1/invoices/${id}`),
  create: (data: unknown) => api.post<unknown>("/v1/invoices/dashboard", data),
  cancel: (id: string, reason: string) =>
    api.post(`/v1/invoices/${id}/cancel`, { reason }),
  stats: () => api.get<unknown>("/v1/invoices/stats"),
};

// Team / Users
export const userApi = {
  me: () => api.get<unknown>("/v1/users/me"),
  list: () => api.get<{ data: unknown[]; total: number }>("/v1/users"),
  invite: (email: string, role: string) => api.post("/v1/users/invite", { email, role }),
  updateRole: (userId: string, role: string) =>
    api.patch(`/v1/users/${userId}/role`, { role }),
  remove: (userId: string) => api.delete(`/v1/users/${userId}`),
};

// API Keys
export const apiKeyApi = {
  list: () => api.get<{ data: unknown[]; total: number }>("/v1/api-keys"),
  create: (label: string, environment: string) =>
    api.post<{ key: string }>("/v1/api-keys", { label, environment }),
  revoke: (id: string) => api.delete(`/v1/api-keys/${id}`),
  rotate: (id: string) => api.post<{ key: string }>(`/v1/api-keys/${id}/rotate`),
};

// Webhooks
export const webhookApi = {
  list: () => api.get<{ data: unknown[]; total: number }>("/v1/webhooks"),
  create: (data: unknown) => api.post<unknown>("/v1/webhooks", data),
  update: (id: string, data: unknown) => api.patch(`/v1/webhooks/${id}`, data),
  delete: (id: string) => api.delete(`/v1/webhooks/${id}`),
};

function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true);
}

const aApi = {
  get: <T>(path: string) => adminRequest<T>(path),
  post: <T>(path: string, data?: unknown) =>
    adminRequest<T>(path, { method: "POST", body: JSON.stringify(data) }),
};

// Admin
export const adminApi = {
  login: (email: string, password: string) =>
    api.post<{ accessToken: string }>("/v1/admin/auth/login", { email, password }),
  dashboard: () => aApi.get<unknown>("/v1/admin/dashboard"),
  accessRequests: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return aApi.get<{ data: unknown[]; total: number }>(`/v1/admin/access-requests${qs}`);
  },
  approveRequest: (id: string, data: unknown) =>
    aApi.post(`/v1/admin/access-requests/${id}/provision`, data),
  rejectRequest: (id: string, reason: string) =>
    adminRequest(`/v1/admin/access-requests/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reviewNote: reason }) }),
  tenants: () => aApi.get<{ data: unknown[]; total: number }>("/v1/admin/tenants"),
  activity: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return aApi.get<{ data: unknown[]; total: number }>(`/v1/admin/activity${qs}`);
  },
};
