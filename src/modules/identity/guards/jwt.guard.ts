import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { TokenService } from "../services/token.service";
import { runWithContext } from "../../../shared/context/request-context";
import { RequestContext } from "../../../../packages/types/identity";
import * as crypto from "crypto";

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly logger = new Logger(JwtGuard.name);

  constructor(private readonly tokenService: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing Authorization header");
    }

    const token = authHeader.substring(7).trim();
    const payload = await this.tokenService.verifyAccessToken(token);

    const requestContext: RequestContext = {
      tenantId: payload.tenantId,
      environment: payload.environment,
      tier: payload.tier,
      actor: `user:${payload.sub}`,
      actorType: "user",
      requestId: (request.headers["x-request-id"] as string) ?? crypto.randomUUID(),
      isAdmin: payload.role === "admin",
    };

    return new Promise((resolve) => {
      runWithContext(requestContext, () => {
        (request as any)._billinxContext = requestContext;
        resolve(true);
      });
    });
  }
}