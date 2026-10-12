import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // typedRoutes is intentionally disabled: it requires a build to refresh
  // route types, which breaks the typecheck → build CI ordering on new pages.
  // Revisit when Next.js makes type generation deterministic in `tsc --noEmit`.
  // The short-lived phone shell at /m (ADR 0018, superseded by 0019) — send
  // saved bookmarks to the console rather than a 404.
  async redirects() {
    return [{ source: '/m/:path*', destination: '/dashboard', permanent: false }];
  },
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

export default nextConfig;
