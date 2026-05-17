import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { ApiKeyService } from "../services/api-key.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { runWithContext } from "../../../shared/context/request-context";
import { RequestContext, Environment, RateLimitTier } from "../../../../packages/types/identity";
import * as crypto from "crypto";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Missing or malformed Authorization header. Expected: Bearer <api_key>",
      );
    }

    const rawKey = authHeader.substring(7).trim();

    const { tenantId, keyId, environment } =
      await this.apiKeyService.verifyApiKey(rawKey);

    const tenant = await this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { rateLimitTier: true, environment: true },
      });
    });

    if (!tenant) {
      throw new UnauthorizedException("Tenant not found");
    }

    const requestContext: RequestContext = {
      tenantId,
      environment: environment as Environment,
      tier: tenant.rateLimitTier as RateLimitTier,
      actor: `apikey:${keyId}`,
      actorType: "apikey",
      requestId: (request.headers["x-request-id"] as string) ?? crypto.randomUUID(),
      isAdmin: false,
    };

    (request as any)._billinxContext = requestContext;
    runWithContext(requestContext, () => {});
    return true;
  }
}