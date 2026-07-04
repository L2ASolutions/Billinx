/// <reference types="jest" />

import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

const JWT_SECRET = 'test-jwt-secret';
const USER_ID = 'user-001';
const TENANT_ID = 'tenant-001';

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
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, JWT_SECRET };
    prisma = makePrisma();
    service = new TokenService(prisma as any, {} as any);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── issueTokenPair ────────────────────────────────────────────────────────

  describe('issueTokenPair', () => {
    it('issues a signed access token and a prefixed refresh token, and persists a hash of the refresh token', async () => {
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

      const decoded = jwt.verify(
        result.tokenResponse.accessToken,
        JWT_SECRET,
      ) as any;
      expect(decoded.sub).toBe(USER_ID);
      expect(decoded.tenantId).toBe(TENANT_ID);
      expect(decoded.environment).toBe('PRODUCTION');
      expect(decoded.tier).toBe('STANDARD');
      expect(decoded.role).toBe('member');

      expect(prisma.__tx.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            userId: USER_ID,
          }),
        }),
      );
      // the raw refresh token itself must never be persisted, only its hash
      const persisted = prisma.__tx.refreshToken.create.mock.calls[0][0].data;
      expect(persisted.tokenHash).not.toBe(result.refreshToken);
    });
  });

  // ── verifyAccessToken ─────────────────────────────────────────────────────

  describe('verifyAccessToken', () => {
    it('returns the decoded payload for a valid token', async () => {
      const token = jwt.sign(
        { sub: USER_ID, tenantId: TENANT_ID },
        JWT_SECRET,
        {
          expiresIn: '15m',
        },
      );
      const payload = await service.verifyAccessToken(token);
      expect(payload.sub).toBe(USER_ID);
    });

    it('throws UnauthorizedException with an "expired" message for an expired token', async () => {
      const token = jwt.sign({ sub: USER_ID }, JWT_SECRET, { expiresIn: -10 });
      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'Access token expired',
      );
    });

    it('throws UnauthorizedException for a token signed with the wrong secret', async () => {
      const token = jwt.sign({ sub: USER_ID }, 'wrong-secret', {
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
