/// <reference types="jest" />

import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

const USER_ID = 'user-001';
const TENANT_ID = 'tenant-001';

// Generate a single RSA key pair for the full test run.  2048-bit is
// cryptographically correct; using it here (vs 4096-bit) keeps the
// beforeAll runtime under ~300 ms.
let testPrivateKeyPem: string;
let testPublicKeyPem: string;
let attackerPrivateKeyPem: string; // separate key — used for forgery tests

beforeAll(() => {
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  testPrivateKeyPem = kp.privateKey;
  testPublicKeyPem = kp.publicKey;

  const attacker = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  attackerPrivateKeyPem = attacker.privateKey;
});

function makeSecrets(
  overrides: Partial<{
    getJwtPrivateKey: () => Promise<string>;
    getJwtPublicKey: () => Promise<string>;
  }> = {},
) {
  return {
    getJwtPrivateKey: jest.fn().mockResolvedValue(testPrivateKeyPem),
    getJwtPublicKey: jest.fn().mockResolvedValue(testPublicKeyPem),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'rt-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'rt-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

describe('TokenService', () => {
  let service: TokenService;
  let prisma: ReturnType<typeof makePrisma>;
  let secrets: ReturnType<typeof makeSecrets>;

  beforeEach(() => {
    prisma = makePrisma();
    secrets = makeSecrets();
    service = new TokenService(prisma as any, secrets as any);
  });

  // ── issueTokenPair ────────────────────────────────────────────────────────

  describe('issueTokenPair', () => {
    it('issues an RS256-signed access token and a prefixed refresh token, and persists a hash of the refresh token', async () => {
      const result = await service.issueTokenPair(
        USER_ID,
        TENANT_ID,
        'PRODUCTION',
        'STANDARD',
        'member',
      );

      expect(result.tokenResponse.tokenType).toBe('Bearer');
      expect(result.refreshToken.startsWith(`${USER_ID}|${TENANT_ID}|`)).toBe(
        true,
      );

      // Verify that the token is RS256 (asymmetric) and carries the right payload.
      const decoded = jwt.verify(
        result.tokenResponse.accessToken,
        testPublicKeyPem,
        { algorithms: ['RS256'] },
      ) as any;
      expect(decoded.sub).toBe(USER_ID);
      expect(decoded.tenantId).toBe(TENANT_ID);
      expect(decoded.environment).toBe('PRODUCTION');
      expect(decoded.tier).toBe('STANDARD');
      expect(decoded.role).toBe('member');

      // The token header must declare RS256.
      const [headerB64] = result.tokenResponse.accessToken.split('.');
      const header = JSON.parse(
        Buffer.from(headerB64, 'base64url').toString('utf8'),
      );
      expect(header.alg).toBe('RS256');

      expect(prisma.__tx.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            userId: USER_ID,
          }),
        }),
      );
      // The raw refresh token must never be persisted — only its bcrypt hash.
      const persisted = prisma.__tx.refreshToken.create.mock.calls[0][0].data;
      expect(persisted.tokenHash).not.toBe(result.refreshToken);
    });
  });

  // ── verifyAccessToken ─────────────────────────────────────────────────────

  describe('verifyAccessToken', () => {
    it('returns the decoded payload for a valid RS256 token', async () => {
      const token = jwt.sign(
        { sub: USER_ID, tenantId: TENANT_ID },
        testPrivateKeyPem,
        { algorithm: 'RS256', expiresIn: '15m' },
      );
      const payload = await service.verifyAccessToken(token);
      expect(payload.sub).toBe(USER_ID);
    });

    it('throws UnauthorizedException with an "expired" message for an expired token', async () => {
      const token = jwt.sign({ sub: USER_ID }, testPrivateKeyPem, {
        algorithm: 'RS256',
        expiresIn: -10,
      });
      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'Access token expired',
      );
    });

    it('throws UnauthorizedException for a token signed with a different RS256 private key', async () => {
      const token = jwt.sign({ sub: USER_ID }, attackerPrivateKeyPem, {
        algorithm: 'RS256',
        expiresIn: '15m',
      });
      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a malformed token', async () => {
      await expect(service.verifyAccessToken('not-a-jwt')).rejects.toThrow(
        'Invalid access token',
      );
    });

    // ── AC5b: HS256 tokens must be rejected ───────────────────────────────

    it('(AC5b) rejects a token signed with a symmetric HS256 secret', async () => {
      const hs256Token = jwt.sign(
        {
          sub: USER_ID,
          tenantId: TENANT_ID,
          environment: 'PRODUCTION',
          tier: 'STANDARD',
          role: 'member',
        },
        'some-symmetric-secret',
        { expiresIn: '15m' },
        // jsonwebtoken defaults to HS256 when given a string secret
      );
      await expect(service.verifyAccessToken(hs256Token)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    // ── AC5c: forged admin token with wrong key must be rejected ──────────

    it('(AC5c) rejects a forged admin token signed with an attacker-controlled RSA key', async () => {
      const forgedToken = jwt.sign(
        {
          sub: 'attacker-user-id',
          tenantId: 'victim-tenant-id',
          role: 'admin',
          environment: 'PRODUCTION',
          tier: 'ENTERPRISE',
        },
        attackerPrivateKeyPem,
        { algorithm: 'RS256', expiresIn: '15m' },
      );
      // The server's public key will not match the attacker's private key.
      await expect(service.verifyAccessToken(forgedToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── rotateRefreshToken ────────────────────────────────────────────────────

  describe('rotateRefreshToken', () => {
    it('throws UnauthorizedException when no candidate token matches', async () => {
      prisma.__tx.refreshToken.findMany.mockResolvedValue([]);
      await expect(
        service.rotateRefreshToken(`${USER_ID}|${TENANT_ID}|somerandom`),
      ).rejects.toThrow('Invalid or expired refresh token');
    });

    it('scopes the candidate query to the prefixed userId/tenantId when present', async () => {
      prisma.__tx.refreshToken.findMany.mockResolvedValue([]);
      await expect(
        service.rotateRefreshToken(`${USER_ID}|${TENANT_ID}|somerandom`),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.__tx.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            tenantId: TENANT_ID,
          }),
          take: 10,
        }),
      );
    });

    it('falls back to an unscoped, capped query for legacy tokens without the userId|tenantId prefix', async () => {
      prisma.__tx.refreshToken.findMany.mockResolvedValue([]);
      await expect(
        service.rotateRefreshToken('legacy-token-without-prefix'),
      ).rejects.toThrow(UnauthorizedException);

      const call = prisma.__tx.refreshToken.findMany.mock.calls[0][0];
      expect(call.where.userId).toBeUndefined();
      expect(call.take).toBe(100);
    });

    it('revokes the matched token and issues a new token pair on success', async () => {
      const rawToken = `${USER_ID}|${TENANT_ID}|somerandom`;
      const tokenHash = await bcrypt.hash(rawToken, 10);
      prisma.__tx.refreshToken.findMany.mockResolvedValue([
        {
          id: 'rt-old',
          userId: USER_ID,
          tenantId: TENANT_ID,
          tokenHash,
          tenant: { environment: 'PRODUCTION', rateLimitTier: 'STANDARD' },
        },
      ]);

      const result = await service.rotateRefreshToken(rawToken);

      expect(prisma.__tx.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-old' },
        data: expect.objectContaining({ isRevoked: true }),
      });
      expect(
        result.newRefreshToken.startsWith(`${USER_ID}|${TENANT_ID}|`),
      ).toBe(true);
      expect(result.tokenResponse.tokenType).toBe('Bearer');
    });

    it('does not match a candidate whose hash does not correspond to the raw token', async () => {
      prisma.__tx.refreshToken.findMany.mockResolvedValue([
        {
          id: 'rt-old',
          userId: USER_ID,
          tenantId: TENANT_ID,
          tokenHash: 'not-a-real-bcrypt-hash-for-this-token',
          tenant: { environment: 'PRODUCTION', rateLimitTier: 'STANDARD' },
        },
      ]);

      await expect(
        service.rotateRefreshToken(`${USER_ID}|${TENANT_ID}|somerandom`),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── revokeAllUserTokens ───────────────────────────────────────────────────

  describe('revokeAllUserTokens', () => {
    it('revokes all active refresh tokens for the user in the tenant', async () => {
      await service.revokeAllUserTokens(USER_ID, TENANT_ID);
      expect(prisma.__tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, tenantId: TENANT_ID, isRevoked: false },
        data: expect.objectContaining({ isRevoked: true }),
      });
    });
  });
});
