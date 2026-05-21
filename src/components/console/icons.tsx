import type { SVGProps } from 'react';

// Minimal inline icon set for the console. Stroke-based, 24px viewBox.
const base = (props: SVGProps<SVGSVGElement>) => ({
  className: `icon ${props.className ?? ''}`.trim(),
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const Icon = {
  Search: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  Plus: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Board: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="6" height="10" rx="1" />
    </svg>
  ),
  Calendar: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9h17M8 3v4M16 3v4" />
    </svg>
  ),
  Drivers: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" />
    </svg>
  ),
  Settings: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.3 2.5h4l.3-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </svg>
  ),
  ChevDown: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  ChevLeft: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
  ChevRight: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  Check: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="m5 12 5 5 9-11" />
    </svg>
  ),
  List: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  ),
  ArrowRight: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  Car: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M5 16v2M19 16v2M4 13l1.5-5A2 2 0 0 1 7.4 6.6h9.2A2 2 0 0 1 18.5 8L20 13M3.5 13h17v3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <circle cx="7.5" cy="15" r="0.6" />
      <circle cx="16.5" cy="15" r="0.6" />
    </svg>
  ),
  Flag: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)} fill="currentColor" stroke="none">
      <path d="M5 3a1 1 0 0 0-1 1v17h2v-7h11l-2.5-4L17 6H6V4a1 1 0 0 0-1-1Z" />
    </svg>
  ),
  Close: (p: SVGProps<SVGSVGElement>) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
};
