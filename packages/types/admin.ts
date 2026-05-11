export type AdminRole = "SUPER_ADMIN" | "STAFF";

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  admin: AdminUserResponse;
}

export interface AdminUserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface CreateAdminUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: AdminRole;
}

export interface AdminDashboardStats {
  tenants: {
    total: number;
    active: number;
    sandbox: number;
    production: number;
  };
  invoices: {
    total: number;
    today: number;
    accepted: number;
    rejected: number;
    pending: number;
    acceptanceRate: number;
  };
  accessRequests: {
    pending: number;
    approvedThisWeek: number;
  };
  errors: {
    unresolved: number;
    critical: number;
  };
}

export interface AdminTenantListItem {
  id: string;
  name: string;
  tin: string;
  environment: string;
  isActive: boolean;
  invoiceCount: number;
  userCount: number;
  createdAt: string;
  lastActivityAt?: string;
}

export interface AdminTenantDetail extends AdminTenantListItem {
  registeredAddress: any;
  appAdapterKey: string;
  rateLimitTier: string;
  batchEnabled: boolean;
  users: any[];
  recentInvoices: any[];
  stats: {
    totalInvoices: number;
    acceptedInvoices: number;
    rejectedInvoices: number;
    acceptanceRate: number;
  };
}