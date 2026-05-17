import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name);

  private deriveKey(masterKey: Buffer, tenantId: string): Buffer {
    return crypto
      .createHmac('sha256', masterKey)
      .update(tenantId)
      .digest()
      .slice(0, KEY_LENGTH);
  }

  encrypt(
    plaintext: string,
    masterKey: Buffer,
    tenantId: string,
  ): { encrypted: Buffer; iv: Buffer } {
    const key = this.deriveKey(masterKey, tenantId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    return { encrypted, iv };
  }

  decrypt(
    encryptedBuffer: Buffer,
    iv: Buffer,
    masterKey: Buffer,
    tenantId: string,
  ): string {
    const key = this.deriveKey(masterKey, tenantId);

    const authTag = encryptedBuffer.slice(
      encryptedBuffer.length - AUTH_TAG_LENGTH,
    );
    const ciphertext = encryptedBuffer.slice(
      0,
      encryptedBuffer.length - AUTH_TAG_LENGTH,
    );

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(ciphertext) + decipher.final('utf8');
  }

  encryptCredential(
    credential: Record<string, unknown>,
    masterKey: Buffer,
    tenantId: string,
  ): { encrypted: Buffer; iv: Buffer } {
    const plaintext = JSON.stringify(credential);
    return this.encrypt(plaintext, masterKey, tenantId);
  }

  decryptCredential(
    encryptedBuffer: Buffer,
    iv: Buffer,
    masterKey: Buffer,
    tenantId: string,
  ): Record<string, unknown> {
    const plaintext = this.decrypt(encryptedBuffer, iv, masterKey, tenantId);
    return JSON.parse(plaintext);
  }
}
