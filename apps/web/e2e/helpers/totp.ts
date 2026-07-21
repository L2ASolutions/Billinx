import * as crypto from 'crypto';

// RFC 6238 TOTP, 30s period / SHA1 / 6 digits — deliberately ported
// byte-for-byte from the backend's own totpGenerate()/base32Decode()
// (src/modules/user/services/mfa.service.ts) rather than pulling in a TOTP
// library, so this can never silently drift from what the server actually
// verifies against.
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

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

export function generateTotpCode(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  return totpGenerate(secret, counter);
}
