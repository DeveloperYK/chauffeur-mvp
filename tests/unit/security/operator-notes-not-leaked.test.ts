import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Privacy guard for the operator-only notes field (CLAUDE.md §6).
 *
 * `operator_notes` / `operatorNotes` is private to operators and must NEVER be
 * rendered on the public driver-link route (`/j/[token]`). The driver page is a
 * server component, so only fields it explicitly renders reach the browser —
 * this test fails loudly if a future edit references the private field anywhere
 * under the public route, before it can leak to a driver.
 */
const PUBLIC_DRIVER_ROUTE = join(process.cwd(), 'src/app/j');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('security: operator notes never leak to the driver link page', () => {
  it('the public /j/[token] route references neither operatorNotes nor operator_notes', () => {
    const files = collectFiles(PUBLIC_DRIVER_ROUTE);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('operatorNotes') || src.includes('operator_notes');
    });

    expect(offenders).toEqual([]);
  });
});
