import { q, type Db } from './db.ts';
import type { User } from './auth.ts';

export function audit(u: User | undefined, action: string, entityType: string, entityId: string | null, summary: string, details?: unknown, db?: Db) {
  return q(
    'insert into audit_logs(user_id, action, entity_type, entity_id, summary, details) values ($1,$2,$3,$4,$5,$6)',
    [u?.id ?? null, action, entityType, entityId, summary, details === undefined ? null : JSON.stringify(details)],
    db,
  );
}
