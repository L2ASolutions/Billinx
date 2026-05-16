export type UserRoleType =
  | "OWNER"
  | "ADMIN"
  | "ACCOUNTANT"
  | "VIEWER"
  | "API_MANAGER";

export const ROLE_PERMISSIONS: Record<UserRoleType, string[]> = {
  OWNER: [
    "invoice:create", "invoice:view", "invoice:cancel",
    "invoice:export", "user:manage", "apikey:manage",
    "settings:manage", "product:manage", "report:view",
  ],
  ADMIN: [
    "invoice:create", "invoice:view", "invoice:cancel",
    "invoice:export", "user:manage", "apikey:manage",
    "product:manage", "report:view",
  ],
  ACCOUNTANT: [
    "invoice:create", "invoice:view", "invoice:export",
    "product:manage", "report:view",
  ],
  VIEWER: [
    "invoice:view", "report:view",
  ],
  API_MANAGER: [
    "apikey:manage",
  ],
};

// ── Request types ─────────────────────────────────────────────────────────────

export interface RegisterTenantRequest {
  tenantName: string;
  tin: string;
  registeredAddress: {
    streetName: string;
    cityName: string;
    state: string;
    postalZone?: string;
    countryCode: string;
  };
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface InviteUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRoleType;
}

export interface AcceptInvitationRequest {
  token: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
}

export interface AssignRoleRequest {
  role: UserRoleType;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  isActive: boolean;
  isVerified: boolean;
  mfaEnabled: boolean;
  roles: UserRoleType[];
  permissions: string[];
  lastLoginAt?: string;
  createdAt: string;
}

export interface UserListResponse {
  data: UserResponse[];
  total: number;
}

export interface InvitationResponse {
  id: string;
  email: string;
  role: UserRoleType;
  expiresAt: string;
  createdAt: string;
}

export interface RegisterResponse {
  tenant: {
    id: string;
    name: string;
    tin: string;
  };
  user: UserResponse;
  accessToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  accessToken?: string;
  expiresIn: number;
  tokenType?: "Bearer";
  user?: UserResponse;
  mfaRequired?: boolean;
  mfaToken?: string;
  mfaSetupRequired?: boolean;
}

export interface MfaSetupResponse {
  qrCodeBase64: string;
  manualKey: string;
}

export interface MfaChallengeRequest {
  mfaToken: string;
  code: string;
}

export interface MfaChallengeResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  user: UserResponse;
}

export interface BackupCodesResponse {
  codes: string[];
  message: string;
}