import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // apps/marketing has its own package-lock.json alongside the repo root's
  // and apps/web's, which makes Turbopack's root inference ambiguous — pin
  // it explicitly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
