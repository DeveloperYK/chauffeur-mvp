import { REDACTED, isSensitiveKey } from '@/lib/redaction';

/**
 * Isomorphic Sentry event scrubber (runs in both the Node/edge and browser
 * SDKs). Removes PII and secrets before any event leaves the process, enforcing
 * CLAUDE.md §6 as defence-in-depth on top of `sendDefaultPii: false`.
 *
 * It is intentionally structural and `unknown`-typed rather than depending on
 * Sentry's `Event` types: that keeps it pure, trivially unit-testable, and free
 * of a runtime coupling in the browser bundle. The generic preserves the
 * caller's event type so `beforeSend` stays correctly typed.
 *
 * The function never mutates its input — every level is rebuilt immutably.
 */
export function scrubSentryEvent<T>(event: T): T {
  if (!event || typeof event !== 'object') return event;

  const e = event as Record<string, unknown>;
  const out: Record<string, unknown> = { ...e };

  if (isRecord(e.request)) out.request = scrubRequest(e.request);
  if (isRecord(e.user)) out.user = scrubUser(e.user);
  if (e.extra !== undefined) out.extra = deepRedact(e.extra);
  if (e.contexts !== undefined) out.contexts = deepRedact(e.contexts);
  if (e.tags !== undefined) out.tags = deepRedact(e.tags);
  if (typeof e.transaction === 'string') out.transaction = sanitizeUrl(e.transaction);
  if (Array.isArray(e.breadcrumbs)) out.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb);

  return out as T;
}

function scrubRequest(request: Record<string, unknown>): Record<string, unknown> {
  // Rebuild without `cookies`; cookies always carry the session.
  const { cookies: _cookies, headers, url, query_string, data, ...rest } = request;
  void _cookies;

  const out: Record<string, unknown> = { ...rest };
  if (isRecord(headers)) out.headers = redactByKey(headers);
  if (typeof url === 'string') out.url = sanitizeUrl(url);
  if (typeof query_string === 'string') out.query_string = scrubQueryString(query_string);
  if (data !== undefined) out.data = deepRedact(data);
  return out;
}

/** Sentry's `user` can leak email/username/ip — keep only the opaque id. */
function scrubUser(user: Record<string, unknown>): Record<string, unknown> {
  return user.id !== undefined ? { id: user.id } : {};
}

function scrubBreadcrumb(crumb: unknown): unknown {
  if (!isRecord(crumb)) return crumb;
  const out: Record<string, unknown> = { ...crumb };
  if (typeof crumb.message === 'string') out.message = sanitizeUrl(crumb.message);
  if (crumb.data !== undefined) out.data = deepRedact(crumb.data);
  return out;
}

/** Redact only the values of sensitive-looking keys, one level deep. */
function redactByKey(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return out;
}

/** Recursively redact values under any sensitive key. Immutable. */
function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepRedact);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : deepRedact(inner);
    }
    return out;
  }
  return value;
}

/**
 * Sanitize a URL or transaction string: redact the driver-link JWT in
 * `/j/<token>` paths and the values of sensitive query parameters.
 */
function sanitizeUrl(value: string): string {
  const withoutToken = value.replace(/\/j\/[^/?#\s]+/g, '/j/[token]');
  const [path, query] = splitOnce(withoutToken, '?');
  if (query === undefined) return withoutToken;
  return `${path}?${scrubQueryString(query)}`;
}

/** Redact values of sensitive query parameters, preserving order and keys. */
function scrubQueryString(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const [key] = pair.split('=');
      return key !== undefined && isSensitiveKey(key) ? `${key}=${REDACTED}` : pair;
    })
    .join('&');
}

function splitOnce(value: string, sep: string): [string, string | undefined] {
  const index = value.indexOf(sep);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + sep.length)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
