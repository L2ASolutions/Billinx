import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from '../decorators/require-scope.decorator';
import { ApiKeyScope } from '../../../packages/types/identity';

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ctx = request._billinxContext;

    // Scopes are an API-key-only concept — JWT/admin/system actors are
    // governed by RolesGuard instead. Must run after ApiKeyGuard/FlexAuthGuard
    // in the same @UseGuards() array so ctx.scopes is already populated.
    if (!ctx || ctx.actorType !== 'apikey') {
      return true;
    }

    const grantedScopes: ApiKeyScope[] = ctx.scopes ?? [];
    if (grantedScopes.includes('*')) {
      return true;
    }

    const allowed = requiredScopes.some((s) => grantedScopes.includes(s));
    if (!allowed) {
      throw new ForbiddenException(
        `API key is missing required scope: ${requiredScopes.join(' or ')}`,
      );
    }

    return true;
  }
}
