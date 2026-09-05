import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

/**
 * Populates RequestContext from a JWT when a valid Authorization header is
 * present, but never rejects the request when it's missing or invalid —
 * unlike JwtGuard. Used by routes that must accept both authenticated
 * dashboard callers (to tenant-scope the write) and genuinely unauthenticated
 * ones (e.g. a crash on the public login page, before any session exists).
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.jwtGuard.canActivate(context);
    } catch {
      return true;
    }
  }
}
