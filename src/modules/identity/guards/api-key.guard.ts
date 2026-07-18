import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from '../services/api-key.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { runWithContext } from '../../../shared/context/request-context';
import { RequestContext } from '../../../../packages/types/identity';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or malformed Authorization header. Expected: Bearer <api_key>',
      );
    }

    const rawKey = authHeader.substring(7).trim();
    const clientIp =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.ip;

    const KEY_FORMAT_RE = /^blx_(live|test)_[A-Za-z0-9_-]{20,}$/;
    if (!KEY_FORMAT_RE.test(rawKey)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const { tenantId, keyId, environment, scopes } =
      await this.apiKeyService.verifyApiKey(rawKey, clientIp);

    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { rateLimitTier: true, environment: true },
      });
    });

    if (!tenant) {
      throw new UnauthorizedException('Tenant not found');
    }

    const requestContext: RequestContext = {
      tenantId,
      environment: environment,
      tier: tenant.rateLimitTier,
      actor: `apikey:${keyId}`,
      actorType: 'apikey',
      requestId:
        (request.headers['x-request-id'] as string) ?? crypto.randomUUID(),
      isAdmin: false,
      scopes,
    };

    (request as any)._billinxContext = requestContext;
    runWithContext(requestContext, () => {});
    return true;
  }
}
