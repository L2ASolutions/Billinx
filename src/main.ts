import './instrument'; // Sentry must be initialised before anything else
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { validateEnvironment } from './config/config.validation';
import { VersionHeaderInterceptor } from './shared/interceptors/version-header.interceptor';
import helmet from 'helmet';
import * as express from 'express';

async function bootstrap() {
  validateEnvironment();

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Trust the first proxy hop (AWS ALB / Nginx) so req.ip and X-Forwarded-For are correct
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3001'];

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

  app.use(
    helmet({
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: false, // managed at ALB/CDN level
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    }),
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ type: 'application/xml' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalInterceptors(new VersionHeaderInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: false,
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

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
