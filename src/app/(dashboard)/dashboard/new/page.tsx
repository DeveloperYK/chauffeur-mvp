import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The standalone "New booking" page has been consolidated into the board's
 * create slide-over (the single, richer create surface — Service toggle,
 * one-click Generate, private notes). This route now redirects there so old
 * links and bookmarks keep working without a second, divergent form.
 */
export default function NewBookingPage() {
  redirect('/dashboard?new=1');
}
