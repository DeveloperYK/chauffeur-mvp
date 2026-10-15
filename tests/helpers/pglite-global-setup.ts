import { ensureTemplate } from './pglite-template';

/**
 * Vitest globalSetup: build the migrated PGlite template once before any
 * worker starts, so every createTestDb() boots from it (see pglite-template.ts).
 */
export default async function setup(): Promise<void> {
  await ensureTemplate();
}
