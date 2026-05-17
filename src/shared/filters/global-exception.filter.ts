import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response, Request } from "express";
import { getOptionalRequestContext } from "../context/request-context";
import * as Sentry from "@sentry/nestjs";

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  requestId?: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestCtx = getOptionalRequestContext();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = "INTERNAL_SERVER_ERROR";
    let message = "An unexpected error occurred";

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "object") {
        const resp = exceptionResponse as Record<string, unknown>;
        error = (resp.error as string) ?? exception.name;
        message = (resp.message as string) ?? exception.message;
      } else {
        message = exceptionResponse as string;
        error = exception.name;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );

      Sentry.captureException(exception, {
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
    // Dynamically import to avoid circular dependencies
    import("../../infrastructure/database/prisma.service")
      .then(({ PrismaService }) => {
        const prisma = new PrismaService();
        return prisma.asAdmin(async (tx) => {
          return tx.systemError.create({
            data: {
              tenantId: requestCtx?.tenantId !== "ADMIN"
                ? requestCtx?.tenantId ?? null
                : null,
              errorCode: error.name ?? "UNKNOWN_ERROR",
              errorMessage: error.message,
              stackTrace: error.stack ?? null,
              endpoint: request.path,
              method: request.method,
              actor: requestCtx?.actor ?? null,
              requestId: requestCtx?.requestId ?? null,
              severity: "HIGH",
              isResolved: false,
            },
          });
        });
      })
      .catch((err) =>
        this.logger.error(`Failed to track system error: ${err.message}`),
      );
  }
}