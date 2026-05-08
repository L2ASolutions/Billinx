export type Environment = "SANDBOX" | "PRODUCTION";
export type RateLimitTier = "STANDARD" | "PREMIUM" | "ENTERPRISE";
export type ActorType = "apikey" | "user" | "admin" | "system";

export interface RequestContext {
  tenantId: string;
  environment: Environment;
  tier: RateLimitTier;
  actor: string;
  actorType: ActorType;
  requestId: string;
  isAdmin: boolean;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  keyHash: string;
  keyPrefix: string;
  environment: Environment;
  name: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isRevoked: boolean;
  createdAt: Date;
}

export interface CreateApiKeyRequest {
  name: string;
  environment: Environment;
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  environment: Environment;
  expiresAt: string | null;
  createdAt: string;
}

export interface ListApiKeysResponse {
  data: Omit<CreateApiKeyResponse, "key">[];
}

export interface TokenRequest {
  email: string;
  password: string;
  tenantId: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  environment: Environment;
  tier: RateLimitTier;
  role: "admin" | "member";
  iat: number;
  exp: number;
}

export interface RevokeTokenRequest {
  all?: boolean;
}