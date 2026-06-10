import type { RedisOptions } from 'ioredis';

function parseRedisUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const options: RedisOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
  if (parsed.password) {
    options.password = decodeURIComponent(parsed.password);
  }
  if (parsed.username) {
    options.username = decodeURIComponent(parsed.username);
  }
  if (parsed.protocol === 'rediss:') {
    // AWS ElastiCache with self-signed certs in some regions requires rejectUnauthorized: false.
    // Only set it when explicitly opted in — leaving TLS strict by default is safer.
    options.tls =
      process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false'
        ? { rejectUnauthorized: false }
        : {};
  }
  return options;
}

export function buildRedisConnectionOptions(): RedisOptions {
  const url = process.env.REDIS_URL;
  if (url) {
    return parseRedisUrl(url);
  }
  const options: RedisOptions = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  };
  const password = process.env.REDIS_PASSWORD;
  if (password) {
    options.password = password;
  }
  return options;
}
