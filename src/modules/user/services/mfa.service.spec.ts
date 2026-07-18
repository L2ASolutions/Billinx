/// <reference types="jest" />

import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MfaService } from './mfa.service';

const USER_ID = 'user-001';
const TENANT_ID = 'tenant-001';
const MASTER_KEY = Buffer.alloc(32, 7);
// Derive the same MFA challenge secret the service produces, so tests can
// craft tokens that exercise edge-case branches (no-isMfaToken, expired).
const MFA_CHALLENGE_SECRET = crypto
  .createHmac('sha256', MASTER_KEY)
  .update('mfa-challenge')
  .digest('hex');

// Real base32 TOTP secret generation/verification lives in this module and is
// not exported, so we drive it through the public API using a real secret we
// control, encrypted with a stub CredentialService that just base64s values
// (deterministic, reversible, and exercises the real TOTP math).
function makeCredentialService() {
  return {
    encrypt: jest.fn((plaintext: string) => ({
      encrypted: Buffer.from(plaintext, 'utf8'),
      iv: Buffer.from('iv'),
    })),
    decrypt: jest.fn((encryptedBuffer: Buffer) =>
      encryptedBuffer.toString('utf8'),
    ),
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve(data)),
    },
    ...overrides,
  };
  return {
    asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)),
    __tx: tx,
  };
}

// Extract the real base32 secret MfaService generated so tests can compute a
// valid current TOTP code for it using the same RFC 6238 algorithm.
function totpFor(secretBase32: string): string {
  function base32Decode(s: string): Buffer {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const str = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    const result: number[] = [];
    let bits = 0;
    let value = 0;
    for (const ch of str) {
      const idx = chars.indexOf(ch);
      if (idx === -1) continue;
      bits += 5;
      value = (value << 5) | idx;
      if (bits >= 8) {
        result.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(result);
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

describe('MfaService', () => {
  let service: MfaService;
  let prisma: ReturnType<typeof makePrisma>;
  let credentialService: ReturnType<typeof makeCredentialService>;
  let secrets: { getMasterEncryptionKey: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    credentialService = makeCredentialService();
    secrets = {
      getMasterEncryptionKey: jest.fn().mockResolvedValue(MASTER_KEY),
    };
    service = new MfaService(
      prisma as any,
      secrets as any,
      credentialService as any,
    );
  });

  // ── setupMfa ──────────────────────────────────────────────────────────────

  describe('setupMfa', () => {
    it('generates and stores an encrypted secret, and returns a QR code + manual key', async () => {
      const result = await service.setupMfa(USER_ID, 'user@example.com');

      expect(result.qrCodeBase64).toMatch(/^data:image\/png;base64,/);
      expect(result.manualKey).toMatch(/^[A-Z2-7]+$/);
      expect(prisma.__tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({ mfaEnabled: false }),
        }),
      );
    });
  });

  // ── verifySetupAndEnable ──────────────────────────────────────────────────

  describe('verifySetupAndEnable', () => {
    it('throws BadRequestException when setup was never started', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({ id: USER_ID });
      await expect(
        service.verifySetupAndEnable(USER_ID, '123456'),
      ).rejects.toThrow('MFA setup not started');
    });

    it('throws BadRequestException when MFA is already enabled', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaSecret: Buffer.from('secret'),
        mfaSecretIv: Buffer.from('iv'),
        mfaEnabled: true,
      });
      await expect(
        service.verifySetupAndEnable(USER_ID, '123456'),
      ).rejects.toThrow('MFA is already enabled');
    });

    it('throws BadRequestException for an incorrect OTP code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaSecret: Buffer.from(secret, 'utf8'),
        mfaSecretIv: Buffer.from('iv'),
        mfaEnabled: false,
      });
      await expect(
        service.verifySetupAndEnable(USER_ID, '000000'),
      ).rejects.toThrow('Invalid OTP code');
    });

    it('enables MFA when the OTP code is correct', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaSecret: Buffer.from(secret, 'utf8'),
        mfaSecretIv: Buffer.from('iv'),
        mfaEnabled: false,
      });
      const code = totpFor(secret);

      await service.verifySetupAndEnable(USER_ID, code);

      expect(prisma.__tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { mfaEnabled: true } }),
      );
    });
  });

  // ── disableMfa ────────────────────────────────────────────────────────────

  describe('disableMfa', () => {
    it('throws BadRequestException when MFA is not enabled', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: false,
      });
      await expect(service.disableMfa(USER_ID, '123456')).rejects.toThrow(
        'MFA is not enabled',
      );
    });

    it('throws UnauthorizedException for an invalid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
        mfaSecret: Buffer.from(secret, 'utf8'),
        mfaSecretIv: Buffer.from('iv'),
        mfaBackupCodes: [],
      });
      await expect(service.disableMfa(USER_ID, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('disables MFA and clears the secret/backup codes on a valid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
        mfaSecret: Buffer.from(secret, 'utf8'),
        mfaSecretIv: Buffer.from('iv'),
        mfaBackupCodes: [],
      });
      const code = totpFor(secret);

      await service.disableMfa(USER_ID, code);

      expect(prisma.__tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            mfaEnabled: false,
            mfaSecret: null,
            mfaSecretIv: null,
            mfaBackupCodes: null,
          },
        }),
      );
    });

    it('accepts a valid unused backup code as an alternative to the OTP', async () => {
      const rawCode = 'ABCDEFGHIJ';
      const hash = await bcrypt.hash(rawCode, 10);
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
        mfaSecret: null,
        mfaSecretIv: null,
        mfaBackupCodes: [{ hash, usedAt: null }],
      });

      await service.disableMfa(USER_ID, rawCode);

      expect(prisma.__tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mfaEnabled: false }),
        }),
      );
    });
  });

  // ── generateBackupCodes ───────────────────────────────────────────────────

  describe('generateBackupCodes', () => {
    it('throws BadRequestException when MFA is not enabled', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: false,
      });
      await expect(service.generateBackupCodes(USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 8 formatted backup codes and stores their hashes', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
      });

      const codes = await service.generateBackupCodes(USER_ID);

      expect(codes).toHaveLength(8);
      expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
      const stored =
        prisma.__tx.user.update.mock.calls[0][0].data.mfaBackupCodes;
      expect(stored).toHaveLength(8);
      // stored hashes must not equal the plaintext codes
      expect(stored[0].hash).not.toBe(codes[0]);
    });
  });

  // ── issueMfaToken / verifyMfaToken ────────────────────────────────────────

  describe('issueMfaToken / verifyMfaToken', () => {
    it('issues a token that verifies back to the same userId/tenantId', async () => {
      const token = await service.issueMfaToken(USER_ID, TENANT_ID);
      const result = await service.verifyMfaToken(token);
      expect(result).toEqual({ userId: USER_ID, tenantId: TENANT_ID });
    });

    it('rejects a token that is not marked isMfaToken', async () => {
      const bogusToken = jwt.sign(
        { sub: USER_ID, tenantId: TENANT_ID },
        MFA_CHALLENGE_SECRET,
        { expiresIn: '5m' },
      );
      await expect(service.verifyMfaToken(bogusToken)).rejects.toThrow(
        'MFA token is invalid or has expired',
      );
    });

    it('rejects an expired MFA token', async () => {
      const expired = jwt.sign(
        { sub: USER_ID, tenantId: TENANT_ID, isMfaToken: true },
        MFA_CHALLENGE_SECRET,
        { expiresIn: -10 },
      );
      await expect(service.verifyMfaToken(expired)).rejects.toThrow(
        'MFA token is invalid or has expired',
      );
    });
  });

  // ── verifyCode ────────────────────────────────────────────────────────────

  describe('verifyCode', () => {
    it('returns false when MFA is not enabled for the user', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: false,
      });
      const result = await service.verifyCode(USER_ID, '123456');
      expect(result).toBe(false);
    });

    it('returns true for a valid current TOTP code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
        mfaSecret: Buffer.from(secret, 'utf8'),
        mfaSecretIv: Buffer.from('iv'),
        mfaBackupCodes: [],
      });
      const result = await service.verifyCode(USER_ID, totpFor(secret));
      expect(result).toBe(true);
    });
  });

  // ── getMfaStatus ──────────────────────────────────────────────────────────

  describe('getMfaStatus', () => {
    it('reports remaining (unused) backup codes only', async () => {
      prisma.__tx.user.findUnique.mockResolvedValue({
        id: USER_ID,
        mfaEnabled: true,
        mfaBackupCodes: [
          { usedAt: null },
          { usedAt: '2026-01-01T00:00:00.000Z' },
          { usedAt: null },
        ],
      });
      const status = await service.getMfaStatus(USER_ID);
      expect(status).toEqual({
        mfaEnabled: true,
        hasBackupCodes: true,
        backupCodesRemaining: 2,
      });
    });
  });
});
