/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint is run separately in CI (pr-checks.yml). Skipping here avoids a
  // circular-plugin JSON error from the eslint-config-next peer resolution
  // and keeps production builds fast.
  eslint: { ignoreDuringBuilds: true },

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
