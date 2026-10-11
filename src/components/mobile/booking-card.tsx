import { Icon } from '@/components/console/icons';
import { StateLozenge } from '@/components/console/lozenge';
import type { ConsoleBooking, ConsoleDriver } from '@/components/console/types';
import { attentionReason } from '@/lib/mobile-sections';
import Link from 'next/link';
import { mDay, mTime } from './format';

interface BookingCardProps {
  booking: ConsoleBooking;
  driver: ConsoleDriver | undefined;
  /** Attention list spans days, so each card says which day it is. */
  showDay?: boolean;
}

function who(b: ConsoleBooking): string {
  return `${b.passengerFirstName}${b.passengerLastName ? ` ${b.passengerLastName}` : ''}`;
}

function driverLine(b: ConsoleBooking, driver: ConsoleDriver | undefined): string | null {
  if (driver) return `${driver.name} · ${driver.carColour} ${driver.car}`;
  if (b.isBackfill && b.backfillDriverName) return `${b.backfillDriverName} (backfill)`;
  return null;
}

export function BookingCard({ booking: b, driver, showDay = false }: BookingCardProps) {
  const flag = attentionReason(b);
  const done = b.state === 'completed' || b.state === 'cancelled';
  const drv = driverLine(b, driver);
  return (
    <Link
      className={`m-card ${flag ? 'm-card--hot' : ''} ${done ? 'm-card--done' : ''}`}
      href={`/m/b/${b.id}`}
      prefetch={false}
      data-booking-id={b.id}
    >
      <div className="m-card__time">
        {mTime(b.pickupAt)}
        {showDay ? <small>{mDay(b.pickupAt)}</small> : null}
      </div>
      <div className="m-card__body">
        <div className="m-card__head">
          <span className="m-card__name">{who(b)}</span>
          <StateLozenge state={b.state} />
        </div>
        {b.clientName ? <div className="m-card__meta">{b.clientName}</div> : null}
        <div className="m-card__route">
          <span>{b.pickupAddress}</span>
          <span>
            <Icon.ArrowRight />
            {b.dropoffAddress || 'As directed'}
          </span>
        </div>
        {flag ? <div className="m-card__flag">{flag}</div> : null}
        {!flag && drv ? <div className="m-card__driver">{drv}</div> : null}
      </div>
    </Link>
  );
}
