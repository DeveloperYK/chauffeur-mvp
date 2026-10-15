import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildTemplate,
  loadMigrationsSql,
  loadTemplate,
  templateKey,
  templatePath,
} from '~test/helpers/pglite-template';

const scratch = mkdtempSync(join(tmpdir(), 'pglite-template-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('templateKey', () => {
  it('is stable for the same SQL and PGlite version', () => {
    expect(templateKey('create table a (id int);', '0.4.5')).toBe(
      templateKey('create table a (id int);', '0.4.5'),
    );
  });

  it('changes when the migration SQL changes', () => {
    expect(templateKey('create table a (id int);', '0.4.5')).not.toBe(
      templateKey('create table a (id int, b text);', '0.4.5'),
    );
  });

  it('changes when the PGlite version changes', () => {
    expect(templateKey('create table a (id int);', '0.4.5')).not.toBe(
      templateKey('create table a (id int);', '0.4.6'),
    );
  });

  it('is short and filename-safe', () => {
    expect(templateKey('x', 'y')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('templatePath', () => {
  it('lives under node_modules/.cache so it is never committed', () => {
    expect(templatePath('select 1')).toContain(join('node_modules', '.cache', 'pglite-template'));
  });

  it('differs for different schema SQL', () => {
    expect(templatePath('select 1')).not.toBe(templatePath('select 2'));
  });
});

describe('loadMigrationsSql', () => {
  it('concatenates .sql files in order and strips drizzle breakpoints', () => {
    const dir = join(scratch, 'migrations');
    mkdirSync(dir);
    writeFileSync(join(dir, '0001_b.sql'), 'create table b (id int);--> statement-breakpoint\n');
    writeFileSync(join(dir, '0000_a.sql'), 'create table a (id int);--> statement-breakpoint\n');
    writeFileSync(join(dir, 'README.md'), 'ignored');
    const sql = loadMigrationsSql(dir);
    expect(sql.indexOf('table a')).toBeLessThan(sql.indexOf('table b'));
    expect(sql).not.toContain('statement-breakpoint');
  });

  it('throws when the directory does not exist', () => {
    expect(() => loadMigrationsSql(join(scratch, 'missing'))).toThrow();
  });
});

describe('loadTemplate', () => {
  it('returns undefined when no template has been built', () => {
    expect(loadTemplate(join(scratch, 'nope.tar'))).toBeUndefined();
  });
});

describe('buildTemplate + loadTemplate', () => {
  it('saves a data dir that boots with the migrations already applied', async () => {
    const path = join(scratch, 'nested', 'dir', 'template.tar');
    await buildTemplate('create table widgets (id int primary key, name text);', path);
    expect(existsSync(path)).toBe(true);

    const blob = loadTemplate(path);
    if (!blob) throw new Error('template not written');
    const client = new PGlite({ loadDataDir: blob });
    try {
      await client.query("insert into widgets values (1, 'w')");
      const rows = await client.query<{ name: string }>('select name from widgets');
      expect(rows.rows).toEqual([{ name: 'w' }]);
    } finally {
      await client.close();
    }
  });

  it('rejects invalid migration SQL instead of writing a broken template', async () => {
    const path = join(scratch, 'broken.tar');
    await expect(buildTemplate('create tabel oops;', path)).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });
});
