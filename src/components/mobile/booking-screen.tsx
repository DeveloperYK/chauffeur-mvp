'use client';
import {
  approveBookingAction,
  rejectBookingAction,
  releaseDriverAction,
  undoCancelAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { CancelModal } from '@/components/console/cancel-modal';
import { DispatchModal } from '@/components/console/dispatch-modal';
import { EditBookingModal } from '@/components/console/edit-booking-modal';
import { fmtPrice, passengerName } from '@/components/console/format';
import { Icon } from '@/components/console/icons';
import { StateLozenge } from '@/components/console/lozenge';
import type { ConsoleBooking, ConsoleDriver } from '@/components/console/types';
import { useAutoRefresh } from '@/components/console/use-auto-refresh';
import { bookingRef } from '@/lib/booking-ref';
import { carDescription } from '@/lib/labels';
import {
  type MobileAction,
  type MobileActionKind,
  dialable,
  mobileActionsFor,
} from '@/lib/mobile-actions';
import { attentionReason } from '@/lib/mobile-sections';
import { UNDO_CANCEL_WINDOW_MS } from '@/lib/undo-window';
import type { BookingView } from '@/server/services/console-view';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { mDayLong, mDuration, mTime } from './format';
import { useToasts } from './use-toasts';

interface BookingScreenProps {
  view: BookingView;
  me: { id: string; name: string };
}

const TONE_CLASS: Record<MobileAction['tone'], string> = {
  primary: 'm-btn--primary',
  default: '',
  danger: 'm-btn--danger',
  success: 'm-btn--success',
};

const ICON: Record<MobileActionKind, () => React.ReactNode> = {
  dispatch: () => <Icon.Search />,
  edit: () => <Icon.Pencil />,
  cancel: () => <Icon.Close />,
  approve: () => <Icon.Check />,
  reject: () => <Icon.Reset />,
  release: () => <Icon.Reset />,
  call: () => <Icon.Phone />,
  whatsapp: () => <Icon.Whatsapp />,
  sms_passenger: () => <Icon.Send />,
};

// Server-side, one-shot actions with no undo. On a touch screen a stray tap is
// easy, so the first tap arms the button and the second runs it.
const CONFIRM_KINDS: ReadonlySet<MobileActionKind> = new Set(['approve', 'reject', 'release']);
const CONFIRM_LABEL: Partial<Record<MobileActionKind, string>> = {
  approve: 'Tap again to approve',
  reject: 'Tap again to reject',
  release: 'Tap again to unassign',
};
const CONFIRM_TIMEOUT_MS = 4000;

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="m-fact">
      <div className="m-fact__k">{k}</div>
      <div className="m-fact__v">{children}</div>
    </div>
  );
}

function driverContact(
  b: ConsoleBooking,
  driver: ConsoleDriver | undefined,
): { name: string; phone: string } | null {
  if (driver) return { name: driver.name, phone: driver.whatsappNumber };
  if (b.isBackfill && b.backfillDriverName && b.backfillDriverPhone) {
    return { name: b.backfillDriverName, phone: b.backfillDriverPhone };
  }
  return null;
}

export function BookingScreen({ view, me }: BookingScreenProps) {
  const router = useRouter();
  const b = view.booking;
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<MobileActionKind | null>(null);
  const [isPending, startTransition] = useTransition();
  const { push, dismiss, stack } = useToasts();
  // An armed button disarms itself if the second tap does not come.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [armed]);
  useAutoRefresh(dispatchOpen || editOpen || cancelOpen);

  const driver = useMemo(
    () => (b.assignedDriverId ? view.drivers.find((d) => d.id === b.assignedDriverId) : undefined),
    [b.assignedDriverId, view.drivers],
  );
  const contact = driverContact(b, driver);
  const actions = mobileActionsFor(
    {
      state: b.state,
      isBackfill: b.isBackfill,
      openOfferCount: b.openOffers.length,
      passengerName: passengerName(b),
      execMobile: b.execMobile,
    },
    contact,
  );
  const flag = attentionReason(b);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          setError(result.error ?? 'Something went wrong.');
          return;
        }
        push(okText);
      } catch {
        // A dropped connection mid-tap: the action may or may not have landed,
        // so refresh to show the truth rather than guess.
        setError('Could not reach the server. Check the booking and try again.');
      }
      router.refresh();
    });
  };

  const onAction = (kind: MobileActionKind) => {
    if (CONFIRM_KINDS.has(kind) && armed !== kind) {
      setArmed(kind);
      return;
    }
    setArmed(null);
    switch (kind) {
      case 'dispatch':
        return setDispatchOpen(true);
      case 'edit':
        return setEditOpen(true);
      case 'cancel':
        return setCancelOpen(true);
      case 'approve':
        return run(() => approveBookingAction(b.id), 'Trip approved & completed.');
      case 'reject':
        return run(() => rejectBookingAction(b.id), 'Form rejected — driver to resubmit.');
      case 'release':
        return run(
          () => releaseDriverAction(b.id),
          'Driver released — booking back in the queue to reassign.',
        );
      default:
        return undefined;
    }
  };

  const undoCancel = (toastId: string) => {
    dismiss(toastId);
    startTransition(async () => {
      try {
        const result = await undoCancelAction(b.id);
        push(result.ok ? 'Cancellation undone.' : (result.error ?? 'Could not undo.'));
      } catch {
        setError('Could not reach the server. Check the booking and try again.');
      }
      router.refresh();
    });
  };

  const renderAction = (a: MobileAction) => {
    const cls = `m-btn ${TONE_CLASS[a.tone]} ${a.primary ? 'm-btn--lg' : ''}`;
    if (a.href) {
      const external = a.href.startsWith('http');
      return (
        <a
          key={a.kind}
          className={cls}
          href={a.href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {ICON[a.kind]()} {a.label}
        </a>
      );
    }
    const isArmed = armed === a.kind;
    return (
      <button
        key={a.kind}
        type="button"
        className={`${cls} ${isArmed ? 'm-btn--armed' : ''}`}
        onClick={() => onAction(a.kind)}
        disabled={isPending}
        aria-live={isArmed ? 'polite' : undefined}
      >
        {ICON[a.kind]()} {isArmed ? (CONFIRM_LABEL[a.kind] ?? a.label) : a.label}
      </button>
    );
  };

  return (
    <>
      <div className="m-screen">
        <section className="m-hero">
          <div className="m-hero__row">
            <StateLozenge state={b.state} lg />
            <span className="m-hero__ref">{bookingRef(b.seq)}</span>
          </div>
          <div className="m-hero__when">
            {mTime(b.pickupAt)}
            <small>{mDayLong(b.pickupAt)}</small>
          </div>
          <div className="m-hero__who">{passengerName(b)}</div>
          {b.clientName ? <div className="m-hero__sub">{b.clientName}</div> : null}
          {flag ? (
            <div className="m-flag">
              <Icon.Flag /> {flag}
            </div>
          ) : null}
        </section>

        {actions.length > 0 ? (
          <section className="m-actions" aria-label="Actions">
            {error ? (
              <div className="m-actions__err" role="alert">
                {error}
              </div>
            ) : null}
            {actions.map(renderAction)}
          </section>
        ) : null}

        <section className="m-facts" aria-label="Trip">
          <div className="m-facts__title">Trip</div>
          <div className="m-route">
            <span className="m-route__dot" />
            <div>
              <div className="m-route__k">Pickup</div>
              {b.pickupAddress}
            </div>
            {b.dropoffAddress ? (
              <>
                <span className="m-route__line" />
                <span />
                <span className="m-route__dot m-route__dot--end" />
                <div>
                  <div className="m-route__k">Drop-off</div>
                  {b.dropoffAddress}
                </div>
              </>
            ) : null}
          </div>
          <Fact k="Duration">{mDuration(b.expectedDurationMinutes, b.serviceType)}</Fact>
          {b.requestedCarType ? <Fact k="Car type">{b.requestedCarType}</Fact> : null}
          {b.travelMode && b.travelRef ? (
            <Fact k={b.travelMode === 'flight' ? 'Flight' : 'Train'}>
              <span className="mono">{b.travelRef}</span>
            </Fact>
          ) : null}
          {b.notes ? <Fact k="Driver notes">{b.notes}</Fact> : null}
        </section>

        <section className="m-facts" aria-label="Driver">
          <div className="m-facts__title">Driver</div>
          {driver ? (
            <>
              <Fact k="Driver">{driver.name}</Fact>
              <Fact k="Car">{carDescription(driver.car, driver.carColour)}</Fact>
              <Fact k="Phone">
                <a href={`tel:${dialable(driver.whatsappNumber)}`}>{driver.whatsappNumber}</a>
              </Fact>
            </>
          ) : b.isBackfill ? (
            <>
              <Fact k="Backfill">{b.backfillDriverName ?? '—'}</Fact>
              {b.backfillCar ? <Fact k="Car">{b.backfillCar}</Fact> : null}
              {b.backfillDriverPhone ? (
                <Fact k="Phone">
                  <a href={`tel:${dialable(b.backfillDriverPhone)}`}>{b.backfillDriverPhone}</a>
                </Fact>
              ) : null}
            </>
          ) : (
            <Fact k="Driver">Not yet assigned</Fact>
          )}
        </section>

        <section className="m-facts" aria-label="People">
          <div className="m-facts__title">People</div>
          <Fact k="Passenger">
            {passengerName(b)}
            {b.execMobile ? (
              <>
                <br />
                <a href={`tel:${dialable(b.execMobile)}`}>{b.execMobile}</a>
              </>
            ) : null}
          </Fact>
          {b.clientName ? <Fact k="Account">{b.clientName}</Fact> : null}
          {b.caseCode ? (
            <Fact k="Case code">
              <span className="mono">{b.caseCode}</span>
            </Fact>
          ) : null}
          {b.bookedByName ? (
            <Fact k="Booked by">
              {b.bookedByName}
              {b.bookedByPhone ? (
                <>
                  <br />
                  <a href={`tel:${dialable(b.bookedByPhone)}`}>{b.bookedByPhone}</a>
                </>
              ) : null}
            </Fact>
          ) : null}
          <Fact k="Operator">
            {view.operators.find((o) => o.id === b.assignedOperatorId)?.name ??
              (b.assignedOperatorId === me.id ? me.name : 'Unassigned')}
          </Fact>
        </section>

        <section className="m-facts" aria-label="Money">
          <div className="m-facts__title">Money</div>
          <Fact k="Price">
            {b.contractPricePence === null ? 'No price yet' : fmtPrice(b.contractPricePence)}
          </Fact>
          {b.operatorNotes ? <Fact k="Private notes">{b.operatorNotes}</Fact> : null}
        </section>

        <a className="m-more" href={`/dashboard?booking=${b.id}&console=desktop`}>
          Backfill hand-off, completion link, exec emails and history are in the full console
        </a>
      </div>

      <DispatchModal
        booking={b}
        drivers={view.drivers}
        assignments={view.assignments}
        isOpen={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        onSent={(summary) => {
          setDispatchOpen(false);
          push(summary);
          router.refresh();
        }}
        mobile
      />
      <EditBookingModal
        booking={b}
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(changed) => {
          setEditOpen(false);
          push(
            changed.length === 0
              ? 'No changes to save.'
              : `Booking updated — ${changed.length} field${changed.length === 1 ? '' : 's'} changed.`,
          );
          router.refresh();
        }}
      />
      <CancelModal
        booking={b}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          const toastId = push('Booking cancelled.', {
            ttlMs: UNDO_CANCEL_WINDOW_MS,
            action: { label: 'Undo', onClick: () => undoCancel(toastId) },
          });
          router.refresh();
        }}
      />
      {stack}
    </>
  );
}
