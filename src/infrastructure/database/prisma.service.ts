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

      // Skip when inside a transaction — asAdmin() already handles RLS there,
      // and calling this.$executeRaw from within a tx runs on a different
      // connection (a no-op for RLS and risks connection-pool contention).
      if (ctx?.tenantId && !ctx.isAdmin && !params.runInTransaction) {
        await this
          .$executeRaw`SET LOCAL app.current_tenant_id = ${ctx.tenantId}`;
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
