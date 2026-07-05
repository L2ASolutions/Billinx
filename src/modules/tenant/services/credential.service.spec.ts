/// <reference types="jest" />

import * as crypto from 'crypto';
import { CredentialService } from './credential.service';

describe('CredentialService', () => {
  let service: CredentialService;
  const masterKey = crypto.randomBytes(32);

  beforeEach(() => {
    service = new CredentialService();
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext through encrypt then decrypt', () => {
      const { encrypted, iv } = service.encrypt(
        'super-secret-value',
        masterKey,
        'tenant-001',
      );

      const decrypted = service.decrypt(encrypted, iv, masterKey, 'tenant-001');
      expect(decrypted).toBe('super-secret-value');
    });

    it('produces a different ciphertext and IV on every call (random IV)', () => {
      const first = service.encrypt('same-plaintext', masterKey, 'tenant-001');
      const second = service.encrypt('same-plaintext', masterKey, 'tenant-001');

      expect(first.iv.equals(second.iv)).toBe(false);
      expect(first.encrypted.equals(second.encrypted)).toBe(false);
    });

    it('fails to decrypt when the tenantId differs (key derivation is tenant-scoped)', () => {
      const { encrypted, iv } = service.encrypt(
        'secret',
        masterKey,
        'tenant-001',
      );

      expect(() =>
        service.decrypt(encrypted, iv, masterKey, 'tenant-002'),
      ).toThrow();
    });

    it('fails to decrypt when the master key differs', () => {
      const { encrypted, iv } = service.encrypt(
        'secret',
        masterKey,
        'tenant-001',
      );
      const otherKey = crypto.randomBytes(32);

      expect(() =>
        service.decrypt(encrypted, iv, otherKey, 'tenant-001'),
      ).toThrow();
    });

    it('fails to decrypt (auth tag mismatch) when the ciphertext has been tampered with', () => {
      const { encrypted, iv } = service.encrypt(
        'secret',
        masterKey,
        'tenant-001',
      );
      const tampered = Buffer.from(encrypted);
      tampered[0] ^= 0xff;

      expect(() =>
        service.decrypt(tampered, iv, masterKey, 'tenant-001'),
      ).toThrow();
    });
  });

  describe('encryptCredential / decryptCredential', () => {
    it('round-trips an object through JSON serialization', () => {
      const credential = { apiKey: 'abc123', clientId: 'client-1' };
      const { encrypted, iv } = service.encryptCredential(
        credential,
        masterKey,
        'tenant-001',
      );

      const decrypted = service.decryptCredential(
        encrypted,
        iv,
        masterKey,
        'tenant-001',
      );
      expect(decrypted).toEqual(credential);
    });
  });
});
