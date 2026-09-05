import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtGuard } from './jwt.guard';

/**
 * Populates RequestContext from a JWT when a valid Authorization header is
 * present, but never rejects the request when it's missing or invalid —
 * unlike JwtGuard. Used by routes that must accept both authenticated
 * dashboard callers (to tenant-scope the write) and genuinely unauthenticated
 * ones (e.g. a crash on the public login page, before any session exists).
 *
 * Only token-validation failures (JwtGuard always throws UnauthorizedException
 * for those — see jwt.guard.ts) are treated as "anonymous caller". Any other
 * error (e.g. a downstream failure unrelated to the token itself) rethrows,
 * so it surfaces as a real 500 instead of silently being treated as anonymous.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.jwtGuard.canActivate(context);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        return true;
      }
      throw err;
    }
  }
}
