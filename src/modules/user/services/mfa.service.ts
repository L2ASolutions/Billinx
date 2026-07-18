import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as qrcode from 'qrcode';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { SecretsService } from '../../../infrastructure/secrets/secrets.service';
import { CredentialService } from '../../tenant/services/credential.service';

// ─── RFC 6238 TOTP (compatible with Google Authenticator & Authy) ─────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of buf) {
    bits += 8;
    value = (value << 8) | byte;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(s: string): Buffer {
  const str = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const result: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of str) {
    const idx = BASE32_CHARS.indexOf(ch);
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

function totpGenerate(secret: string, counter: number): string {
  const key = base32Decode(secret);
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

function totpVerify(token: string, secret: string, tolerance = 1): boolean {
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -tolerance; w <= tolerance; w++) {
    if (
      crypto.timingSafeEqual(
        Buffer.from(totpGenerate(secret, counter + w)),
        Buffer.from(token.padStart(6, '0')),
      )
    )
      return true;
  }
  return false;
}

function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20)); // 160 bits — RFC 4226 recommended
}

function buildOtpauthUri(
  email: string,
  issuer: string,
  secret: string,
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MFA_ISSUER = process.env.MFA_ISSUER ?? 'Billinx';
const BACKUP_CODE_COUNT = 8;
const MFA_TOKEN_TTL = 5 * 60; // seconds

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private cachedMasterKey: Buffer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly credentialService: CredentialService,
  ) {}

  // ─── Setup ─────────────────────────────────────────────────────────────────

  async setupMfa(
    userId: string,
    email: string,
  ): Promise<{ qrCodeBase64: string; manualKey: string }> {
    const plainSecret = generateTotpSecret();

    const masterKey = await this.getMasterKey();
    const { encrypted, iv } = this.credentialService.encrypt(
      plainSecret,
      masterKey,
      userId,
    );

    await this.writeMfa(userId, {
      mfaSecret: encrypted,
      mfaSecretIv: iv,
      mfaEnabled: false,
    });

    const uri = buildOtpauthUri(email, MFA_ISSUER, plainSecret);
    const qrCodeBase64 = await qrcode.toDataURL(uri, { width: 256, margin: 2 });

    this.logger.log(`MFA setup initiated for user ${userId}`);
    return { qrCodeBase64, manualKey: plainSecret };
  }

  // ─── Enable (confirm first OTP) ────────────────────────────────────────────

  async verifySetupAndEnable(userId: string, code: string): Promise<void> {
    const user = await this.loadUser(userId);
    if (!(user as any)?.mfaSecret || !(user as any)?.mfaSecretIv) {
      throw new BadRequestException(
        'MFA setup not started. Call POST /v1/auth/mfa/setup first.',
      );
    }
    if ((user as any).mfaEnabled) {
      throw new BadRequestException('MFA is already enabled on this account.');
    }

    const secret = this.decryptSecret(user);
    if (!secret)
      throw new BadRequestException(
        'Could not read MFA secret. Please restart setup.',
      );

    if (!totpVerify(code.replace(/\s/g, ''), secret)) {
      throw new BadRequestException(
        'Invalid OTP code. Make sure your authenticator clock is correct.',
      );
    }

    await this.writeMfa(userId, { mfaEnabled: true });
    this.logger.log(`MFA enabled for user ${userId}`);
  }

  // ─── Disable ───────────────────────────────────────────────────────────────

  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.loadUser(userId);
    if (!(user as any)?.mfaEnabled) {
      throw new BadRequestException('MFA is not enabled on this account.');
    }

    if (!(await this.checkCode(code, user))) {
      throw new UnauthorizedException('Invalid OTP code or backup code.');
    }

    await this.writeMfa(userId, {
      mfaEnabled: false,
      mfaSecret: null,
      mfaSecretIv: null,
      mfaBackupCodes: null,
    });
    this.logger.log(`MFA disabled for user ${userId}`);
  }

  // ─── Backup codes ──────────────────────────────────────────────────────────

  async generateBackupCodes(userId: string): Promise<string[]> {
    const user = await this.loadUser(userId);
    if (!(user as any)?.mfaEnabled) {
      throw new BadRequestException(
        'Enable MFA before generating backup codes.',
      );
    }

    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase(),
    );

    const storedCodes = await Promise.all(
      rawCodes.map(async (code) => ({
        hash: await bcrypt.hash(code, 10),
        usedAt: null as string | null,
      })),
    );

    await this.writeMfa(userId, { mfaBackupCodes: storedCodes });
    this.logger.log(`Backup codes regenerated for user ${userId}`);

    return rawCodes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
  }

  // ─── MFA challenge JWT ─────────────────────────────────────────────────────

  async issueMfaToken(userId: string, tenantId: string): Promise<string> {
    const secret = await this.getMfaChallengeSecret();
    return jwt.sign({ sub: userId, tenantId, isMfaToken: true }, secret, {
      expiresIn: MFA_TOKEN_TTL,
    });
  }

  async verifyMfaToken(
    token: string,
  ): Promise<{ userId: string; tenantId: string }> {
    const secret = await this.getMfaChallengeSecret();
    try {
      const payload = jwt.verify(token, secret) as any;
      if (!payload?.isMfaToken) throw new Error();
      return {
        userId: payload.sub as string,
        tenantId: payload.tenantId as string,
      };
    } catch {
      throw new UnauthorizedException('MFA token is invalid or has expired.');
    }
  }

  // ─── Verify code (for challenge step) ─────────────────────────────────────

  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.loadUser(userId);
    if (!(user as any)?.mfaEnabled) return false;
    return this.checkCode(code, user);
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getMfaStatus(userId: string): Promise<{
    mfaEnabled: boolean;
    hasBackupCodes: boolean;
    backupCodesRemaining: number;
  }> {
    const user = await this.loadUser(userId);
    const stored: Array<{ usedAt: string | null }> =
      (user as any)?.mfaBackupCodes ?? [];
    const remaining = stored.filter((c) => !c.usedAt).length;
    return {
      mfaEnabled: (user as any)?.mfaEnabled ?? false,
      hasBackupCodes: remaining > 0,
      backupCodesRemaining: remaining,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async checkCode(code: string, user: any): Promise<boolean> {
    const normalised = code.replace(/[\s-]/g, '').toUpperCase();

    const secret = this.decryptSecret(user);
    if (secret && totpVerify(normalised, secret)) return true;

    return this.consumeBackupCode(user.id, normalised, user);
  }

  private async consumeBackupCode(
    userId: string,
    code: string,
    user: any,
  ): Promise<boolean> {
    const stored: Array<{ hash: string; usedAt: string | null }> =
      user.mfaBackupCodes ?? [];

    for (let i = 0; i < stored.length; i++) {
      if (stored[i].usedAt) continue;
      if (await bcrypt.compare(code, stored[i].hash)) {
        stored[i] = { ...stored[i], usedAt: new Date().toISOString() };
        await this.writeMfa(userId, { mfaBackupCodes: stored });
        this.logger.log(`Backup code consumed for user ${userId}`);
        return true;
      }
    }

    return false;
  }

  private decryptSecret(user: any): string | null {
    if (!user?.mfaSecret || !user?.mfaSecretIv || !this.cachedMasterKey)
      return null;
    try {
      return this.credentialService.decrypt(
        Buffer.from(user.mfaSecret),
        Buffer.from(user.mfaSecretIv),
        this.cachedMasterKey,
        user.id,
      );
    } catch {
      return null;
    }
  }

  private async getMasterKey(): Promise<Buffer> {
    if (!this.cachedMasterKey) {
      this.cachedMasterKey = await this.secrets.getMasterEncryptionKey();
    }
    return this.cachedMasterKey;
  }

  private async loadUser(userId: string) {
    await this.getMasterKey(); // warm cache for decryptSecret
    return this.prisma.asAdmin(async (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
  }

  private async writeMfa(
    userId: string,
    data: {
      mfaEnabled?: boolean;
      mfaSecret?: Buffer | null;
      mfaSecretIv?: Buffer | null;
      mfaBackupCodes?: any;
    },
  ): Promise<void> {
    await this.prisma.asAdmin(async (tx) =>
      tx.user.update({ where: { id: userId }, data: data as any }),
    );
  }

  private async getMfaChallengeSecret(): Promise<string> {
    const key = await this.secrets.getMasterEncryptionKey();
    return crypto
      .createHmac('sha256', key)
      .update('mfa-challenge')
      .digest('hex');
  }
}
