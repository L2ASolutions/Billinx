import 'dotenv/config'; // Load .env before anything else (dev fallback; prod uses injected env vars)
import './instrument'; // Sentry must be initialised before anything else
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { validateEnvironment } from './config/config.validation';
import { VersionHeaderInterceptor } from './shared/interceptors/version-header.interceptor';
import { applySecurityHeaders } from './shared/security/security-headers';
import * as express from 'express';

async function bootstrap() {
  validateEnvironment();

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });

  // Trust the first proxy hop (AWS ALB / Nginx) so req.ip and X-Forwarded-For are correct
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Build the CORS allowed-origins list.
  // Production: ALLOWED_ORIGINS is required — validateEnvironment() has already thrown if absent.
  // Development: fall back to localhost:3001 and the Codespace forwarded-port URL when
  //   NODE_ENV is explicitly 'development' and ALLOWED_ORIGINS is not set.
  let allowedOrigins: string[];
  if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) =>
      o.trim(),
    );
  } else if (process.env.NODE_ENV === 'development') {
    allowedOrigins = ['http://localhost:3001'];
    const codespaceName = process.env.CODESPACE_NAME;
    if (codespaceName) {
      const domain =
        process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ??
        'app.github.dev';
      allowedOrigins.push(`https://${codespaceName}-3001.${domain}`);
    }
  } else {
    allowedOrigins = [];
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Admin-Key',
    ],
    credentials: true,
  });

  // See src/shared/security/security-headers.ts for the full Helmet
  // configuration (all six recommended directives, none disabled) and why.
  applySecurityHeaders(app, process.env.NODE_ENV === 'production');

  // Capture raw body bytes before parsing — required for Paystack/Flutterwave HMAC
  // verification. We register this before app.listen() so NestJS's registerParserMiddleware
  // sees 'jsonParser' already in the stack (via isMiddlewareApplied) and skips adding its
  // own 100kb-limited version, preserving our 10mb limit for bulk invoice endpoints.
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res: any, buf: Buffer) => {
        if (buf && buf.length) {
          req.rawBody = buf;
        }
      },
    }),
  );
  app.use(express.text({ type: 'application/xml' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalInterceptors(new VersionHeaderInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: false,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Billinx Compliance API')
      .setDescription('Nigeria FIRS/NRS E-Invoicing Compliance Infrastructure')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', name: 'X-Admin-Key', in: 'header' },
        'AdminKey',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    app.getHttpAdapter().get('/openapi.json', (_req: any, res: any) => {
      res.json(document);
    });
  }

  if (!process.env.ADMIN_ALLOWED_IPS) {
    logger.warn(
      process.env.NODE_ENV === 'production'
        ? '⚠️  ADMIN_ALLOWED_IPS is not set — all /v1/admin routes will return 403. ' +
            'Set this env var to a comma-separated CIDR allowlist (e.g. "10.0.0.0/8,203.0.113.5").'
        : '⚠️  ADMIN_ALLOWED_IPS is not set — admin routes allow any IP (development mode).',
    );
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Billinx API running on port ${port}`);
  logger.log(`OpenAPI docs: http://localhost:${port}/docs`);

  // Graceful shutdown — ECS sends SIGTERM before stopping the task
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} — shutting down gracefully`);

    // Stop accepting new connections; finish in-flight requests (30s max)
    await app.close();
    logger.log('Application closed cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Log uncaught exceptions and unhandled rejections so the crash reason
  // is always visible in pm2 error logs before the process exits.
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, err.stack);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error(`Unhandled promise rejection: ${msg}`, stack);
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
