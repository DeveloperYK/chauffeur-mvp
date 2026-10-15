import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * A migrated, empty PGlite data directory saved to disk once per test run.
 *
 * Booting a fresh PGlite (initdb) costs ~400 ms; applying the migrations on
 * top costs ~25 ms; booting from a saved data dir costs ~90 ms. With ~50 test
 * files each booting their own database, the template cuts the suite's
 * dominant fixed cost by ~75% (ADR 0022). The file is keyed by the migration
 * SQL and the PGlite version, so a new migration invalidates it automatically.
 */

export const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');
const CACHE_DIR = join(process.cwd(), 'node_modules', '.cache', 'pglite-template');

let cachedSql: string | undefined;

/** All migration files, in order, as one script PGlite can `exec`. */
export function loadMigrationsSql(dir: string = MIGRATIONS_DIR): string {
  if (dir === MIGRATIONS_DIR && cachedSql) return cachedSql;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sql = files
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
    // Drizzle separates statements with this marker; PGlite's exec just wants
    // plain semicolon-terminated SQL.
    .replace(/--> statement-breakpoint/g, '');
  if (dir === MIGRATIONS_DIR) cachedSql = sql;
  return sql;
}

/** Cache key: changes whenever the schema SQL or the PGlite build changes. */
export function templateKey(sql: string, pgliteVersion: string): string {
  return createHash('sha256')
    .update(pgliteVersion)
    .update('\n')
    .update(sql)
    .digest('hex')
    .slice(0, 16);
}

function pgliteVersion(): string {
  const pkg = JSON.parse(
    readFileSync(
      join(process.cwd(), 'node_modules', '@electric-sql', 'pglite', 'package.json'),
      'utf8',
    ),
  ) as { version: string };
  return pkg.version;
}

export function templatePath(sql: string = loadMigrationsSql()): string {
  return join(CACHE_DIR, `template-${templateKey(sql, pgliteVersion())}.tar`);
}

/** Boot a blank PGlite, run every migration, and save its data dir to `path`. */
export async function buildTemplate(sql: string, path: string): Promise<void> {
  const client = new PGlite();
  try {
    await client.exec(sql);
    const dump = await client.dumpDataDir('none');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, Buffer.from(await dump.arrayBuffer()));
  } finally {
    await client.close();
  }
}

/** The saved data dir as a Blob PGlite can load, or undefined if not built. */
export function loadTemplate(path: string): Blob | undefined {
  if (!existsSync(path)) return undefined;
  return new Blob([readFileSync(path)]);
}

/** Build the template unless an up-to-date one already exists. */
export async function ensureTemplate(): Promise<string> {
  const sql = loadMigrationsSql();
  const path = templatePath(sql);
  if (!existsSync(path)) await buildTemplate(sql, path);
  return path;
}
