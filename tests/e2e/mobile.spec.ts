import { type Page, expect, test } from '@playwright/test';

/**
 * The mobile shell (/m) on a phone — iPhone 13 project (UA + viewport), so the
 * middleware's phone → shell redirect is exercised for real.
 *
 * Covers the user's must-haves from the phone: see the day and what needs
 * attention, create a booking, dispatch (confirmed by phone), edit, cancel
 * with undo, approve a completed job, and switch to / from the full console.
 *
 * Runs against a RUNNING dev server (auth bypassed outside production):
 *
 *   pnpm test:e2e:mobile           # needs `pnpm dev` on :3000 (or E2E_BASE_URL)
 *
 * WARNING: resets + seeds the simulator data, like lifecycle.spec.ts.
 */

const LEGO = 'Eric French'; // dispatch → approve
const MERC = 'Martin Finch'; // cancel → undo
const JJ = 'Sophia Lefevre'; // edit

test.describe.configure({ mode: 'serial' });

async function gotoSimulator(page: Page) {
  // Desk-only page: a phone is NOT redirected away from it (by design).
  await page.goto('/dashboard/simulator', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/dashboard\/simulator/);
  await expect(page.getByRole('heading', { name: 'Simulator' })).toBeVisible();
}

function row(page: Page, passenger: string) {
  return page.locator('tr', { has: page.getByRole('link', { name: passenger }) });
}

async function clickAndSettle(page: Page, click: Promise<void>) {
  await Promise.all([page.waitForURL(/\/dashboard\/simulator\?ok=/), click]);
}

async function bookingIdOf(page: Page, passenger: string): Promise<string> {
  await gotoSimulator(page);
  const href = await row(page, passenger)
    .getByRole('link', { name: passenger })
    .getAttribute('href');
  const id = href?.split('/').pop() ?? '';
  expect(id, `expected a booking link for ${passenger}`).toBeTruthy();
  return id;
}

async function openMobileBooking(page: Page, passenger: string) {
  const id = await bookingIdOf(page, passenger);
  await page.goto(`/m/b/${id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.m-hero')).toContainText(passenger);
}

const hero = (page: Page) => page.locator('.m-hero');
const actions = (page: Page) => page.locator('.m-actions');
const sheet = (page: Page) => page.locator('.modal.is-open');

test('a phone is routed to the shell, sees the day and what needs attention', async ({ page }) => {
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  // The board URL on a phone lands on the shell.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/m$/);
  await expect(page.getByRole('link', { name: 'New booking' })).toBeVisible();

  // The cross-day attention list carries the three seeded unassigned bookings.
  await page.getByRole('link', { name: /Needs attention/ }).click();
  await expect(page).toHaveURL(/\/m\?view=attention/);
  for (const name of [LEGO, MERC, JJ]) {
    await expect(page.locator('.m-card', { hasText: name })).toContainText('Needs a driver');
  }

  // Deep links from the board map onto the shell's booking screen.
  const id = await bookingIdOf(page, LEGO);
  await page.goto(`/dashboard/bookings/${id}`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`/m/b/${id}$`));
  await expect(hero(page)).toContainText(LEGO);
  await expect(hero(page)).toContainText('Needs a driver');
});

test('create a booking from the phone', async ({ page }) => {
  await page.goto('/m/new', { waitUntil: 'networkidle' });
  const modal = sheet(page);
  await expect(modal.locator('.modal__title')).toHaveText('Create booking');

  await modal.locator('input[aria-label="Pickup address"]').fill('1 Test Street, London SW1A 1AA');
  await modal.locator('input[aria-label="Dropoff address"]').fill('2 Sample Road, London W1K 2AL');
  await modal.locator('.field', { hasText: 'Passenger' }).locator('input').first().fill('Phone');
  await modal.locator('.field', { hasText: 'Passenger' }).locator('input').nth(1).fill('Booker');
  await modal
    .locator('.field', { hasText: 'Exec email' })
    .locator('input')
    .fill('phone@example.com');
  await modal.locator('.field', { hasText: 'Contract price' }).locator('input').fill('120');
  await modal.getByRole('button', { name: 'Create booking' }).click();

  // Lands on the booking's day with a toast; the new booking needs a driver.
  await expect(page).toHaveURL(/\/m\?date=\d{4}-\d{2}-\d{2}&created=1/);
  await expect(page.locator('.toast')).toContainText('Booking created');
  const card = page.locator('.m-card', { hasText: 'Phone Booker' });
  await expect(card).toContainText('Needs a driver');
  await card.click();
  await expect(hero(page)).toContainText('Phone Booker');
  await expect(hero(page)).toContainText('UNASSIGNED');
});

test('dispatch: assign a driver confirmed by phone, then message them', async ({ page }) => {
  await openMobileBooking(page, LEGO);
  await actions(page).getByRole('button', { name: 'Find a driver' }).click();
  const modal = sheet(page);
  await expect(modal).toContainText('Find drivers');
  await modal.locator('.driver-row:not(.is-busy)').first().click();
  await modal.getByRole('button', { name: 'Confirmed by phone' }).click();
  await expect(page.locator('.toast')).toContainText(/confirmed by phone/i);

  await expect(hero(page)).toContainText('ASSIGNED');
  // The primary action now hands straight to the WhatsApp app.
  const wa = actions(page).getByRole('link', { name: /Message driver on WhatsApp/ });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
  await expect(actions(page).getByRole('link', { name: 'Call driver' })).toHaveAttribute(
    'href',
    /^tel:\+?\d+/,
  );
  await expect(page.locator('.m-facts', { hasText: 'Driver' })).not.toContainText(
    'Not yet assigned',
  );
});

test('approve a completed job from the phone', async ({ page }) => {
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="state"]').selectOption('awaiting_operator_review');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());

  await openMobileBooking(page, LEGO);
  await expect(hero(page)).toContainText('Review completion');
  // One-shot actions arm on the first tap and run on the second.
  await actions(page).getByRole('button', { name: 'Approve & complete' }).click();
  await actions(page).getByRole('button', { name: 'Tap again to approve' }).click();
  await expect(page.locator('.toast')).toContainText('Trip approved');
  await expect(hero(page)).toContainText('DONE');
  // Done jobs can still be corrected, nothing else.
  await expect(actions(page).getByRole('button')).toHaveCount(1);
  await expect(actions(page).getByRole('button', { name: 'Edit booking' })).toBeVisible();
});

test('edit a booking from the phone', async ({ page }) => {
  await openMobileBooking(page, JJ);
  await actions(page).getByRole('button', { name: 'Edit booking' }).click();
  const modal = sheet(page);
  await expect(modal.locator('.modal__title')).toContainText('Edit');
  await modal
    .locator('.field', { hasText: 'Passenger' })
    .locator('input')
    .nth(1)
    .fill('Lefevre-Edited');
  await modal.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.toast')).toContainText('Booking updated');
  await expect(hero(page)).toContainText('Sophia Lefevre-Edited');
});

test('cancel with undo from the phone', async ({ page }) => {
  await openMobileBooking(page, MERC);
  await actions(page).getByRole('button', { name: 'Cancel booking' }).click();
  const modal = sheet(page);
  await expect(modal).toContainText('Cancel this booking?');
  await modal.getByRole('button', { name: 'Cancel booking' }).click();
  const toast = page.locator('.toast', { hasText: 'Booking cancelled' });
  await expect(toast).toBeVisible();
  await expect(hero(page)).toContainText('CANCELLED');
  await expect(actions(page)).toHaveCount(0);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast', { hasText: 'Cancellation undone' })).toBeVisible();
  await expect(hero(page)).toContainText('UNASSIGNED');
  await expect(actions(page).getByRole('button', { name: 'Find a driver' })).toBeVisible();
});

test('switching to the full console sticks, and back again', async ({ page }) => {
  await page.goto('/m', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Full console' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.topbar')).toBeVisible();
  // The preference is remembered: the board no longer bounces to the shell.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/dashboard$/);
  // …until the operator asks for the shell again.
  await page.getByRole('link', { name: 'Mobile view' }).click();
  await expect(page).toHaveURL(/\/m$/);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/m$/);
});
