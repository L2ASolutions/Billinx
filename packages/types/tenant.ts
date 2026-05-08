export type TenantEnvironment = "SANDBOX" | "PRODUCTION";
export type RateLimitTier = "STANDARD" | "PREMIUM" | "ENTERPRISE";
export type AppAdapterKey = "interswitch" | "pillarcraft" | "mock" | string;

export interface TenantAddress {
  streetName: string;
  cityName: string;
  state: string;
  postalZone?: string;
  countryCode: string;
}

export interface CreateTenantRequest {
  name: string;
  tin: string;
  registeredAddress: TenantAddress;
  appAdapterKey: AppAdapterKey;
  environment?: TenantEnvironment;
  rateLimitTier?: RateLimitTier;
  batchEnabled?: boolean;
  batchSize?: number;
  appCredential?: AppCredentialInput;
}

export interface UpdateTenantRequest {
  name?: string;
  registeredAddress?: TenantAddress;
  appAdapterKey?: AppAdapterKey;
  environment?: TenantEnvironment;
  rateLimitTier?: RateLimitTier;
  batchEnabled?: boolean;
  batchSize?: number;
  isActive?: boolean;
  appCredential?: AppCredentialInput;
}

export interface AppCredentialInput {
  type: "api_key" | "oauth2" | "mtls";
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  certificatePem?: string;
  privateKeyPem?: string;
  baseUrl?: string;
}

export interface TenantResponse {
  id: string;
  name: string;
  tin: string;
  registeredAddress: TenantAddress;
  appAdapterKey: AppAdapterKey;
  environment: TenantEnvironment;
  rateLimitTier: RateLimitTier;
  batchEnabled: boolean;
  batchSize: number;
  isActive: boolean;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantListResponse {
  data: TenantResponse[];
  total: number;
}