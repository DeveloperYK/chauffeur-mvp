import type { SVGProps } from 'react';
import { BrandMark } from './brand-mark';

const features = [
  {
    title: 'Live dispatch',
    body: 'Assign drivers and track every job from booking to completion.',
    Icon: CarIcon,
  },
  {
    title: 'Driver status at a glance',
    body: 'See who is free, who is busy, and who is en route in real time.',
    Icon: PinIcon,
  },
  {
    title: 'Backed up by the minute',
    body: 'Every booking mirrored to a secure spreadsheet you always own.',
    Icon: ShieldIcon,
  },
] as const;

/**
 * The dark, premium left-hand panel shown on large screens. Purely decorative
 * and presentational — all motion is CSS, so it renders on the server.
 */
export function LoginHero() {
  return (
    <section className="relative hidden overflow-hidden bg-[#06090f] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0c1733] via-[#0a0f1f] to-[#05070e]" />
      {/* Slowly panning colour wash */}
      <div
        className="absolute inset-0 animate-auth-pan opacity-70 [background-size:200%_200%]"
        style={{
          backgroundImage:
            'radial-gradient(60% 60% at 18% 12%, rgba(29,122,252,0.30), transparent 60%), radial-gradient(55% 55% at 88% 90%, rgba(216,183,117,0.16), transparent 60%)',
        }}
      />
      {/* Floating orbs */}
      <div className="absolute -left-24 top-24 h-72 w-72 animate-auth-float rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -right-16 bottom-10 h-80 w-80 animate-auth-float-slow rounded-full bg-[#d8b775]/12 blur-3xl" />
      {/* Hairline + faint grid */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8b775]/40 to-transparent" />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(80% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 animate-fade-in-up">
        <BrandMark tone="light" size="lg" />
      </div>

      <div className="relative z-10 max-w-md">
        <h1
          className="animate-fade-in-up text-balance text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl"
          style={{ animationDelay: '80ms' }}
        >
          Premium chauffeur dispatch, fully under control.
        </h1>
        <p
          className="mt-4 animate-fade-in-up text-[15px] leading-relaxed text-white/60"
          style={{ animationDelay: '160ms' }}
        >
          The operator console for JJ Chauffeuring — bookings, drivers and billing in one calm,
          dependable place.
        </p>

        <ul className="mt-9 space-y-4">
          {features.map((f, i) => (
            <li
              key={f.title}
              className="group flex animate-fade-in-up items-start gap-3.5"
              style={{ animationDelay: `${240 + i * 90}ms` }}
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-[#e7cf95] transition-colors duration-300 group-hover:border-[#d8b775]/50 group-hover:bg-white/[0.07]">
                <f.Icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white/90">{f.title}</p>
                <p className="text-[13px] leading-relaxed text-white/50">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="relative z-10 flex animate-fade-in-up items-center gap-2 text-xs text-white/40"
        style={{ animationDelay: '520ms' }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success-500 shadow-[0_0_8px] shadow-success-500/70" />
        Secure operator access · authorised users only
      </div>
    </section>
  );
}

function CarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M5 16v2M19 16v2M4 13l1.5-5A2 2 0 0 1 7.4 6.6h9.2A2 2 0 0 1 18.5 8L20 13M3.5 13h17v3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <circle cx="7.5" cy="15" r="0.6" />
      <circle cx="16.5" cy="15" r="0.6" />
    </svg>
  );
}

function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
