import { env } from '@/lib/env';
import { db } from '@/server/composition';
import { handleResendWebhook } from '@/server/services/resend-webhook';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resend (Svix) delivery webhook. Verifies the signature and applies the
 * delivery outcome to the matching exec notification. Returns 503 when no
 * signing secret is configured, 401 on a bad/stale signature, 200 otherwise
 * (including ignored events — webhooks must be acked or the provider retries).
 *
 * The raw body must be read verbatim for signature verification — do not parse
 * before verifying.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = await handleResendWebhook(
    { db: db(), secret: env().RESEND_WEBHOOK_SECRET ?? '', now: new Date() },
    {
      svixId: request.headers.get('svix-id'),
      svixTimestamp: request.headers.get('svix-timestamp'),
      svixSignature: request.headers.get('svix-signature'),
    },
    rawBody,
  );
  return new NextResponse(result.body, { status: result.status });
}
