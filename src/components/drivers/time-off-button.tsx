'use client';

import {
  clearDriverTimeOffAction,
  setDriverTimeOffAction,
} from '@/app/(dashboard)/dashboard/drivers/actions';
import { Icon } from '@/components/console/icons';
import { Lozenge } from '@/components/console/lozenge';
import { useEffect, useState, useTransition } from 'react';

interface TimeOffEntry {
  id: string;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
}

interface TimeOffButtonProps {
  driverId: string;
  driverName: string;
  /** Upcoming time-off ranges for this driver — ends today or later. */
  upcoming: TimeOffEntry[];
  /** Today in London, ISO date string. Used as the minimum selectable date. */
  todayLondon: string;
}

function fmtRange(startsOn: string, endsOn: string): string {
  if (startsOn === endsOn) return formatShortDay(startsOn);
  return `${formatShortDay(startsOn)} – ${formatShortDay(endsOn)}`;
}

function formatShortDay(iso: string): string {
  // "2026-06-04" → "Thu 4 Jun" using London timezone (date-only string, no DST risk)
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * Per-row action on the drivers page. Opens a small modal that lists any
 * upcoming time-off for the driver (with one-click Clear) and lets the
 * operator add a new whole-day range. No reason field — decisions baked in
 * the driver-availability shaping doc.
 */
export function TimeOffButton({ driverId, driverName, upcoming, todayLondon }: TimeOffButtonProps) {
  const [open, setOpen] = useState(false);
  const [startsOn, setStartsOn] = useState(todayLondon);
  const [endsOn, setEndsOn] = useState(todayLondon);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setStartsOn(todayLondon);
      setEndsOn(todayLondon);
      setError(null);
    }
  }, [open, todayLondon]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (endsOn < startsOn) {
      setError('End date must be on or after start date.');
      return;
    }
    startTransition(async () => {
      const res = await setDriverTimeOffAction({ driverId, startsOn, endsOn });
      if (!res.ok) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      setOpen(false);
    });
  };

  const onClear = (timeOffId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await clearDriverTimeOffAction(timeOffId);
      if (!res.ok) setError(res.error ?? 'Could not remove.');
    });
  };

  return (
    <>
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        Off…
      </button>

      {open ? (
        <div className="modal is-open" aria-hidden={false}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc + close button cover keyboard */}
          <div className="modal__scrim" onClick={() => setOpen(false)} />
          {/* biome-ignore lint/a11y/useSemanticElements: styled dialog surface; native <dialog> conflicts with the design CSS */}
          <div className="modal__card" style={{ width: 480 }} role="dialog" aria-modal="true">
            <header className="modal__head">
              <div className="row">
                <div>
                  <div className="modal__title">Time off — {driverName}</div>
                  <div className="modal__sub">
                    Whole days only. Driver is excluded from dispatch on these dates.
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
                  <Icon.Close />
                </button>
              </div>
            </header>

            <div className="modal__body">
              {error ? (
                <div className="ic ic--danger" style={{ marginBottom: 10 }}>
                  <div className="ic__body">{error}</div>
                </div>
              ) : null}

              {upcoming.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                    Upcoming time off
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {upcoming.map((t) => (
                      <li
                        key={t.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <Lozenge tone="orange">OFF</Lozenge>
                        <span>{fmtRange(t.startsOn, t.endsOn)}</span>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => onClear(t.id)}
                          disabled={isPending}
                        >
                          Clear
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <form onSubmit={onSubmit}>
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                  Add time off
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>From</div>
                    <input
                      className="input"
                      type="date"
                      value={startsOn}
                      min={todayLondon}
                      onChange={(e) => {
                        setStartsOn(e.target.value);
                        if (endsOn < e.target.value) setEndsOn(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>To</div>
                    <input
                      className="input"
                      type="date"
                      value={endsOn}
                      min={startsOn}
                      onChange={(e) => setEndsOn(e.target.value)}
                      required
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ flex: 1 }}
                    onClick={() => setOpen(false)}
                    disabled={isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    style={{ flex: 1 }}
                    disabled={isPending}
                  >
                    {isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
