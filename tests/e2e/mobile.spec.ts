import { type Page, expect, test } from '@playwright/test';

/**
 * The operator console on a phone — iPhone 13 project (UA + 390px viewport +
 * touch). There is no separate mobile app: the same console lays itself out for
 * the small screen, so this spec drives the real board, panel and modals.
 *
 * Covers what an operator out of the office must be able to do from a phone:
 * see the day without sideways scrolling, create a booking, dispatch (confirmed
 * by phone) and message the driver in the WhatsApp app, edit, cancel with undo,
 * and approve a completed job.
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
  await page.goto('/dashboard/simulator', { waitUntil: 'networkidle' });
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

/** Deep link straight to the booking: the board opens on its day with the panel up. */
async function openBookingPanel(page: Page, passenger: string) {
  const id = await bookingIdOf(page, passenger);
  await page.goto(`/dashboard/bookings/${id}`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/dashboard\?/);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText(passenger);
}

const panel = (page: Page) => page.locator('.panel.is-open');
const lozenges = (page: Page) => page.locator('.panel.is-open .dp-hero__lozenges');
const sheet = (page: Page) => page.locator('.modal.is-open');

/** Nothing on the page may be wider than the phone: no sideways scrolling. */
async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const content = document.querySelector('.content');
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      main: main ? main.scrollWidth : 0,
      content: content ? content.scrollWidth : 0,
    };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.main).toBeLessThanOrEqual(widths.viewport);
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
}

/** The modal takes the whole screen on a phone (a sheet, not a floating card). */
async function expectFullScreenSheet(page: Page) {
  const box = await sheet(page).locator('.modal__card').boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'modal card should be laid out').toBeTruthy();
  expect(viewport).toBeTruthy();
  if (!box || !viewport) return;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
}

test('the board fits a phone: no redirect, columns stack, empty ones hide', async ({ page }) => {
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  // A phone gets the console itself, on the same URL.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.topbar')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The seeded day: the board's columns stack one under another, full width.
  const id = await bookingIdOf(page, LEGO);
  await page.goto(`/dashboard/bookings/${id}`, { waitUntil: 'networkidle' });
  const url = new URL(page.url());
  url.searchParams.set('layout', 'board');
  url.searchParams.delete('booking');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await expectNoHorizontalOverflow(page);

  const unassigned = page.locator('.column[aria-label="Unassigned"]');
  await expect(unassigned).toBeVisible();
  expect(await unassigned.locator('.card').count()).toBeGreaterThan(0);
  // Full width, one under another: every visible column shares the left edge
  // and spans the screen, so there is nothing to scroll sideways to.
  const boxes = await page
    .locator('.column:visible')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  const viewport = page.viewportSize()?.width ?? 0;
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Math.round(box.x)).toBe(Math.round(boxes[0]?.x ?? -1));
    expect(box.width).toBeGreaterThan(viewport * 0.85);
  }
  // Columns with nothing in them are noise on a phone.
  await expect(page.locator('.column[aria-label="In progress"]')).toBeHidden();
  await expect(page.locator('.column[aria-label="Awaiting review"]')).toBeHidden();

  // The list layout reflows into stacked rows rather than a 700px-wide table.
  url.searchParams.set('layout', 'list');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('.list__row.head')).toBeHidden();
  await expect(page.locator('.list__row', { hasText: LEGO }).first()).toBeVisible();

  // The side rail is a nav strip the operator can scroll; the urgent views keep their counts.
  await expect(
    page.locator('.rail').getByRole('link', { name: /Unassigned tickets/ }),
  ).toContainText('3');
});

test('create a booking from the phone', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.locator('.topbar .btn-pri-create').click();
  const modal = sheet(page);
  await expect(modal.locator('.modal__title')).toHaveText('Create booking');
  await expectFullScreenSheet(page);
  // 16px keeps iOS Safari from zooming into the field on focus.
  const fontSize = await modal
    .locator('input[aria-label="Pickup address"]')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('16px');

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
  await expect(page.locator('.toast')).toContainText('Booking created');

  await openBookingPanel(page, 'Phone Booker');
  await expect(lozenges(page)).toContainText('UNASSIGNED');
});

test('dispatch: assign a driver confirmed by phone, then message them in the app', async ({
  page,
}) => {
  await openBookingPanel(page, LEGO);
  await panel(page).getByRole('button', { name: 'Find a driver' }).click();
  const modal = sheet(page);
  await expect(modal).toContainText('Find drivers');
  await expectFullScreenSheet(page);
  await modal.locator('.driver-row:not(.is-busy)').first().click();
  await modal.getByRole('button', { name: 'Confirmed by phone' }).click();
  await expect(page.locator('.toast')).toContainText(/confirmed by phone/i);

  await expect(lozenges(page)).toContainText('ASSIGNED');
  // On a phone the WhatsApp hand-off goes to the app (wa.me), not WhatsApp Web.
  const wa = panel(page).getByRole('link', { name: /Message driver on WhatsApp/ });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
});

test('offer a job to drivers: the offer links open the WhatsApp app', async ({ page }) => {
  await openBookingPanel(page, MERC);
  await panel(page).getByRole('button', { name: 'Find a driver' }).click();
  const modal = sheet(page);
  await modal.locator('.driver-row:not(.is-busy)').first().click();
  await modal.getByRole('button', { name: /Offer to 1 driver/ }).click();
  const offer = modal.getByRole('link', { name: /WhatsApp/ }).first();
  await expect(offer).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
  await modal.getByRole('button', { name: 'Done' }).click();
});

test('approve a completed job from the phone', async ({ page }) => {
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="state"]').selectOption('awaiting_operator_review');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());

  await openBookingPanel(page, LEGO);
  await expect(lozenges(page)).toContainText('AWAITING REVIEW');
  await panel(page).getByRole('button', { name: 'Approve & complete' }).click();
  await expect(page.locator('.toast')).toContainText(/approved/i);
  // Approval closes the panel; the booking is now done.
  await expect(panel(page)).toHaveCount(0);
  await openBookingPanel(page, LEGO);
  await expect(lozenges(page)).toContainText('DONE');
});

test('edit a booking from the phone', async ({ page }) => {
  await openBookingPanel(page, JJ);
  await panel(page).getByRole('button', { name: 'Edit', exact: true }).click();
  const modal = sheet(page);
  await expect(modal.locator('.modal__title')).toContainText('Edit');
  await expectFullScreenSheet(page);
  await modal
    .locator('.field', { hasText: 'Passenger' })
    .locator('input')
    .nth(1)
    .fill('Lefevre-Edited');
  await modal.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.toast')).toContainText('Booking updated');
  await expect(panel(page)).toContainText('Sophia Lefevre-Edited');
});

test('cancel with undo from the phone', async ({ page }) => {
  await openBookingPanel(page, MERC);
  await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  const modal = sheet(page);
  await expect(modal).toContainText('Cancel this booking?');
  await modal.getByRole('button', { name: 'Cancel booking' }).click();
  const toast = page.locator('.toast', { hasText: 'Booking cancelled' });
  await expect(toast).toBeVisible();
  // Cancelling closes the panel; the Undo lives in the toast.
  await expect(panel(page)).toHaveCount(0);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast', { hasText: 'Cancellation undone' })).toBeVisible();
  await openBookingPanel(page, MERC);
  await expect(lozenges(page)).toContainText('UNASSIGNED');
});
