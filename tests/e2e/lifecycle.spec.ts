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

  // ── Console: driver pulled out → unassign, then re-dispatch ──────
  // The 24h-out scenario — the assigned driver can't make it. The operator
  // releases them: the booking goes back to UNASSIGNED so it re-enters the
  // queue (truthful — nobody is committed in the gap), then a new driver is
  // dispatched and taps Accept via the normal path.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  // Next.js dev RSC cache can lag a single revalidatePath; reload forces a
  // fresh server render so the just-assigned booking shows on the board.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Driver pulled out/i })
    .click();
  await expect(page.locator('.toast')).toContainText(/released/i);

  // The gap is honest: with no driver committed, the booking is unassigned.
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Unassigned');

  // Re-dispatch a new driver through the standard flow and accept the link.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Find a driver' }).click();
  const dispatchModal = page.locator('.modal.is-open');
  await expect(dispatchModal).toBeVisible();
  await expect(dispatchModal).toContainText('Find a driver');
  await dispatchModal.locator('.driver-row:not(.is-busy)').first().click();
  await dispatchModal.getByRole('button', { name: /Generate link/i }).click();
  await expect(dispatchModal.locator('.dispatch-result')).toBeVisible();
  const linkUrl = (
    await dispatchModal.locator('.dispatch-result__url span').first().textContent()
  )?.trim();
  expect(linkUrl, 'expected a dispatch link in the modal').toBeTruthy();
  await page.goto(linkUrl as string, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Accept job' }).click();

  // New driver accepted → back to assigned. Wait for the accept redirect
  // before navigating away so the DB write is definitely committed.
  await page.waitForURL(/\/j\/[^/]+\?status=accepted/);
  await gotoSimulator(page);
  await page.reload({ waitUntil: 'networkidle' });
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
  // Operator sees the waiting charge breakdown (here the seeded 10 min is within
  // the free period, so no charge applies).
  await expect(page.locator('.panel.is-open')).toContainText('Waiting charge');
  // The headline Price is the all-in total: the seeded £5 car park surfaces a
  // fare breakdown under the price.
  await expect(page.locator('.panel.is-open .dp-stat--price')).toContainText('Fare');
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

  // ── Drivers page: mark a driver off → excluded from dispatch ──
  // The third seed booking (Sophia Lefevre) is still unassigned. Fast-forward
  // it onto today's board, mark a driver off for today, then open the
  // dispatch modal and confirm that driver is in the "Off on" group rather
  // than the candidate list.
  const SOPHIA = 'Sophia Lefevre';
  await row(page, SOPHIA).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, SOPHIA).getByRole('button', { name: 'Apply' }).click());

  await page.goto('/dashboard/drivers', { waitUntil: 'networkidle' });
  // Mark the first listed driver off for today only. Capture their name so
  // we can assert against it in the dispatch modal.
  const firstDriverRow = page.locator('.dt-row.dt-row--load').nth(1); // [0] is the header row
  const offDriverName = (await firstDriverRow.locator('.name span').nth(1).textContent())?.trim();
  expect(offDriverName, 'expected a driver name in the roster').toBeTruthy();
  await firstDriverRow.getByRole('button', { name: 'Off…' }).click();
  const offModal = page.locator('.modal.is-open');
  await expect(offModal).toBeVisible();
  await expect(offModal).toContainText('Time off');
  // Inputs default to today; just submit.
  await offModal.getByRole('button', { name: 'Save' }).click();
  await expect(offModal).toBeHidden();
  // Roster now shows an OFF lozenge for that driver.
  await expect(firstDriverRow).toContainText('OFF');

  // Open the dispatch modal for Sophia's booking and verify the off driver
  // is in the "Off on" group, not in the candidate list.
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'Johnson & Johnson' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Find a driver' }).click();
  const offDispatchModal = page.locator('.modal.is-open');
  await expect(offDispatchModal).toBeVisible();
  await expect(offDispatchModal.locator('.dispatch-off-group')).toContainText(
    offDriverName as string,
  );
  // The off driver should NOT appear as a pickable row.
  const pickableRows = offDispatchModal.locator('.driver-row');
  await expect(pickableRows.filter({ hasText: offDriverName as string })).toHaveCount(0);
});
