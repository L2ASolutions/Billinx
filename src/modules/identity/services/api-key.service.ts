import {
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { EmailService } from '../../../shared/email/email.service';
import { ActivityService } from '../../activity/services/activity.service';
import { getRequestContext } from '../../../shared/context/request-context';
import {
  ApiKeyScope,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  Environment,
  FULL_ACCESS_API_KEY_SCOPES,
} from '../../../../packages/types/identity';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const BCRYPT_ROUNDS = 12;
const KEY_PREFIX_LENGTH = 16;
const KEY_TOTAL_LENGTH = 48;
const PREFIX_LIVE = 'blx_live_';
const PREFIX_TEST = 'blx_test_';
const KEY_FORMAT_RE = /^blx_(live|test)_[A-Za-z0-9_-]{20,}$/;

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly activityService: ActivityService,
  ) {}

  private defaultExpiryDate(): Date | null {
    const days = parseInt(process.env.API_KEY_DEFAULT_EXPIRY_DAYS ?? '365', 10);
    if (!days || days <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  async createApiKey(
    tenantId: string,
    request: CreateApiKeyRequest,
  ): Promise<CreateApiKeyResponse> {
    const { name, environment, expiresAt } = request;
    const scopes: ApiKeyScope[] =
      request.scopes && request.scopes.length > 0
        ? request.scopes
        : FULL_ACCESS_API_KEY_SCOPES;

    const rawRandom = crypto
      .randomBytes(KEY_TOTAL_LENGTH)
      .toString('base64url');
    const prefix = environment === 'PRODUCTION' ? PREFIX_LIVE : PREFIX_TEST;
    const fullKey = `${prefix}${rawRandom}`;
    const keyPrefix = fullKey.substring(0, KEY_PREFIX_LENGTH + prefix.length);
    const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);

    const record = await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.create({
        data: {
          tenantId,
          keyHash,
          keyPrefix,
          environment,
          name,
          scopes,
          expiresAt: expiresAt ? new Date(expiresAt) : this.defaultExpiryDate(),
        },
      });
    });

    this.logger.log(`API key created for tenant ${tenantId} [${name}]`);

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'API_KEY_CREATED',
      actor: ctx.actor,
      entityType: 'ApiKey',
      entityId: record.id,
      payload: { keyName: name, environment, keyPrefix, scopes },
    });

    return {
      id: record.id,
      key: fullKey,
      keyPrefix,
      name: record.name,
      environment: record.environment,
      scopes: record.scopes as ApiKeyScope[],
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async verifyApiKey(
    rawKey: string,
    clientIp?: string,
  ): Promise<{
    tenantId: string;
    keyId: string;
    environment: Environment;
    scopes: ApiKeyScope[];
  }> {
    if (!rawKey || !KEY_FORMAT_RE.test(rawKey)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const prefixLength = rawKey.startsWith(PREFIX_LIVE)
      ? PREFIX_LIVE.length
      : PREFIX_TEST.length;

    const keyPrefix = rawKey.substring(0, KEY_PREFIX_LENGTH + prefixLength);

    const candidates = await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.findMany({
        where: {
          keyPrefix,
          isRevoked: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          tenant: {
            select: {
              id: true,
              environment: true,
              rateLimitTier: true,
              isActive: true,
            },
          },
        },
      });
    });

    if (candidates.length === 0) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    let matched: (typeof candidates)[0] | null = null;
    for (const candidate of candidates) {
      const valid = await bcrypt.compare(rawKey, candidate.keyHash);
      if (valid) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!matched.tenant.isActive) {
      throw new UnauthorizedException('Tenant account is suspended');
    }

    this.updateLastUsed(matched.id, clientIp).catch((err) =>
      this.logger.error(
        `Failed to update usage for key ${matched.id}: ${err.message}`,
      ),
    );

    return {
      tenantId: matched.tenantId,
      keyId: matched.id,
      environment: matched.environment,
      scopes: matched.scopes as ApiKeyScope[],
    };
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<void> {
    const key = await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.findFirst({
        where: { id: keyId, tenantId },
      });
    });

    if (!key) {
      throw new NotFoundException(`API key ${keyId} not found`);
    }

    if (key.isRevoked) {
      throw new ConflictException('API key is already revoked');
    }

    await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.update({
        where: { id: keyId },
        data: { isRevoked: true },
      });
    });

    this.logger.log(`API key ${keyId} revoked for tenant ${tenantId}`);

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'API_KEY_REVOKED',
      actor: ctx.actor,
      entityType: 'ApiKey',
      entityId: keyId,
      payload: { keyId, keyName: key.name },
    });
  }

  async rotateApiKey(
    tenantId: string,
    keyId: string,
  ): Promise<CreateApiKeyResponse> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.findFirst({
        where: { id: keyId, tenantId, isRevoked: false },
      });
    });

    if (!existing) {
      throw new NotFoundException(`API key ${keyId} not found`);
    }

    const rawRandom = crypto
      .randomBytes(KEY_TOTAL_LENGTH)
      .toString('base64url');
    const prefix =
      existing.environment === 'PRODUCTION' ? PREFIX_LIVE : PREFIX_TEST;
    const fullKey = `${prefix}${rawRandom}`;
    const newKeyPrefix = fullKey.substring(
      0,
      KEY_PREFIX_LENGTH + prefix.length,
    );
    const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);

    // 24-hour grace period on old key
    const gracePeriodExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [newRecord] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.apiKey.create({
          data: {
            tenantId,
            keyHash,
            keyPrefix: newKeyPrefix,
            environment: existing.environment,
            name: existing.name,
            scopes: existing.scopes,
            expiresAt: existing.expiresAt,
          },
        }),
        tx.apiKey.update({
          where: { id: keyId },
          data: { expiresAt: gracePeriodExpiry },
        }),
      ]);
    });

    this.logger.log(
      `API key rotated for tenant ${tenantId}: old=${keyId} new=${newRecord.id}`,
    );

    return {
      id: newRecord.id,
      key: fullKey,
      keyPrefix: newKeyPrefix,
      name: newRecord.name,
      environment: newRecord.environment,
      scopes: newRecord.scopes as ApiKeyScope[],
      expiresAt: newRecord.expiresAt?.toISOString() ?? null,
      createdAt: newRecord.createdAt.toISOString(),
    };
  }

  async listApiKeys(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.findMany({
        where: { tenantId, isRevoked: false },
        select: {
          id: true,
          keyPrefix: true,
          name: true,
          environment: true,
          scopes: true,
          lastUsedAt: true,
          lastUsedIp: true,
          requestCount: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  @Cron('0 9 * * *', { name: 'api-key-expiry-check' })
  async checkExpiringKeys(): Promise<void> {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in1Day = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiringKeys = await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.findMany({
        where: {
          isRevoked: false,
          expiresAt: { gte: now, lte: in7Days },
        },
        include: {
          tenant: {
            include: {
              users: {
                include: { roles: true },
                where: { isActive: true },
              },
            },
          },
        },
      });
    });

    for (const key of expiringKeys) {
      const expiresAt = key.expiresAt!;
      const daysLeft = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const isUrgent = expiresAt <= in1Day;

      const ownerRoles = (key.tenant as any).users?.filter((u: any) =>
        u.roles?.some((r: any) => r.role === 'OWNER'),
      );

      for (const owner of ownerRoles ?? []) {
        this.emailService.sendApiKeyExpiryWarning({
          to: owner.email,
          firstName: owner.firstName,
          tenantName: key.tenant.name,
          keyName: key.name,
          keyPrefix: key.keyPrefix,
          daysLeft,
          isUrgent,
          expiresAt: expiresAt.toISOString(),
        });
      }
    }

    if (expiringKeys.length > 0) {
      this.logger.log(
        `API key expiry check: ${expiringKeys.length} keys expiring within 7 days`,
      );
    }
  }

  private async updateLastUsed(
    keyId: string,
    clientIp?: string,
  ): Promise<void> {
    await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.update({
        where: { id: keyId },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: clientIp ?? null,
          requestCount: { increment: 1 },
        },
      });
    });
  }
}
