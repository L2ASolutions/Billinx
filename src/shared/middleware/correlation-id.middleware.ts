import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

export const CORRELATION_HEADER = 'x-request-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : crypto.randomUUID();

    // Normalise so guards and interceptors always read from the same place
    req.headers[CORRELATION_HEADER] = requestId;
    res.setHeader(CORRELATION_HEADER, requestId);

    next();
  }
}
