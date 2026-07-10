/// <reference types="jest" />

// tsconfig has no esModuleInterop, so a default import of these CJS modules
// resolves to `.default` at runtime and breaks (`express_1.default` is
// undefined) — the `= require(...)` form is the correct CJS-compatible import.
/* eslint-disable @typescript-eslint/no-require-imports */
import express = require('express');
import request = require('supertest');
/* eslint-enable @typescript-eslint/no-require-imports */
import { applySecurityHeaders, buildHelmetOptions } from './security-headers';

describe('buildHelmetOptions', () => {
  it('never disables any of the six recommended directives', () => {
    for (const isProduction of [true, false]) {
      const opts = buildHelmetOptions(isProduction);
      expect(opts.contentSecurityPolicy).not.toBe(false);
      expect(opts.strictTransportSecurity).not.toBe(false);
      expect(opts.noSniff).not.toBe(false);
      expect(opts.frameguard).not.toBe(false);
      expect(opts.xssFilter).not.toBe(false);
      expect(opts.hidePoweredBy).not.toBe(false);
    }
  });

  it('locks script-src/style-src to self in production, relaxes only in dev for Swagger', () => {
    expect(
      buildHelmetOptions(true).contentSecurityPolicy.directives,
    ).toMatchObject({
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
    });
    expect(
      buildHelmetOptions(false).contentSecurityPolicy.directives,
    ).toMatchObject({
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    });
  });
});

describe('applySecurityHeaders (on API responses)', () => {
  function makeApp(isProduction: boolean) {
    const app = express();
    applySecurityHeaders(app, isProduction);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('sets Content-Security-Policy (previously disabled entirely)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('sets Strict-Transport-Security (helmet.hsts)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('sets X-Content-Type-Options: nosniff (helmet.noSniff)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY (helmet.frameguard)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets X-XSS-Protection: 0 (helmet.xssFilter)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['x-xss-protection']).toBe('0');
  });

  it('removes X-Powered-By (helmet.hidePoweredBy)', async () => {
    const res = await request(makeApp(true)).get('/ping');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
