import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

interface SecretsCache {
  value: string;
  fetchedAt: number;
}

@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, SecretsCache>();
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor() {
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? "af-south-1",
    });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("SecretsService initialised — using local fallback for development");
  }

  async getSecret(secretId: string): Promise<string> {
    const cached = this.cache.get(secretId);
    if (cached && Date.now() - cached.fetchedAt < this.TTL_MS) {
      return cached.value;
    }

    // In development, return fallback values instead of calling AWS
    if (process.env.NODE_ENV === "development") {
      return this.getDevFallback(secretId);
    }

    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await this.client.send(command);

    const value = response.SecretString ?? "";
    this.cache.set(secretId, { value, fetchedAt: Date.now() });
    return value;
  }

  private getDevFallback(secretId: string): string {
    const fallbacks: Record<string, string> = {
      "billinx/jwt/private-key": `-----BEGIN RSA PRIVATE KEY-----
***REDACTED-RSA-PLACEHOLDER***
-----END RSA PRIVATE KEY-----`,
      "billinx/jwt/public-key": `-----BEGIN PUBLIC KEY-----
***REDACTED-RSA-PLACEHOLDER***
-----END PUBLIC KEY-----`,
      "billinx/encryption/master-key": "0".repeat(64),
      "billinx/admin/key-hash": "$2b$10$placeholder",
    };

    return fallbacks[secretId] ?? "dev-fallback-secret";
  }

  async getJwtPrivateKey(): Promise<string> {
    return this.getSecret(
      process.env.JWT_PRIVATE_KEY_SECRET_ID ?? "billinx/jwt/private-key",
    );
  }

  async getJwtPublicKey(): Promise<string> {
    return this.getSecret(
      process.env.JWT_PUBLIC_KEY_SECRET_ID ?? "billinx/jwt/public-key",
    );
  }

  async getMasterEncryptionKey(): Promise<Buffer> {
    const hex = await this.getSecret(
      process.env.MASTER_KEY_SECRET_ID ?? "billinx/encryption/master-key",
    );
    return Buffer.from(hex.padEnd(64, "0").substring(0, 64), "hex");
  }

  async getAdminKeyHash(): Promise<string> {
    return this.getSecret(
      process.env.ADMIN_KEY_SECRET_ID ?? "billinx/admin/key-hash",
    );
  }
}