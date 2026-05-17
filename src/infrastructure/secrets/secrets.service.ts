import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor() {
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'af-south-1',
      maxAttempts: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.isProduction) {
      this.logger.log(
        'SecretsService ready — fetching secrets from AWS Secrets Manager',
      );
      // Warm the cache for secrets used at startup so the first request is fast
      await this.warmCache();
    } else {
      this.logger.log(
        'SecretsService ready — using environment variable fallbacks (development)',
      );
    }
  }

  // ── Public helpers ────────────────────────────────────────────────────────

  async getJwtPrivateKey(): Promise<string> {
    const secretId =
      process.env.JWT_PRIVATE_KEY_SECRET_ID ??
      'billinx/production/jwt-private-key';
    if (!this.isProduction) return this.getDevFallback(secretId);
    return this.getSecret(secretId);
  }

  async getJwtPublicKey(): Promise<string> {
    const secretId =
      process.env.JWT_PUBLIC_KEY_SECRET_ID ??
      'billinx/production/jwt-public-key';
    if (!this.isProduction) return this.getDevFallback(secretId);
    return this.getSecret(secretId);
  }

  async getMasterEncryptionKey(): Promise<Buffer> {
    const secretId =
      process.env.MASTER_KEY_SECRET_ID ?? 'billinx/production/encryption-key';
    const hex = this.isProduction
      ? await this.getSecret(secretId)
      : this.getDevFallback(secretId);
    return Buffer.from(hex.padEnd(64, '0').substring(0, 64), 'hex');
  }

  async getAdminKeyHash(): Promise<string> {
    const secretId =
      process.env.ADMIN_KEY_SECRET_ID ?? 'billinx/production/admin-api-key';
    if (!this.isProduction) return this.getDevFallback(secretId);
    return this.getSecret(secretId);
  }

  // ── Core fetch with cache ─────────────────────────────────────────────────

  async getSecret(secretId: string): Promise<string> {
    const cached = this.cache.get(secretId);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.value;
    }

    if (!this.isProduction) {
      const fallback = this.getDevFallback(secretId);
      this.cache.set(secretId, { value: fallback, fetchedAt: Date.now() });
      return fallback;
    }

    return this.fetchFromAws(secretId);
  }

  // ── AWS fetch with retry ──────────────────────────────────────────────────

  private async fetchFromAws(secretId: string, attempt = 1): Promise<string> {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response = await this.client.send(command);
      const value = response.SecretString ?? '';

      if (!value || value.startsWith('PLACEHOLDER')) {
        this.logger.warn(
          `Secret "${secretId}" contains a placeholder value — update it with update-secrets.sh`,
        );
      }

      this.cache.set(secretId, { value, fetchedAt: Date.now() });
      return value;
    } catch (err) {
      const isThrottling =
        err instanceof SecretsManagerServiceException &&
        (err.name === 'ThrottlingException' || err.$retryable?.throttling);

      if (isThrottling && attempt < 3) {
        const delay = attempt * 500;
        this.logger.warn(
          `Secrets Manager throttled for "${secretId}" — retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.fetchFromAws(secretId, attempt + 1);
      }

      this.logger.error(
        `Failed to fetch secret "${secretId}" from Secrets Manager: ${(err as Error).message}`,
      );
      throw new Error(
        `Could not load required secret "${secretId}": ${(err as Error).message}`,
      );
    }
  }

  // ── Cache warmup ──────────────────────────────────────────────────────────

  private async warmCache(): Promise<void> {
    const criticalSecrets = [
      process.env.MASTER_KEY_SECRET_ID ?? 'billinx/production/encryption-key',
      process.env.ADMIN_KEY_SECRET_ID ?? 'billinx/production/admin-api-key',
      process.env.JWT_PRIVATE_KEY_SECRET_ID ??
        'billinx/production/jwt-private-key',
      process.env.JWT_PUBLIC_KEY_SECRET_ID ??
        'billinx/production/jwt-public-key',
    ];

    const results = await Promise.allSettled(
      criticalSecrets.map((id) => this.fetchFromAws(id)),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      const errors = failures.map((r) =>
        r.status === 'rejected' ? (r.reason?.message ?? 'unknown') : '',
      );
      throw new Error(
        `Failed to load ${failures.length} critical secret(s) on startup: ${errors.join('; ')}`,
      );
    }

    this.logger.log(
      `Warmed ${criticalSecrets.length} secrets from Secrets Manager`,
    );
  }

  // ── Development fallbacks ─────────────────────────────────────────────────

  private getDevFallback(secretId: string): string {
    const devPrivateKey = process.env.JWT_PRIVATE_KEY ?? '';
    const devPublicKey = process.env.JWT_PUBLIC_KEY ?? '';

    if (
      !devPrivateKey &&
      (secretId.includes('jwt-private-key') ||
        secretId.includes('jwt/private-key'))
    ) {
      throw new Error(
        `JWT_PRIVATE_KEY environment variable is required in development. ` +
          `Generate a key pair with: openssl genrsa -out private.key 2048 && openssl rsa -in private.key -pubout -out public.key`,
      );
    }

    const fallbacks: Record<string, string> = {
      'billinx/production/jwt-private-key': devPrivateKey,
      'billinx/production/jwt-public-key': devPublicKey,
      'billinx/production/encryption-key':
        process.env.MASTER_ENCRYPTION_KEY ?? '0'.repeat(64),
      'billinx/production/admin-api-key':
        '$2b$10$devplaceholderhashxxxxxxxxxxxxxxx',
      'billinx/production/admin-key-hash':
        '$2b$10$devplaceholderhashxxxxxxxxxxxxxxx',
      // Legacy secret names (backwards compat)
      'billinx/jwt/private-key': devPrivateKey,
      'billinx/jwt/public-key': devPublicKey,
      'billinx/encryption/master-key':
        process.env.MASTER_ENCRYPTION_KEY ?? '0'.repeat(64),
      'billinx/admin/key-hash': '$2b$10$devplaceholderhashxxxxxxxxxxxxxxx',
    };

    const value = fallbacks[secretId];
    if (value === undefined) {
      this.logger.debug(
        `No dev fallback for secret "${secretId}" — returning placeholder`,
      );
      return 'dev-fallback-secret';
    }
    return value;
  }
}
