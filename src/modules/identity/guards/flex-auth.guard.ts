import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Accepts either a valid JWT (dashboard users) or a valid API key (programmatic
 * access). Tries JWT first; if it fails, falls back to the API key check.
 * This allows the same endpoint to serve both the web dashboard and API clients.
 */
@Injectable()
export class FlexAuthGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.jwtGuard.canActivate(context);
    } catch {
      return this.apiKeyGuard.canActivate(context);
    }
  }
}
