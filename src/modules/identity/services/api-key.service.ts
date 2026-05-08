import {
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { CreateApiKeyRequest, CreateApiKeyResponse, Environment } from "../../../../packages/types/identity";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";

const BCRYPT_ROUNDS = 12;
const KEY_PREFIX_LENGTH = 16;
const KEY_TOTAL_LENGTH = 48;
const PREFIX_LIVE = "blx_live_";
const PREFIX_TEST = "blx_test_";

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createApiKey(
    tenantId: string,
    request: CreateApiKeyRequest,
  ): Promise<CreateApiKeyResponse> {
    const { name, environment, expiresAt } = request;

    const rawRandom = crypto.randomBytes(KEY_TOTAL_LENGTH).toString("base64url");
    const prefix = environment === "PRODUCTION" ? PREFIX_LIVE : PREFIX_TEST;
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
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });
    });

    this.logger.log(`API key created for tenant ${tenantId} [${name}]`);

    return {
      id: record.id,
      key: fullKey,
      keyPrefix,
      name: record.name,
      environment: record.environment as Environment,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async verifyApiKey(rawKey: string): Promise<{
    tenantId: string;
    keyId: string;
    environment: Environment;
  }> {
    if (!rawKey || rawKey.length < 20) {
      throw new UnauthorizedException("Invalid API key format");
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
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
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
      throw new UnauthorizedException("Invalid or expired API key");
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
      throw new UnauthorizedException("Invalid API key");
    }

    if (!matched.tenant.isActive) {
      throw new UnauthorizedException("Tenant account is suspended");
    }

    this.updateLastUsed(matched.id).catch((err) =>
      this.logger.error(`Failed to update lastUsedAt for key ${matched!.id}: ${err.message}`),
    );

    return {
      tenantId: matched.tenantId,
      keyId: matched.id,
      environment: matched.environment as Environment,
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
      throw new ConflictException("API key is already revoked");
    }

    await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.update({
        where: { id: keyId },
        data: { isRevoked: true },
      });
    });

    this.logger.log(`API key ${keyId} revoked for tenant ${tenantId}`);
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
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  private async updateLastUsed(keyId: string): Promise<void> {
    await this.prisma.asAdmin(async (tx) => {
      return tx.apiKey.update({
        where: { id: keyId },
        data: { lastUsedAt: new Date() },
      });
    });
  }
}