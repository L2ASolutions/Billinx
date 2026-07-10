import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // apps/web has its own package-lock.json alongside the repo root's, which
  // makes Turbopack's root inference ambiguous — pin it explicitly.
  turbopack: {
    root: __dirname,
  },

  // The /v1/:path* rewrite is kept only for backward-compat (e.g. direct curl
  // calls to localhost:3001/v1/...).  All in-app fetch calls go through the
  // explicit proxy at /api/[...path]/route.ts which forwards every header
  // (including Authorization) reliably.
  async rewrites() {
    const apiUrl =
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:3000';
    return [
      {
        source: '/v1/:path*',
        destination: `${apiUrl}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
