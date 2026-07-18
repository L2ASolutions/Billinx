import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '../../../packages/types/identity';

export const SCOPES_KEY = 'apiKeyScopes';
export const RequireScope = (...scopes: ApiKeyScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);
