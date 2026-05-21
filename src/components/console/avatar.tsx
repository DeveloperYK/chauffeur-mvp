// Console avatar — matches the v2 design's `.avatar` (initials, saturated
// per-key colour, surface ring). Colour is stable per operator id.

const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#DE350B', fg: '#FFFFFF' },
  { bg: '#E56910', fg: '#FFFFFF' },
  { bg: '#FF991F', fg: '#172B4D' },
  { bg: '#00875A', fg: '#FFFFFF' },
  { bg: '#00A3BF', fg: '#FFFFFF' },
  { bg: '#0052CC', fg: '#FFFFFF' },
  { bg: '#2684FF', fg: '#FFFFFF' },
  { bg: '#5243AA', fg: '#FFFFFF' },
  { bg: '#403294', fg: '#FFFFFF' },
  { bg: '#C1326B', fg: '#FFFFFF' },
  { bg: '#8777D9', fg: '#FFFFFF' },
  { bg: '#057ABF', fg: '#FFFFFF' },
];

const FALLBACK = { bg: '#0052CC', fg: '#FFFFFF' };

export function avatarInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

function colorForKey(key: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h * 31 + key.charCodeAt(i)) | 0) >>> 0;
  return PALETTE[h % PALETTE.length] ?? FALLBACK;
}

export function Avatar({
  name,
  id,
  size = 26,
  selected = false,
  title,
}: {
  name: string;
  id?: string;
  size?: number;
  selected?: boolean;
  title?: string;
}) {
  const { bg, fg } = colorForKey(id || name || 'x');
  return (
    <span
      className={`avatar ${selected ? 'is-selected' : ''}`}
      title={title || name}
      style={{
        background: bg,
        color: fg,
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.42),
      }}
    >
      {avatarInitials(name || '?')}
    </span>
  );
}

export function UnassignedAvatar({
  size = 26,
  selected = false,
}: { size?: number; selected?: boolean }) {
  return (
    <span
      className={`avatar avatar--unassigned ${selected ? 'is-selected' : ''}`}
      title="Unassigned"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="currentColor"
        role="img"
      >
        <title>Unassigned</title>
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z" />
      </svg>
    </span>
  );
}
