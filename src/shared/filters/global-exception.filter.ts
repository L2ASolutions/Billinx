import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { getOptionalRequestContext } from '../context/request-context';
import { PrismaService } from '../../infrastructure/database/prisma.service';
// Only import Sentry when a DSN is configured — the SDK registers OTEL hooks
// at import time which causes OOM in development when no DSN is present.
const Sentry = process.env.SENTRY_DSN ? require('@sentry/nestjs') : null;

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  requestId?: string;
  timestamp: string;
  path: string;
}

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestCtx = getOptionalRequestContext();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        error = (resp.error as string) ?? exception.name;
        message = (resp.message as string) ?? exception.message;
      } else {
        message = exceptionResponse;
        error = exception.name;
      }
    } else if (
      exception instanceof Error &&
      exception.constructor.name === 'PrismaClientValidationError'
    ) {
      // Prisma validation errors (missing required field, wrong type, etc.)
      // are a client mistake — return 400 without logging to system-error table.
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'BAD_REQUEST';
      message = 'Invalid request data';
      this.logger.warn(
        `Prisma validation error on ${request.path}: ${exception.message.split('\n')[0]}`,
      );
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );

      Sentry?.captureException(exception, {
        extra: {
          path: request.path,
          method: request.method,
          requestId: requestCtx?.requestId,
          tenantId: requestCtx?.tenantId,
        },
      });

      // Log to system errors table asynchronously
      this.trackSystemError(exception, request, requestCtx);
    }

    const errorResponse: ErrorResponse = {
      error,
      message,
      statusCode,
      requestId: requestCtx?.requestId,
      timestamp: new Date().toISOString(),
      path: request.path,
    };

    response.status(statusCode).json(errorResponse);
  }

  private trackSystemError(
    error: Error,
    request: Request,
    requestCtx: any,
  ): void {
    this.prisma
      .asAdmin((tx) =>
        tx.systemError.create({
          data: {
            tenantId:
              requestCtx?.tenantId !== 'ADMIN'
                ? (requestCtx?.tenantId ?? null)
                : null,
            errorCode: error.name ?? 'UNKNOWN_ERROR',
            errorMessage: error.message,
            stackTrace: error.stack ?? null,
            endpoint: request.path,
            method: request.method,
            actor: requestCtx?.actor ?? null,
            requestId: requestCtx?.requestId ?? null,
            severity: 'HIGH',
            isResolved: false,
          },
        }),
      )
      .catch((err) =>
        this.logger.error(`Failed to track system error: ${err.message}`),
      );
  }
}
