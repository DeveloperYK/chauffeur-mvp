import { cn } from '@/lib/cn';

/**
 * JJ Chauffeuring brand lockup: a gold monogram tile + wordmark. Used on the
 * dark hero panel (`tone="light"`) and the mobile sign-in header (`tone="dark"`).
 * Purely presentational so it renders on the server with no JS.
 */
export function BrandMark({
  tone = 'light',
  size = 'md',
  className,
}: {
  tone?: 'light' | 'dark';
  size?: 'md' | 'lg';
  className?: string;
}) {
  const tile = size === 'lg' ? 'h-12 w-12 rounded-[14px] text-xl' : 'h-10 w-10 rounded-xl text-lg';
  const title = size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        className={cn(
          'relative grid place-items-center bg-gradient-to-br from-[#16284a] to-[#070b16]',
          'shadow-[0_6px_20px_-6px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-[#d8b775]/45',
          tile,
        )}
      >
        <span className="bg-gradient-to-b from-[#f5e8c2] to-[#c49a4a] bg-clip-text font-serif font-bold tracking-tight text-transparent">
          JJ
        </span>
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={cn(
            'font-semibold tracking-tight',
            title,
            tone === 'light' ? 'text-white' : 'text-ink',
          )}
        >
          JJ Chauffeuring
        </span>
        <span
          className={cn(
            'text-[11px] font-medium uppercase tracking-[0.18em]',
            tone === 'light' ? 'text-white/55' : 'text-ink-muted',
          )}
        >
          Operator Console
        </span>
      </span>
    </div>
  );
}
