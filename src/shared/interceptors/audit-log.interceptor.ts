import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Request } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { getOptionalRequestContext } from '../context/request-context';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap((responseBody) => {
        this.writeAuditLog(request, responseBody, null, Date.now() - startTime);
      }),
      catchError((error) => {
        this.writeAuditLog(request, null, error, Date.now() - startTime);
        return throwError(() => error);
      }),
    );
  }

  private writeAuditLog(
    request: Request,
    responseBody: unknown,
    error: Error | null,
    durationMs: number,
  ): void {
    const ctx = getOptionalRequestContext();
    if (!ctx) return;

    const payload = JSON.parse(
      JSON.stringify({
        method: request.method,
        path: request.path,
        statusCode: error ? 500 : 200,
        durationMs,
        body: this.sanitiseBody(request.body),
        error: error ? { message: error.message, name: error.name } : null,
      }),
    );

    this.prisma.auditLog
      .create({
        data: {
          tenantId: ctx.tenantId === 'ADMIN' ? null : ctx.tenantId,
          eventType: `api.${request.method.toLowerCase()}.${error ? 'error' : 'success'}`,
          entityType: 'HttpRequest',
          entityId: ctx.requestId,
          actor: ctx.actor,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          payload,
        },
      })
      .catch((err) =>
        this.logger.error(`Failed to write audit log: ${err.message}`),
      );
  }

  private sanitiseBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;

    const REDACTED_FIELDS = new Set([
      'password',
      'apiKey',
      'key',
      'secret',
      'token',
      'credential',
      'privateKey',
      'authorization',
    ]);

    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACTED_FIELDS.has(k.toLowerCase()) ? '[REDACTED]' : v,
      ]),
    );
  }
}
