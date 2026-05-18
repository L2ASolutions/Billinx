const SENSITIVE_KEYS = new Set([
  'password',
  'apikey',
  'api_key',
  'secret',
  'token',
  'authorization',
  'x-api-key',
  'x-api-secret',
  'x-admin-key',
  'privatekey',
  'private_key',
  'credential',
  'mastersecret',
  'master_key',
  'refreshtoken',
  'refresh_token',
]);

export function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitize(item, depth + 1));
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.has(k.toLowerCase())
        ? '[REDACTED]'
        : sanitize(v, depth + 1),
    ]),
  );
}
