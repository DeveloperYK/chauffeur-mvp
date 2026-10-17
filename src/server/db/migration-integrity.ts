/**
 * Structural checks on the hand-authored drizzle migrations folder.
 *
 * Pure: takes a directory listing and the parsed `_journal.json` entries and
 * returns every inconsistency it can find. Exercised by
 * `tests/unit/db/migration-integrity.test.ts`, which runs it against the real
 * `drizzle/` folder on every `pnpm test`, so a branch that collides with
 * another session's migration fails before it reaches main (ADR 0024).
 */

export type JournalEntry = {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
};

export type MigrationIntegrityResult = {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<string>;
};

const SQL_SUFFIX = '.sql';
const TAG_PATTERN = /^(\d{4})_/;

const numberPrefix = (name: string): string | null => TAG_PATTERN.exec(name)?.[1] ?? null;

const sqlTags = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.filter((f) => f.endsWith(SQL_SUFFIX)).map((f) => f.slice(0, -SQL_SUFFIX.length));

const fileJournalMismatches = (
  tags: ReadonlyArray<string>,
  journal: ReadonlyArray<JournalEntry>,
): ReadonlyArray<string> => {
  const journalTags = new Set(journal.map((e) => e.tag));
  const fileTags = new Set(tags);
  return [
    ...tags.filter((t) => !journalTags.has(t)).map((t) => `${t}${SQL_SUFFIX} has no journal entry`),
    ...journal
      .filter((e) => !fileTags.has(e.tag))
      .map((e) => `journal entry ${e.tag} has no SQL file`),
  ];
};

const duplicateNumbers = (tags: ReadonlyArray<string>): ReadonlyArray<string> => {
  const byNumber = tags.reduce<ReadonlyMap<string, ReadonlyArray<string>>>((acc, tag) => {
    const n = numberPrefix(tag);
    if (n === null) return acc;
    return new Map(acc).set(n, [...(acc.get(n) ?? []), tag]);
  }, new Map());
  return [...byNumber.entries()]
    .filter(([, names]) => names.length > 1)
    .map(
      ([n, names]) =>
        `migration number ${n} is used by ${names.length} files (${names.join(', ')}) — renumber the newer one`,
    );
};

const journalEntryIssues = (
  entry: JournalEntry,
  position: number,
  previous: JournalEntry | undefined,
): ReadonlyArray<string> => {
  const prefix = numberPrefix(entry.tag);
  const expectedPrefix = String(position).padStart(4, '0');
  return [
    ...(entry.idx !== position ? [`journal has idx ${entry.idx} at position ${position}`] : []),
    ...(prefix === null ? [`journal tag ${entry.tag} is not of the form NNNN_name`] : []),
    ...(prefix !== null && prefix !== expectedPrefix
      ? [
          `journal tag ${entry.tag} is at idx ${position}; its number prefix should be ${expectedPrefix}`,
        ]
      : []),
    ...(previous !== undefined && entry.when <= previous.when
      ? [
          `journal entry ${entry.tag}: \`when\` ${entry.when} is not greater than the previous entry's ${previous.when} — the migrator would skip it`,
        ]
      : []),
  ];
};

export const checkMigrationIntegrity = (
  files: ReadonlyArray<string>,
  journal: ReadonlyArray<JournalEntry>,
): MigrationIntegrityResult => {
  const tags = sqlTags(files);
  const issues = [
    ...fileJournalMismatches(tags, journal),
    ...duplicateNumbers(tags),
    ...journal.flatMap((entry, i) => journalEntryIssues(entry, i, journal[i - 1])),
  ];
  return { ok: issues.length === 0, issues };
};
