import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { runWithContext } from "../../../shared/context/request-context";
import { RequestContext } from "../../../../packages/types/identity";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";

const ADMIN_KEY_PREFIX_LENGTH = 20;

@Injectable()
export class AdminKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminKeyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const adminKey = request.headers["x-admin-key"] as string;

    if (!adminKey) {
      throw new UnauthorizedException("Missing X-Admin-Key header");
    }

    const keyPrefix = adminKey.substring(0, ADMIN_KEY_PREFIX_LENGTH);

    type AdminKeyRow = { id: string; key_hash: string };

    const candidates = await this.prisma.$queryRaw<AdminKeyRow[]>`
      SELECT id, key_hash FROM admin_keys
      WHERE key_prefix = ${keyPrefix}
      AND is_revoked = FALSE
      LIMIT 1
    `;

    if (!candidates.length) {
      throw new UnauthorizedException("Invalid admin key");
    }

    const valid = await bcrypt.compare(adminKey, candidates[0].key_hash);
    if (!valid) {
      throw new UnauthorizedException("Invalid admin key");
    }

    const requestContext: RequestContext = {
      tenantId: "ADMIN",
      environment: "PRODUCTION",
      tier: "ENTERPRISE",
      actor: `admin:${candidates[0].id}`,
      actorType: "admin",
      requestId: crypto.randomUUID(),
      isAdmin: true,
    };

    return new Promise((resolve) => {
      runWithContext(requestContext, () => {
        (request as any)._billinxContext = requestContext;
        resolve(true);
      });
    });
  }
}