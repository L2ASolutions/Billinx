import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_SIGNED_URL_TTL_SECS = 15 * 60; // 15 minutes

// Screenshots may contain sensitive tenant financial data, so this bucket
// must always be private (Block Public Access on, no bucket policy granting
// public reads — see infra/modules/s3-support-tickets). Objects are never
// served by a permanent URL, only via getSignedViewUrl() below.
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly enabled: boolean;

  constructor() {
    this.bucket =
      process.env.SUPPORT_TICKETS_S3_BUCKET ?? 'billinx-support-tickets';
    // Mirrors EmailService's dev-safe pattern: without explicit AWS
    // credentials (local/dev, no S3 bucket provisioned yet) uploads are
    // skipped rather than throwing, so the error-reporting flow — whose
    // whole purpose is to survive things going wrong — never itself breaks
    // ticket creation in an environment with no S3 access configured.
    this.enabled = !!(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );

    this.client = new S3Client({
      region: process.env.AWS_REGION ?? 'af-south-1',
      ...(this.enabled
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
          }
        : {}),
    });
  }

  async uploadPrivateObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(
        `[S3 upload skipped — no AWS credentials] key=${key} size=${body.length}b`,
      );
      return;
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // No ACL — the bucket enforces Block Public Access; objects are
          // private by default and reachable only via a signed URL.
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to upload S3 object "${key}": ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async getSignedViewUrl(
    key: string,
    expiresInSecs: number = DEFAULT_SIGNED_URL_TTL_SECS,
  ): Promise<string | null> {
    if (!this.enabled) return null;

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSecs });
  }
}
