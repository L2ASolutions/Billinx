import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { getRequestContext } from '../context/request-context';
import * as crypto from 'crypto';

const IDEMPOTENCY_TTL_HOURS = 24;
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return next.handle();
    }

    const idempotencyKey = request.headers[IDEMPOTENCY_KEY_HEADER] as string;

    if (!idempotencyKey) {
      return next.handle();
    }

    if (idempotencyKey.length > 255) {
      throw new ConflictException('Idempotency-Key must be <= 255 characters');
    }

    let ctx: ReturnType<typeof getRequestContext> | null = null;
    try {
      ctx = getRequestContext();
    } catch {
      return next.handle();
    }

    const requestHash = this.hashBody(request.body);

    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.idempotencyRecord.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: ctx.tenantId,
            idempotencyKey,
          },
        },
      });
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key reused with different request body',
        );
      }

      this.logger.log(
        `Idempotency replay: key=${idempotencyKey} tenant=${ctx.tenantId}`,
      );

      response.setHeader('Idempotent-Replayed', 'true');
      response.status(existing.responseStatus);
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((responseBody) => {
        void (async () => {
          const statusCode = response.statusCode;
          const expiresAt = new Date(
            Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
          );

          await this.prisma.asAdmin(async (tx) => {
            return tx.idempotencyRecord.create({
              data: {
                tenantId: ctx.tenantId,
                idempotencyKey,
                requestHash,
                responseBody: JSON.parse(JSON.stringify(responseBody ?? {})),
                responseStatus: statusCode,
                expiresAt,
              },
            });
          });
        })();
      }),
    );
  }

  private hashBody(body: unknown): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(body ?? {}))
      .digest('hex');
  }
}
