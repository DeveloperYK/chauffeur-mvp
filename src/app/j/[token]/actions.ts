'use server';

import {
  appUrl,
  db,
  driverLinkSecret,
  notifications,
  spreadsheetMirror,
} from '@/server/composition';
import { submitCompletionForm } from '@/server/services/completion';
import { acceptDispatchLink, declineDispatchLink } from '@/server/services/dispatch';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const acceptSchema = z
  .object({
    token: z.string().min(20).max(4096),
    carForJob: z.enum(['ex', 's_class', 'mpv', 'mini_bus']).optional(),
  })
  .strict();

export async function acceptAction(formData: FormData): Promise<void> {
  const parsed = acceptSchema.safeParse({
    token: String(formData.get('token') ?? ''),
    carForJob: (formData.get('carForJob') as string | null) ?? undefined,
  });
  if (!parsed.success) {
    redirect('/j/_/?error=invalid');
  }

  const result = await acceptDispatchLink(
    parsed.data.carForJob
      ? { token: parsed.data.token, carOverride: parsed.data.carForJob }
      : { token: parsed.data.token },
    {
      db: db(),
      notifications: notifications(),
      secret: driverLinkSecret(),
      appUrl: appUrl(),
      mirror: spreadsheetMirror(),
    },
  );

  if (!result.ok) {
    const msg =
      result.reason === 'token_expired'
        ? 'This link has expired.'
        : result.reason === 'token_consumed'
          ? 'Already accepted.'
          : result.reason === 'wrong_state'
            ? 'This job is no longer open.'
            : 'Sorry, this link is not valid.';
    redirect(`/j/${parsed.data.token}?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/j/${parsed.data.token}?status=accepted`);
}

const declineSchema = z.object({ token: z.string().min(20).max(4096) }).strict();

export async function declineAction(formData: FormData): Promise<void> {
  const parsed = declineSchema.safeParse({ token: String(formData.get('token') ?? '') });
  if (!parsed.success) redirect('/j/_/?error=invalid');
  await declineDispatchLink(parsed.data.token, {
    db: db(),
    notifications: notifications(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });
  redirect(`/j/${parsed.data.token}?status=declined`);
}

export async function submitCompletionAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const carParkPounds = Number.parseFloat(String(formData.get('carParkPounds') ?? '0'));
  const carParkPence = Number.isFinite(carParkPounds) ? Math.round(carParkPounds * 100) : 0;

  const result = await submitCompletionForm(
    {
      token,
      carParkPence,
      waitingTimeMinutes: String(formData.get('waitingTimeMinutes') ?? '0'),
      dropoffAt: String(formData.get('dropoffAt') ?? ''),
    },
    {
      db: db(),
      secret: driverLinkSecret(),
      appUrl: appUrl(),
      mirror: spreadsheetMirror(),
    },
  );

  if (!result.ok) {
    const msg =
      result.reason === 'validation'
        ? 'Please check your inputs.'
        : result.reason === 'token_expired'
          ? 'This link has expired.'
          : result.reason === 'token_consumed'
            ? 'Already submitted.'
            : result.reason === 'wrong_state'
              ? 'This form is no longer open.'
              : 'Sorry, this link is not valid.';
    redirect(`/j/${token}?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/j/${token}?status=submitted`);
}
