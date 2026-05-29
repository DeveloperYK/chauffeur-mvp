import { type Page, expect, test } from '@playwright/test';

/**
 * End-to-end booking lifecycle, driven through the **test simulator** and the
 * operator console overlays.
 *
 * It walks ONE booking through every stage —
 *   unassigned → assigned → in_progress → awaiting_driver_form
 *   → awaiting_operator_review → completed
 * — using the simulator to force states and advance the clock (which fires the
 * real transition logic, SMS and Sheets-mirror side effects), and verifies the
 * console renders each stage. It then cancels a second booking from the panel.
 *
 * Runs against a RUNNING dev server (auth is bypassed outside production), so it
 * is NOT part of `pnpm test:e2e` (which builds + serves in production mode and
 * expects the login redirect). Run it with:
 *
 *   pnpm test:e2e:lifecycle        # needs `pnpm dev` already running on :3000
 *
 * WARNING: it calls the simulator's "Reset all data", wiping bookings + drivers
 * in whatever database the dev server points at. That is the simulator's job.
 */

const LEGO = 'Eric French'; // LEGO Group booking — the one we walk through
const MERC = 'Martin Finch'; // Mercedes-Benz UK booking — the one we cancel

test.describe.configure({ mode: 'serial' });

async function gotoSimulator(page: Page) {
  await page.goto('/dashboard/simulator', { waitUntil: 'networkidle' });
  // Auth bypass should land us on the simulator, not the login screen.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Simulator' })).toBeVisible();
}

function row(page: Page, passenger: string) {
  return page.locator('tr', { has: page.getByRole('link', { name: passenger }) });
}

async function clickAndSettle(page: Page, click: Promise<void>) {
  await Promise.all([page.waitForURL(/\/dashboard\/simulator\?ok=/), click]);
}

async function expectSimState(page: Page, passenger: string, label: string) {
  // The State column is the 2nd cell — assert there to avoid matching the
  // <option> labels inside the force-state <select>.
  await expect(row(page, passenger).locator('td').nth(1)).toHaveText(label);
}

test('booking moves through every stage via the simulator + console', async ({ page }) => {
  // ── Reset + seed ──────────────────────────────────────────────
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  await expectSimState(page, LEGO, 'Unassigned');

  // ── Force → assigned (a driver gets attached) ────────────────
  await row(page, LEGO).locator('select[name="state"]').selectOption('assigned');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());
  await expectSimState(page, LEGO, 'Assigned');

  // Fast-forward into the pickup window so the booking lands on today's
  // board (needed for both the swap step below and the in_progress tick).
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());

  // ── Console: swap driver from the detail panel ───────────────
  // The 24h-out scenario — the assigned driver can't make it, operator picks
  // someone else, the new driver taps Accept on the link. Verifies the
  // relaxed dispatch gate, the "Reassign driver" action, and that the panel
  // reflects the new driver afterwards.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  // Next.js dev RSC cache can lag a single revalidatePath; reload forces a
  // fresh server render so the just-assigned booking shows on the board.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  const driverNameBefore = (
    await page
      .locator('.panel.is-open .ir', { hasText: 'Driver' })
      .locator('.ir__row > span')
      .nth(1)
      .textContent()
  )?.trim();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Reassign driver' }).click();
  const swapModal = page.locator('.modal.is-open');
  await expect(swapModal).toBeVisible();
  await expect(swapModal).toContainText('Reassign driver');
  // Currently-assigned driver row is marked CURRENT and disabled.
  await expect(swapModal.locator('.driver-row', { hasText: 'CURRENT' })).toBeVisible();
  // Pick the first row that is NOT current and NOT busy.
  const pickable = swapModal.locator('.driver-row:not(.is-busy):not(:has-text("CURRENT"))').first();
  await pickable.click();
  await swapModal.getByRole('button', { name: /Generate link/i }).click();
  await expect(swapModal.locator('.dispatch-result')).toBeVisible();
  // Drive the driver-side accept by opening the generated link.
  const linkUrl = (
    await swapModal.locator('.dispatch-result__url span').first().textContent()
  )?.trim();
  expect(linkUrl, 'expected a dispatch link in the modal').toBeTruthy();
  await page.goto(linkUrl as string, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Accept job' }).click();
  // Booking should still be `assigned` but with a new driver.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  const driverNameAfter = (
    await page
      .locator('.panel.is-open .ir', { hasText: 'Driver' })
      .locator('.ir__row > span')
      .nth(1)
      .textContent()
  )?.trim();
  expect(driverNameAfter).toBeTruthy();
  expect(driverNameAfter).not.toBe(driverNameBefore);
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Assigned');

  // ── Clock: assigned → in_progress (pickup in 30 min, already fast-fwd'd) ─
  await clickAndSettle(page, page.getByRole('button', { name: 'Run clock tick' }).click());
  await expectSimState(page, LEGO, 'In progress');

  // The clock should have texted the exec the "en route" SMS.
  await expect(page.getByText('No SMS yet.')).toHaveCount(0);

  // ── Clock: in_progress → awaiting_driver_form (trip ended) ───
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('trip_finished');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());
  await clickAndSettle(page, page.getByRole('button', { name: 'Run clock tick' }).click());
  await expectSimState(page, LEGO, 'Awaiting driver form');

  // ── Force → awaiting_operator_review (completion data filled) ─
  await row(page, LEGO).locator('select[name="state"]').selectOption('awaiting_operator_review');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());
  await expectSimState(page, LEGO, 'Awaiting operator review');

  // ── Console: approve from the detail panel → completed ───────
  // The fast-forwards put the pickup at "today", so it shows on today's board.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await expect(page.locator('.panel.is-open .dp-hero__lozenges')).toContainText('AWAITING REVIEW');
  // Completion form the driver "submitted" is visible.
  await expect(page.locator('.panel.is-open')).toContainText('Driver completion form');
  await page.locator('.panel.is-open').getByRole('button', { name: 'Approve & complete' }).click();
  await expect(page.locator('.toast')).toContainText(/approved/i);

  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Completed');

  // ── Console: cancel a second booking from the panel ──────────
  // Bring Mercedes booking onto today's board, then cancel it via the panel.
  await row(page, MERC).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, MERC).getByRole('button', { name: 'Apply' }).click());

  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'Mercedes-Benz UK' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Cancel', exact: true }).click();
  const modal = page.locator('.modal.is-open');
  await expect(modal).toBeVisible();
  await modal.locator('textarea').fill('PA called to cancel — meeting rescheduled.');
  await modal.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.locator('.toast')).toContainText(/cancelled/i);

  await gotoSimulator(page);
  await expectSimState(page, MERC, 'Cancelled');
});
