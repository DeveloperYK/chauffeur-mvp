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
const JJ = 'Sophia Lefevre'; // Johnson & Johnson booking — the backfill-driver arm

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
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
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

  // Re-dispatch via the multi-select fan-out: tick two free drivers, offer to
  // both (each gets its own link), then accept one — first-to-accept wins.
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Find a driver' }).click();
  const dispatchModal = page.locator('.modal.is-open');
  await expect(dispatchModal).toBeVisible();
  await expect(dispatchModal).toContainText('Find drivers');
  // Select up to two free drivers (checklist multi-select).
  const freeRows = dispatchModal.locator('.driver-row:not(.is-busy)');
  await freeRows.first().click();
  if ((await freeRows.count()) > 1) await freeRows.nth(1).click();
  await dispatchModal.getByRole('button', { name: /Offer to \d+ driver/ }).click();
  // Fan-out list: one row per offered driver, each carrying its own link.
  const offerRows = dispatchModal.locator('.offer-row[data-link]');
  await expect(offerRows.first()).toBeVisible();
  const linkUrl = (await offerRows.first().getAttribute('data-link'))?.trim();
  expect(linkUrl, 'expected a dispatch link in the fan-out list').toBeTruthy();
  // Drive the driver-side accept by opening one driver's link.
  await page.goto(linkUrl as string, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Accept job' }).click();
  // Wait for the accept to land (driver sees the confirmation) before re-checking.
  await expect(page.getByRole('heading', { name: 'Job accepted' })).toBeVisible();

  // New driver accepted → back to assigned.
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
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
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

  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
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

test('backfill driver: hand off → clock → driver completion form → approve', async ({ page }) => {
  // Fresh data so the J&J booking starts unassigned regardless of the prior arm.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());
  await expectSimState(page, JJ, 'Unassigned');

  // Bring it onto today's board so we can open it from the console.
  await row(page, JJ).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, JJ).getByRole('button', { name: 'Apply' }).click());

  // ── Console: hand to a backfill (subcontractor) driver ───────
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'Johnson & Johnson' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Hand to backfill' }).click();
  const bfModal = page.locator('.modal.is-open');
  await expect(bfModal).toBeVisible();
  await bfModal.getByPlaceholder('e.g. Dave Smith').fill('Dave Smith');
  await bfModal.getByPlaceholder('e.g. +44 7911 123456').fill('+44 7911 123456');
  await bfModal.getByPlaceholder('e.g. BMW 5 Series').fill('BMW 5 Series');
  // Backfill drivers are paid per job (internal drivers are salaried) — pay is required.
  await bfModal.getByPlaceholder('120').fill('120');
  await bfModal.getByRole('button', { name: 'Hand to backfill' }).click();
  await expect(page.locator('.toast')).toContainText(/backfill/i);

  // → Assigned, flagged as backfill (no internal driver committed).
  await gotoSimulator(page);
  await expectSimState(page, JJ, 'Assigned');

  // ── Clock: assigned → in_progress, en-route SMS naming the backfill driver ─
  await clickAndSettle(page, page.getByRole('button', { name: 'Run clock tick' }).click());
  await expectSimState(page, JJ, 'In progress');
  await expect(page.getByText('No SMS yet.')).toHaveCount(0);

  // ── Clock: trip ended → awaiting_driver_form, same as a normal driver. The
  //    backfill driver fills out the completion form via a link. ──
  await row(page, JJ).locator('select[name="scenario"]').selectOption('trip_finished');
  await clickAndSettle(page, row(page, JJ).getByRole('button', { name: 'Apply' }).click());
  await clickAndSettle(page, page.getByRole('button', { name: 'Run clock tick' }).click());
  await expectSimState(page, JJ, 'Awaiting driver form');

  // ── Console: generate the completion link for the backfill driver ──
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'Johnson & Johnson' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await expect(page.locator('.panel.is-open .dp-hero__lozenges')).toContainText('BACKFILL');
  // The operator-entered backfill driver pay is recorded and shown on the panel.
  await expect(page.locator('.panel.is-open')).toContainText('Backfill pay');
  await expect(page.locator('.panel.is-open')).toContainText('£120');
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: 'Generate completion link' })
    .click();
  const completionLink = page.locator('.modal.is-open .dispatch-result__url span');
  await expect(completionLink).toBeVisible();
  const completionUrl = (await completionLink.textContent())?.trim();
  expect(completionUrl, 'expected a completion link in the popup').toBeTruthy();

  // ── Backfill driver fills out the same completion form via the link ──
  await page.goto(completionUrl as string, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Trip completion' })).toBeVisible();
  await page.locator('#arrivalTime').fill('11:00');
  await page.locator('#passengerOnBoardTime').fill('11:10');
  await page.locator('#completionTime').fill('12:30');
  await page.locator('#parkingFeePounds').fill('5');
  await Promise.all([
    page.waitForURL(/status=submitted/),
    page.getByRole('button', { name: 'Submit' }).click(),
  ]);

  await gotoSimulator(page);
  await expectSimState(page, JJ, 'Awaiting operator review');

  // ── Console: approve → completed (same as a normal driver) ──
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'Johnson & Johnson' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page.locator('.panel.is-open').getByRole('button', { name: 'Approve & complete' }).click();
  await expect(page.locator('.toast')).toContainText(/approved/i);

  await gotoSimulator(page);
  await expectSimState(page, JJ, 'Completed');
});

test('operator completes the form on the driver behalf → completed, skipping review', async ({
  page,
}) => {
  // Fresh data; bring LEGO onto today's board and into awaiting_driver_form.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  // Force into awaiting_driver_form (assigns a driver), then onto today's board.
  // gotoSimulator between each mutation resets the URL so clickAndSettle's
  // wait-for-?ok= actually blocks on the new navigation (not a stale prior one).
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="state"]').selectOption('awaiting_driver_form');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Awaiting driver form');

  // ── Console: operator enters the completion details (driver was slow) ──
  await page.goto('/dashboard?layout=board', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card', { hasText: 'LEGO Group' }).first().click();
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: 'Enter completion details' })
    .click();
  const modal = page.locator('.modal.is-open');
  await expect(modal).toBeVisible();
  // The three times are pre-filled from the booking; set the parking fee.
  await modal.locator('input[type="number"]').first().fill('4.50');
  await modal.getByRole('button', { name: 'Complete booking' }).click();
  await expect(page.locator('.toast')).toContainText(/behalf/i);

  // → Completed directly, never passing through Awaiting operator review.
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Completed');

  // The completed booking is marked operator-entered on the board.
  await page.goto('/dashboard?layout=board&showDone=1', { waitUntil: 'networkidle' });
  await expect(page.locator('.card', { hasText: 'LEGO Group' }).first()).toContainText(
    'OP-ENTERED',
  );
});
