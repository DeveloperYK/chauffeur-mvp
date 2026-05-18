import type { Database } from '@/server/db';
import { type ActorType, auditEvents } from '@/server/db/schema';

export interface AuditEventInput {
  actorType: ActorType;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
}

export async function recordAuditEvent(db: Database, input: AuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: input.actorType,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
