export type Environment = 'SANDBOX' | 'PRODUCTION';
export type RateLimitTier = 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';
export type ActorType = 'apikey' | 'user' | 'admin' | 'system';

// "*" grants full access (every scope below). Anything else is an exact,
// additive grant — an API key must carry the specific scope a route
// requires (see RequireScope()/ScopeGuard). Read-only keys get the four
// ":read" scopes; there is currently no UI path to grant an arbitrary
// custom subset — see ReadOnlyApiKeyScopes below.
export type ApiKeyScope =
  | '*'
  | 'invoices:read'
  | 'invoices:write'
  | 'submissions:read'
  | 'submissions:write'
  | 'products:read'
  | 'products:write'
  | 'reports:read';

export const READ_ONLY_API_KEY_SCOPES: ApiKeyScope[] = [
  'invoices:read',
  'submissions:read',
  'products:read',
  'reports:read',
];

export const FULL_ACCESS_API_KEY_SCOPES: ApiKeyScope[] = ['*'];

export interface RequestContext {
  tenantId: string;
  environment: Environment;
  tier: RateLimitTier;
  actor: string;
  actorType: ActorType;
  requestId: string;
  isAdmin: boolean;
  // Only ever populated for actorType === "apikey" (set by ApiKeyGuard).
  // Absent/undefined for JWT/admin/system actors, which are governed by
  // RolesGuard instead — ScopeGuard treats a missing value as "no scopes".
  scopes?: ApiKeyScope[];
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  keyHash: string;
  keyPrefix: string;
  environment: Environment;
  name: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isRevoked: boolean;
  createdAt: Date;
}

export interface CreateApiKeyRequest {
  name: string;
  environment: Environment;
  expiresAt?: string;
  // Omitted (or explicitly ["*"]) = full access, matching every key created
  // before scopes existed. Pass READ_ONLY_API_KEY_SCOPES for a read-only key.
  scopes?: ApiKeyScope[];
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  environment: Environment;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  createdAt: string;
}

export interface ListApiKeysResponse {
  data: Omit<CreateApiKeyResponse, 'key'>[];
}

export interface TokenRequest {
  email: string;
  password: string;
  tenantId: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  environment: Environment;
  tier: RateLimitTier;
  role: 'admin' | 'member';
  iat: number;
  exp: number;
}

export interface RevokeTokenRequest {
  all?: boolean;
}
