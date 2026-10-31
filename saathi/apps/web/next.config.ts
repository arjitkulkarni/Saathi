import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import { config as loadEnv } from 'dotenv';

// Single .env at the saathi workspace root (shared with worker and tools).
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'), quiet: true });

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Cache Components disabled: organization views are always rendered per request and
  // authority is re-read on every request (docs/decisions.md D-003).
  cacheComponents: false,
  transpilePackages: ['@saathi/contracts', '@saathi/domain', '@saathi/evidence', '@saathi/i18n', '@saathi/db'],
  serverExternalPackages: ['pg', 'better-auth', '@anthropic-ai/sdk', '@aws-sdk/client-s3'],
  poweredByHeader: false,
  turbopack: {
    root: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    rules: { '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' } },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
