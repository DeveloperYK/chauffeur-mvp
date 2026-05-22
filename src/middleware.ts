import { type NextRequest, NextResponse } from 'next/server';

/**
 * Content-Security-Policy for the operator console.
 *
 * Why middleware and not a static header in next.config.ts: the App Router
 * emits inline bootstrap/RSC <script> tags, so a `script-src 'self'` policy
 * would block hydration. The correct fix is a per-request nonce — Next.js
 * reads the nonce from the CSP on the *request* headers and stamps it onto
 * every script it renders. `'strict-dynamic'` then lets those nonced scripts
 * load the chunked bundles.
 *
 * `style-src` keeps `'unsafe-inline'` deliberately: nonces do not apply to
 * inline `style=` attributes, and the avatar component sets per-operator
 * colours that way. Inline styles cannot execute code, so the residual risk
 * is low. See docs/adr/0004-content-security-policy.md.
 *
 * Google Fonts (googleapis.com stylesheet + gstatic.com font files) are
 * explicitly allowlisted because layout.tsx loads them.
 *
 * In development we drop the nonce and allow `'unsafe-eval'`/`'unsafe-inline'`
 * so Next.js HMR and the error overlay keep working.
 */
function buildCsp(nonce: string, isProd: boolean): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "'self' 'unsafe-eval' 'unsafe-inline'";

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  // Only upgrade in production; on http://localhost it would break dev assets.
  if (isProd) directives.push('upgrade-insecure-requests');

  return directives.join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const isProd = process.env.NODE_ENV === 'production';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, isProd);

  // Propagate the nonce + CSP on the request so Next.js can stamp scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Apply to documents only. Skip API routes (JSON, no CSP needed and the
  // clock-tick endpoint must stay cache/edge-neutral), Next internals, and
  // static asset/metadata files.
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
    },
  ],
};
