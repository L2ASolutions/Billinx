const REQUIRED_VARS: string[] = ['DATABASE_URL'];

const PRODUCTION_REQUIRED_VARS: string[] = [
  'JWT_PRIVATE_KEY_SECRET_ID',
  'JWT_PUBLIC_KEY_SECRET_ID',
  'MASTER_KEY_SECRET_ID',
  'ADMIN_KEY_SECRET_ID',
  'REDIS_URL',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

const DEVELOPMENT_REQUIRED_VARS: string[] = ['JWT_PRIVATE_KEY'];

export function validateEnvironment(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    for (const key of PRODUCTION_REQUIRED_VARS) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  } else {
    for (const key of DEVELOPMENT_REQUIRED_VARS) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  if (missing.length > 0) {
    const list = missing.map((k) => `  - ${k}`).join('\n');
    throw new Error(
      `Missing required environment variables:\n${list}\n\nSee .env.example for all required configuration.`,
    );
  }
}
