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

// Atlassian Design System letter-avatar palette (background / foreground).
const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#FFECEB', fg: '#AE2A19' }, // red
  { bg: '#FFF7D6', fg: '#946F00' }, // yellow
  { bg: '#DCFFF1', fg: '#216E4E' }, // green
  { bg: '#E9F2FF', fg: '#0055CC' }, // blue
  { bg: '#F3F0FF', fg: '#5E4DB2' }, // purple
  { bg: '#E7F9FF', fg: '#206A83' }, // teal
  { bg: '#FFF3D6', fg: '#974F0C' }, // orange
  { bg: '#FFECF8', fg: '#943D73' }, // magenta
];

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}

const FALLBACK_COLOR = { bg: '#E9F2FF', fg: '#0055CC' };

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
