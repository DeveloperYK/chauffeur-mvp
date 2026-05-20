import { cn } from '@/lib/cn';

/**
 * Atlassian-style initials avatar.
 *
 * - Circular, initials when no photo (we have no photos), deterministic
 *   background colour derived from a stable key (operator id).
 * - `title` carries the full name for the native hover tooltip, matching
 *   Jira's behaviour where hovering an avatar shows the display name.
 */

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<AvatarSize, string> = {
  sm: 'h-6 w-6 text-2xs',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

// Saturated, high-contrast avatar palette — white initials on a vivid
// background so each person is instantly distinguishable. Colour is assigned
// deterministically per operator (stable across renders), not re-randomised.
const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#DE350B', fg: '#FFFFFF' }, // red
  { bg: '#E56910', fg: '#FFFFFF' }, // orange
  { bg: '#FF991F', fg: '#172B4D' }, // amber
  { bg: '#00875A', fg: '#FFFFFF' }, // green
  { bg: '#00A3BF', fg: '#FFFFFF' }, // teal
  { bg: '#0052CC', fg: '#FFFFFF' }, // blue
  { bg: '#2684FF', fg: '#FFFFFF' }, // sky
  { bg: '#5243AA', fg: '#FFFFFF' }, // purple
  { bg: '#403294', fg: '#FFFFFF' }, // deep purple
  { bg: '#C1326B', fg: '#FFFFFF' }, // magenta
  { bg: '#8777D9', fg: '#FFFFFF' }, // lavender
  { bg: '#057ABF', fg: '#FFFFFF' }, // ocean
];

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}

const FALLBACK_COLOR = { bg: '#0052CC', fg: '#FFFFFF' };

function colorFor(key: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx] ?? FALLBACK_COLOR;
}

interface AvatarProps {
  name: string;
  /** Stable key for the colour (operator id). Falls back to name. */
  colorKey?: string;
  size?: AvatarSize;
  /** Draw a selection ring (used by the board facepile filter). */
  selected?: boolean;
  className?: string;
}

export function Avatar({ name, colorKey, size = 'md', selected, className }: AvatarProps) {
  const { bg, fg } = colorFor(colorKey ?? name);
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full font-semibold ring-2 ring-surface',
        SIZE_PX[size],
        selected && 'outline outline-2 outline-brand-500',
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
    >
      {initialsFromName(name)}
    </span>
  );
}

/** Generic "unassigned" avatar — a neutral person glyph, matching Jira's
 *  grey default-assignee avatar. */
export function UnassignedAvatar({
  size = 'md',
  selected,
  className,
}: {
  size?: AvatarSize;
  selected?: boolean;
  className?: string;
}) {
  return (
    <span
      title="Unassigned"
      aria-label="Unassigned"
      className={cn(
        'inline-flex select-none items-center justify-center rounded-full bg-neutral-200 text-neutral-500 ring-2 ring-surface',
        SIZE_PX[size],
        selected && 'outline outline-2 outline-brand-500',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" fill="currentColor" role="img">
        <title>Unassigned</title>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.314 0-8 1.667-8 5v1h16v-1c0-3.333-4.686-5-8-5Z" />
      </svg>
    </span>
  );
}
