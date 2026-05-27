import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getOptionalRequestContext } from '../../shared/context/request-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'minimal',
    });

    this.$use(async (params, next) => {
      const ctx = getOptionalRequestContext();

      // Skip when inside a transaction — asAdmin() handles RLS with
      // SET LOCAL row_security = OFF inside the transaction.
      // Skip for raw queries ($executeRaw / $queryRaw) — params.model is
      // undefined for raw operations. Without this guard, calling $executeRaw
      // from the middleware re-triggers the middleware, creating an infinite
      // async chain that exhausts the heap.
      if (
        ctx?.tenantId &&
        !ctx.isAdmin &&
        !params.runInTransaction &&
        params.model
      ) {
        // $executeRaw uses parameterized queries ($1 placeholders), but
        // Postgres SET does not support prepared-statement parameters.
        // $executeRawUnsafe sends the literal string; tenantId is a
        // database-generated UUID so there is no injection risk.
        await this.$executeRawUnsafe(
          `SET LOCAL app.current_tenant_id = '${ctx.tenantId}'`,
        );
      }

      return next(params);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  async asAdmin<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL row_security = OFF`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}
