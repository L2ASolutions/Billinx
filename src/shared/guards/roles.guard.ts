import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRoleType } from '../../../packages/types/user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRoleType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ctx = request._billinxContext;

    // No context (public endpoint) or non-user actor (API key) — pass through
    if (!ctx || ctx.actorType !== 'user') {
      return true;
    }

    const userId = ctx.actor.replace('user:', '');

    const userRoles = await this.prisma.asAdmin((tx) =>
      tx.userRole.findMany({
        where: { userId, tenantId: ctx.tenantId },
        select: { role: true },
      }),
    );

    const roleSet = new Set(userRoles.map((r) => r.role as string));
    const allowed = requiredRoles.some((r) => roleSet.has(r));

    if (!allowed) {
      throw new ForbiddenException(
        `Requires one of: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
