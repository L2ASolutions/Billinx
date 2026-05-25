// Sentry must be initialised before anything else in main.ts.
// Skip entirely when no DSN is configured — the @sentry/nestjs SDK v10 registers
// OpenTelemetry instrumentation at import time even when `enabled: false`, which
// causes unbounded in-memory span buffering and OOM crashes in development.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/nestjs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { nodeProfilingIntegration } = require('@sentry/profiling-node');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0.0,
  });
}
