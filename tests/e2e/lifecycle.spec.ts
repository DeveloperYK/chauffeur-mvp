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

/** Current Europe/London wall-clock as "HH:MM" (midnight normalised to 00). */
function londonNowHhmm(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(/^24/, '00');
}

/** "HH:MM" plus n minutes, wrapping within the day. */
function hhmmPlusMinutes(hhmm: string, n: number): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + n + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function clickAndSettle(page: Page, click: Promise<void>) {
  await Promise.all([page.waitForURL(/\/dashboard\/simulator\?ok=/), click]);
}

async function expectSimState(page: Page, passenger: string, label: string) {
  // The State column is the 2nd cell — assert there to avoid matching the
  // <option> labels inside the force-state <select>.
  await expect(row(page, passenger).locator('td').nth(1)).toHaveText(label);
}

/**
 * Open a booking's detail panel via its day-resolving detail route
 * (/dashboard/bookings/<id> → board with the panel open on the booking's own
 * day). The board defaults to "today", but the simulator's fast-forwards move
 * pickups by hours — around midnight that lands them on yesterday/tomorrow,
 * so clicking the card on today's board is a flake. The id is read from the
 * booking's link on the simulator page.
 */
async function openBookingPanel(page: Page, name: string) {
  await gotoSimulator(page);
  const href = await row(page, name).getByRole('link', { name }).getAttribute('href');
  const id = href?.split('/').pop() ?? '';
  expect(id, `expected a booking link for ${name}`).toBeTruthy();
  await page.goto(`/dashboard/bookings/${id}`, { waitUntil: 'networkidle' });
  // The redirect resolves the day but not the layout — force the board layout
  // so card assertions work like the old `?layout=board` navigations did.
  const boardUrl = new URL(page.url());
  boardUrl.searchParams.set('layout', 'board');
  await page.goto(boardUrl.toString(), { waitUntil: 'networkidle' });
  await expect(page.locator('.panel.is-open')).toBeVisible();
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
  await openBookingPanel(page, LEGO);
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
  await openBookingPanel(page, LEGO);
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
  // The confirmation hands the driver both ways back in: the persistent link
  // and a prefilled Google Calendar event that links to it.
  await expect(page.getByRole('link', { name: 'View job details' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to Google Calendar' })).toHaveAttribute(
    'href',
    /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/,
  );
  // Apple Calendar: the .ics route serves a real event, gated by the same token.
  const appleHref = await page
    .getByRole('link', { name: 'Add to Apple Calendar' })
    .getAttribute('href');
  expect(appleHref, 'expected an Apple Calendar link').toBeTruthy();
  const icsRes = await page.request.get(appleHref as string);
  expect(icsRes.status()).toBe(200);
  expect(icsRes.headers()['content-type']).toContain('text/calendar');
  const icsBody = await icsRes.text();
  expect(icsBody).toContain('BEGIN:VCALENDAR');
  expect(icsBody).toContain('SUMMARY:JJ Chauffeuring BKNG-');

  // ── Driver reopens their link after accepting → persistent job view ──────
  // The offer is one-shot, but the same link must now show the accepted job
  // (addresses, time) instead of a dead end, so the driver can keep track.
  await page.goto(linkUrl as string, { waitUntil: 'networkidle' });
  await expect(page.getByText('Your job', { exact: true })).toBeVisible();
  await expect(page.getByText('CONFIRMED - YOUR JOB')).toBeVisible();
  await expect(page.getByText('Pickup ·')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add to Google Calendar' })).toBeVisible();

  // New driver accepted → back to assigned.
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Assigned');

  // ── Exec-message failure surfaces on the board + one-click resend clears it ─
  // Force a failed exec confirmation (the booking has a real driver, so the
  // resend can rebuild + send it). Exercises the tile marker, the panel health
  // pill, the drawer error, and the resend that auto-clears the failure.
  await clickAndSettle(
    page,
    row(page, LEGO).getByRole('button', { name: 'Fail exec msg' }).click(),
  );
  // openBookingPanel lands the board on the booking's own day, so the card
  // (behind the open panel) can be asserted for the red ⚠ exec marker.
  await openBookingPanel(page, LEGO);
  const legoFailCard = page.locator('.card', { hasText: 'LEGO Group' }).first();
  await expect(legoFailCard).toContainText('exec'); // red ⚠ exec marker
  await expect(page.locator('.panel.is-open .dp-hero__lozenges')).toContainText(
    'EXEC MESSAGE FAILED',
  );
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Exec messages/ })
    .click();
  await expect(page.locator('.panel.is-open')).toContainText('FAILED');
  await page.locator('.panel.is-open').getByRole('button', { name: 'Resend' }).first().click();
  await expect(page.locator('.toast')).toContainText(/re-sent/i);

  // Tile marker is gone once the resend succeeds (re-open to re-render the
  // board on the booking's day).
  await openBookingPanel(page, LEGO);
  await expect(page.locator('.card', { hasText: 'LEGO Group' }).first()).not.toContainText('exec');

  await gotoSimulator(page);

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
  await openBookingPanel(page, LEGO);
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
  await row(page, MERC).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, MERC).getByRole('button', { name: 'Apply' }).click());

  await openBookingPanel(page, MERC);
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
  await openBookingPanel(page, JJ);
  await page.locator('.panel.is-open').getByRole('button', { name: 'Hand to backfill' }).click();
  const bfModal = page.locator('.modal.is-open');
  await expect(bfModal).toBeVisible();
  await bfModal.locator('input[name="backfillDriverName"]').fill('Dave Smith');
  await bfModal.locator('input[name="backfillDriverPhone"]').fill('+44 7911 123456');
  await bfModal.locator('input[name="backfillCar"]').fill('BMW 5 Series');
  // Backfill drivers are paid per job (internal drivers are salaried) — pay is required.
  await bfModal.locator('input[name="backfillDriverPay"]').fill('120');
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
  await openBookingPanel(page, JJ);
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
  // The form asks for arrival, passenger-on-board and completion times plus
  // parking — waiting minutes are derived server-side, never typed.
  await expect(page.locator('#waitingMinutes')).toHaveCount(0);
  const nowHhmm = londonNowHhmm();
  await page.locator('#arrivalTime').fill(nowHhmm);
  await page.locator('#passengerOnBoardTime').fill(nowHhmm);
  await page.locator('#completionTime').fill('12:30');
  await page.locator('#parkingFeePounds').fill('5');
  await Promise.all([
    page.waitForURL(/status=submitted/),
    page.getByRole('button', { name: 'Submit' }).click(),
  ]);

  await gotoSimulator(page);
  await expectSimState(page, JJ, 'Awaiting operator review');

  // ── Console: approve → completed (same as a normal driver) ──
  await openBookingPanel(page, JJ);
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
  await openBookingPanel(page, LEGO);
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: 'Enter completion details' })
    .click();
  const modal = page.locator('.modal.is-open');
  await expect(modal).toBeVisible();
  // Times are pre-filled from the booking (arrival and on-board at the booked
  // pickup → zero waiting). Nudge on-board +10 min to exercise the derived wait,
  // then fill the parking fee (the only number input left on the form).
  const onBoardInput = modal.locator('.field', { hasText: 'Passenger on board' }).locator('input');
  await onBoardInput.fill(hhmmPlusMinutes(await onBoardInput.inputValue(), 10));
  await modal.locator('input[type="number"]').first().fill('4.50');
  await modal.getByRole('button', { name: 'Complete booking' }).click();
  await expect(page.locator('.toast')).toContainText(/behalf/i);

  // → Completed directly, never passing through Awaiting operator review.
  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Completed');

  // The completed booking is marked operator-entered on the board. Open via
  // the day-resolving route, then re-load that day's board with the Done
  // column revealed.
  await openBookingPanel(page, LEGO);
  const doneUrl = new URL(page.url());
  doneUrl.searchParams.set('layout', 'board');
  doneUrl.searchParams.set('showDone', '1');
  await page.goto(doneUrl.toString(), { waitUntil: 'networkidle' });
  await expect(page.locator('.card', { hasText: 'LEGO Group' }).first()).toContainText(
    'OP-ENTERED',
  );
  // The panel records the reported times and the derived 10-minute wait.
  await expect(page.locator('.panel.is-open')).toContainText('Passenger on board');
  await expect(page.locator('.panel.is-open')).toContainText('10 min');
});

test('mid-flight change: editing an assigned booking flags it, operator attests confirmation', async ({
  page,
}) => {
  // Fresh data; force LEGO → assigned (a driver gets attached) and onto today's board.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="state"]').selectOption('assigned');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());
  await expectSimState(page, LEGO, 'Assigned');

  // ── Console: edit a driver-facing field (duration) on the assigned booking ──
  await openBookingPanel(page, LEGO);
  await page.locator('.panel.is-open').getByRole('button', { name: 'Edit', exact: true }).click();

  const editModal = page.locator('.modal.is-open');
  await expect(editModal).toBeVisible();
  // Duration is a driver-facing field, so editing it is a material change.
  await editModal.locator('.field', { hasText: 'Duration (min)' }).locator('input').fill('200');
  await editModal.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast')).toContainText(/Booking updated/i);

  // The change flags the booking for driver re-confirmation.
  await openBookingPanel(page, LEGO);
  await expect(page.locator('.panel.is-open')).toContainText('CHANGE — DRIVER NOT CONFIRMED');

  // ── Operator attests the driver confirmed by phone ──
  // (The exec is auto-emailed on confirm only for exec-relevant changes; this
  // edit was duration-only, so no exec email — nothing to click here.)
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Driver confirmed by phone/i })
    .click();
  await expect(page.locator('.toast')).toContainText(/confirmed/i);

  await openBookingPanel(page, LEGO);
  await expect(page.locator('.panel.is-open')).toContainText('CHANGE CONFIRMED BY PHONE');
});

test('mid-flight change: driver confirms via the change link, exec is emailed the update', async ({
  page,
}) => {
  // Fresh data; force LEGO → assigned and onto today's board.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="state"]').selectOption('assigned');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Set' }).click());
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());
  await expectSimState(page, LEGO, 'Assigned');

  // ── Console: an exec-facing edit (pickup time) with an exec email on file ──
  await openBookingPanel(page, LEGO);
  await page.locator('.panel.is-open').getByRole('button', { name: 'Edit', exact: true }).click();
  const editModal = page.locator('.modal.is-open');
  await expect(editModal).toBeVisible();
  const pickupInput = editModal.locator('.field', { hasText: 'Pickup time' }).locator('input');
  const current = await pickupInput.inputValue(); // "YYYY-MM-DDTHH:MM"
  const shifted = new Date(`${current}:00`);
  shifted.setMinutes(shifted.getMinutes() + 30);
  const pad = (n: number) => String(n).padStart(2, '0');
  await pickupInput.fill(
    `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}T${pad(shifted.getHours())}:${pad(shifted.getMinutes())}`,
  );
  await editModal
    .locator('.field', { hasText: 'Exec email' })
    .locator('input')
    .fill('exec-change@example.com');
  await editModal.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.toast')).toContainText(/Booking updated/i);

  // ── Operator sends the change-confirm link to the driver ──
  await openBookingPanel(page, LEGO);
  await expect(page.locator('.panel.is-open')).toContainText('CHANGE — DRIVER NOT CONFIRMED');
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Send change link/i })
    .click();
  const linkModal = page.locator('.modal.is-open');
  await expect(linkModal).toContainText('Change confirmation link');
  const changeUrl = (await linkModal.getByText(/https?:\/\//).textContent())?.trim() ?? '';
  expect(changeUrl).toMatch(/\/j\//);

  // ── Driver opens the link and confirms the new details ──
  await page.goto(changeUrl, { waitUntil: 'networkidle' });
  await expect(page.getByText('Updated job for')).toBeVisible();
  await page.getByRole('button', { name: /Confirm the new details/i }).click();
  await expect(page.getByRole('heading', { name: 'Change confirmed' })).toBeVisible();

  // ── Console: confirmed by the driver, and the exec was emailed the update ──
  await openBookingPanel(page, LEGO);
  await expect(page.locator('.panel.is-open')).toContainText('CHANGE CONFIRMED BY DRIVER');
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Exec messages/ })
    .click();
  await expect(page.locator('.panel.is-open')).toContainText('Booking updated');
});

test('operator-attested assign: confirm a driver by phone, then reassign by phone', async ({
  page,
}) => {
  // Fresh data; bring an unassigned LEGO booking onto today's board.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());
  await gotoSimulator(page);
  await row(page, LEGO).locator('select[name="scenario"]').selectOption('about_to_start');
  await clickAndSettle(page, row(page, LEGO).getByRole('button', { name: 'Apply' }).click());
  await expectSimState(page, LEGO, 'Unassigned');

  // ── Assign a driver by phone (no link round-trip) ──
  await openBookingPanel(page, LEGO);
  await page.locator('.panel.is-open').getByRole('button', { name: 'Find a driver' }).click();
  const modal = page.locator('.modal.is-open');
  await expect(modal).toBeVisible();
  await modal.locator('.driver-row:not(.is-busy)').first().click();
  await modal.getByRole('button', { name: /Confirmed by phone/i }).click();
  await expect(page.locator('.toast')).toContainText(/confirmed by phone/i);

  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Assigned');

  // The panel records the assignment method.
  await openBookingPanel(page, LEGO);
  await expect(page.locator('.panel.is-open .dp-hero__lozenges')).toContainText('ASSIGNED');
  await expect(page.locator('.panel.is-open')).toContainText('Confirmed by phone');

  // ── Reassign to a different driver, also by phone ──
  await page.locator('.panel.is-open').getByRole('button', { name: 'Reassign driver' }).click();
  const reassign = page.locator('.modal.is-open');
  await expect(reassign).toContainText('Reassign driver');
  // Pick a different free driver than the one already assigned.
  await reassign.locator('.driver-row:not(.is-busy)').nth(1).click();
  await reassign.getByRole('button', { name: /Confirmed by phone/i }).click();
  await expect(page.locator('.toast')).toContainText(/reassigned|confirmed by phone/i);

  await gotoSimulator(page);
  await expectSimState(page, LEGO, 'Assigned');
});

test('standalone create + detail routes redirect into the board surfaces', async ({ page }) => {
  // #8 — the legacy /dashboard/new page now opens the board's create slide-over.
  await page.goto('/dashboard/new', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/dashboard\?new=1/);
  await expect(page.locator('.modal.is-open .modal__title')).toHaveText('Create booking');

  // #9 — the legacy /dashboard/bookings/<id> page now opens that booking's
  // detail panel on the board (resolving the booking's day from its pickup).
  await gotoSimulator(page);
  const href = await row(page, LEGO).getByRole('link', { name: LEGO }).getAttribute('href');
  const id = href?.split('/').pop() ?? '';
  expect(id).toBeTruthy();

  await page.goto(`/dashboard/bookings/${id}`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`booking=${id}`));
  await expect(page.locator('.panel.is-open')).toBeVisible();
  await expect(page.locator('.panel.is-open')).toContainText('LEGO Group');
});

test('optional pricing: a booking created without a price is flagged until one is set', async ({
  page,
}) => {
  // Fresh data so exactly one "Priceless" booking exists below.
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Reset all data' }).click());
  await gotoSimulator(page);
  await clickAndSettle(page, page.getByRole('button', { name: 'Seed sample data' }).click());

  // ── Create through the real form, leaving the contract price blank ──
  await page.goto('/dashboard?new=1', { waitUntil: 'networkidle' });
  const modal = page.locator('.modal.is-open');
  await expect(modal.locator('.modal__title')).toHaveText('Create booking');

  await modal.locator('input[aria-label="Pickup address"]').fill('1 Test Street, London');
  await modal.locator('input[aria-label="Dropoff address"]').fill('2 Sample Road, London');
  await modal
    .locator('.field', { hasText: 'Passenger' })
    .locator('input')
    .first()
    .fill('Priceless');
  await modal.locator('.field', { hasText: 'Exec mobile' }).locator('input').fill('+447911123456');
  await modal
    .locator('.field', { hasText: 'Exec email' })
    .locator('input')
    .fill('exec@example.com');
  await modal.locator('input[aria-label="Customer account"]').fill('NoPrice Co');
  await modal.locator('.field', { hasText: 'Case code' }).locator('input').fill('NP-1');
  // Capture the subcontractor quote; the contract price is deliberately left blank.
  await modal.locator('.field', { hasText: 'Subcontractor price' }).locator('input').fill('90');
  await modal.getByRole('button', { name: 'Create booking' }).click();
  await expect(page.locator('.modal.is-open')).toHaveCount(0);

  // ── The board flags the unpriced booking, the panel spells it out ──
  await openBookingPanel(page, 'Priceless');
  await expect(page.locator('.card', { hasText: 'NoPrice Co' }).first()).toContainText('no price');
  await expect(page.locator('.panel.is-open .dp-stat--price')).toContainText('No price yet');
  await expect(page.locator('.panel.is-open .dp-stat--price')).toContainText('Subcontractor £90');

  // ── The rail's "No price" saved view counts and lists it ──
  // Seeded bookings are all priced, so the one unpriced booking is Priceless.
  const noPriceRailItem = page.locator('.rail__item', { hasText: 'No price' });
  await expect(noPriceRailItem).toContainText('1');
  await page.goto('/dashboard?savedView=no_price', { waitUntil: 'networkidle' });
  await expect(page.locator('.page-head__title')).toHaveText('No price');
  await expect(page.locator('.page-head__sub')).toContainText('1 ticket');
  await expect(page.getByText('NoPrice Co').first()).toBeVisible();

  // ── The unpriced booking runs the whole lifecycle to completed ──
  await gotoSimulator(page);
  await row(page, 'Priceless')
    .locator('select[name="state"]')
    .selectOption('awaiting_operator_review');
  await clickAndSettle(page, row(page, 'Priceless').getByRole('button', { name: 'Set' }).click());
  await expectSimState(page, 'Priceless', 'Awaiting operator review');

  await openBookingPanel(page, 'Priceless');
  await page
    .locator('.panel.is-open')
    .getByRole('button', { name: /Approve/ })
    .click();
  await expect(page.locator('.toast')).toContainText(/approved/i);
  await gotoSimulator(page);
  await expectSimState(page, 'Priceless', 'Completed');

  // ── Completed and still unpriced: the flag persists on the done board ──
  await openBookingPanel(page, 'Priceless');
  const doneUrl = new URL(page.url());
  doneUrl.searchParams.set('layout', 'board');
  doneUrl.searchParams.set('showDone', '1');
  await page.goto(doneUrl.toString(), { waitUntil: 'networkidle' });
  await expect(page.locator('.card', { hasText: 'NoPrice Co' }).first()).toContainText('no price');
  await expect(page.locator('.panel.is-open .dp-stat--price')).toContainText('No price yet');

  // ── The panel's inline Set price works on the completed booking ──
  await page.locator('.panel.is-open').getByRole('button', { name: 'Set price' }).click();
  await page.locator('.panel.is-open .dp-stat--price .money input').fill('250');
  await page
    .locator('.panel.is-open .dp-stat--price')
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.locator('.toast')).toContainText(/Contract price set/i);

  await openBookingPanel(page, 'Priceless');
  const pricedUrl = new URL(page.url());
  pricedUrl.searchParams.set('layout', 'board');
  pricedUrl.searchParams.set('showDone', '1');
  await page.goto(pricedUrl.toString(), { waitUntil: 'networkidle' });
  await expect(page.locator('.panel.is-open .dp-stat--price')).toContainText('£250');
  await expect(page.locator('.panel.is-open .dp-stat--price')).not.toContainText('No price yet');
  await expect(page.locator('.card', { hasText: 'NoPrice Co' }).first()).not.toContainText(
    'no price',
  );

  // ── Priced now: the "No price" saved view is empty again ──
  await page.goto('/dashboard?savedView=no_price', { waitUntil: 'networkidle' });
  await expect(page.locator('.page-head__sub')).toContainText('0 tickets');
  await expect(page.locator('.rail__item', { hasText: 'No price' })).toContainText('0');
});
