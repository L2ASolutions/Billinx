import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import * as jwt from "jsonwebtoken";

@Injectable()
export class AdminJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing admin authorization token");
    }

    const token = authHeader.substring(7).trim();

    try {
      const secret =
        process.env.ADMIN_JWT_SECRET ??
        process.env.JWT_SECRET ??
        "billinx-admin-secret-change-in-production";

      const payload = jwt.verify(token, secret) as any;

      if (!payload.isAdmin) {
        throw new UnauthorizedException("Not an admin token");
      }

      (request as any)._adminContext = {
        adminId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      return true;
    } catch (err: any) {
      throw new UnauthorizedException("Invalid or expired admin token");
    }
  }
}