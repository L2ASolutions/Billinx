/// <reference types="jest" />

import { validateEnvironment } from './config.validation';

const BASE_COMMON = { DATABASE_URL: 'postgresql://x:x@localhost/x' };

const BASE_PRODUCTION = {
  ...BASE_COMMON,
  NODE_ENV: 'production',
  JWT_PRIVATE_KEY_SECRET_ID: 'billinx/prod/jwt-private-key',
  JWT_PUBLIC_KEY_SECRET_ID: 'billinx/prod/jwt-public-key',
  MASTER_KEY_SECRET_ID: 'billinx/prod/master-key',
  ADMIN_KEY_SECRET_ID: 'billinx/prod/admin-key',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'af-south-1',
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  MIGRATION_DATABASE_URL: 'postgresql://billinx_owner:secret@localhost/billinx',
  ALLOWED_ORIGINS: 'https://app.billinx.ng',
};

const BASE_DEVELOPMENT = {
  ...BASE_COMMON,
  NODE_ENV: 'development',
  JWT_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
};

describe('validateEnvironment', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── AC5a: boot refuses when JWT key secret IDs are absent ─────────────────

  it('(AC5a) throws on startup when JWT_PRIVATE_KEY_SECRET_ID is absent in production', () => {
    process.env = {
      ...BASE_PRODUCTION,
      JWT_PRIVATE_KEY_SECRET_ID: '',
    };
    expect(() => validateEnvironment()).toThrow('JWT_PRIVATE_KEY_SECRET_ID');
  });

  it('(AC5a) throws on startup when JWT_PUBLIC_KEY_SECRET_ID is absent in production', () => {
    process.env = {
      ...BASE_PRODUCTION,
      JWT_PUBLIC_KEY_SECRET_ID: '',
    };
    expect(() => validateEnvironment()).toThrow('JWT_PUBLIC_KEY_SECRET_ID');
  });

  it('(AC5a) throws when JWT_PRIVATE_KEY is absent in development', () => {
    process.env = { ...BASE_COMMON, NODE_ENV: 'development' };
    expect(() => validateEnvironment()).toThrow('JWT_PRIVATE_KEY');
  });

  it('(AC1) throws on startup when MIGRATION_DATABASE_URL is absent in production', () => {
    process.env = { ...BASE_PRODUCTION, MIGRATION_DATABASE_URL: '' };
    expect(() => validateEnvironment()).toThrow('MIGRATION_DATABASE_URL');
  });

  it('throws on startup when ALLOWED_ORIGINS is absent in production', () => {
    process.env = { ...BASE_PRODUCTION, ALLOWED_ORIGINS: '' };
    expect(() => validateEnvironment()).toThrow('ALLOWED_ORIGINS');
  });

  // ── Success paths ──────────────────────────────────────────────────────────

  it('passes with all required production vars present', () => {
    process.env = { ...BASE_PRODUCTION };
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('passes with all required development vars present', () => {
    process.env = { ...BASE_DEVELOPMENT };
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('always requires DATABASE_URL regardless of environment', () => {
    process.env = { NODE_ENV: 'development', JWT_PRIVATE_KEY: 'x' };
    expect(() => validateEnvironment()).toThrow('DATABASE_URL');
  });
});
