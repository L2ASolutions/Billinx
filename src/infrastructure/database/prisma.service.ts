import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { getOptionalRequestContext } from '../../shared/context/request-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  // Separate PrismaClient for admin operations.
  // Uses MIGRATION_DATABASE_URL (the owner/superuser role) so that
  // SET LOCAL row_security = OFF works — Postgres restricts that command to
  // superusers. Falls back to DATABASE_URL in dev where both roles are the
  // same superuser account.
  private readonly adminClient: PrismaClient;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'minimal',
    });

    this.adminClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
        },
      },
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'minimal',
    });

    this.applyRlsExtension();
  }

  // Replace the previous $use middleware (which ran SET LOCAL as a separate
  // statement on a different pooled connection — a no-op outside a transaction).
  //
  // Instead: use $extends with $transaction([set_config, query(args)]) so that
  // set_config('app.current_tenant_id', id, true) and the model query are sent
  // to Postgres inside the SAME BEGIN/COMMIT block on the SAME connection.
  // set_config with is_local=true is equivalent to SET LOCAL — it persists only
  // for the current transaction. Batching both in $transaction([...]) guarantees
  // the GUC is visible to the RLS policy when the query executes.
  private applyRlsExtension(): void {
    const base = this as unknown as PrismaClient;

    const extended = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const ctx = getOptionalRequestContext();
            if (!ctx?.tenantId || ctx.isAdmin) {
              return query(args);
            }
            const tenantId = ctx.tenantId;
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    });

    // Shadow each Prisma model accessor on this instance so service code
    // (e.g. prisma.invoice.findMany()) routes through the RLS-aware delegate.
    for (const modelName of Object.values(Prisma.ModelName)) {
      const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
      if (key in (extended as unknown as object)) {
        Object.defineProperty(this, key, {
          get: () => (extended as unknown as Record<string, unknown>)[key],
          configurable: true,
          enumerable: false,
        });
      }
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.adminClient.$connect();
    this.logger.log('Database connections established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.adminClient.$disconnect();
    this.logger.log('Database connections closed');
  }

  // Admin queries bypass all row-level security. Uses the owner-role connection
  // (MIGRATION_DATABASE_URL) so SET LOCAL row_security = OFF is permitted.
  // Never use this to run tenant-scoped logic — the caller receives an
  // unrestricted PrismaClient and sees all rows across all tenants.
  async asAdmin<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return this.adminClient.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL row_security = OFF`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}
