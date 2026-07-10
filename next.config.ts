import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes is intentionally disabled: it requires a build to refresh
  // route types, which breaks the typecheck → build CI ordering on new pages.
  // Revisit when Next.js makes type generation deterministic in `tsc --noEmit`.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

// Source-map upload runs only when SENTRY_AUTH_TOKEN is present (CI/prod);
// locally the build still works, it just skips the upload. Build-secret keys
// are omitted (not set to undefined) so they never appear unset.
const sentryBuildOptions = {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  telemetry: false,
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
