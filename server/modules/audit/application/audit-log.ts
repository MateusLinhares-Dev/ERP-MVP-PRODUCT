import type { Database } from 'firebase-admin/database';

export interface AuditLogQuery {
  limit?: unknown;
  cursor?: unknown;
  module?: unknown;
  level?: unknown;
  actor?: unknown;
  term?: unknown;
  from?: unknown;
  to?: unknown;
}

type AuditRow = Record<string, unknown>;

const str = (value: unknown, max = 120): string =>
  String(value || '')
    .trim()
    .slice(0, max);

const severity = (row: AuditRow): string =>
  str(row.level || (row.outcome === 'failed' ? 'error' : 'info'), 20).toLowerCase();

const timestamp = (row: AuditRow): number =>
  typeof row.ts === 'number' ? row.ts : Date.parse(String(row.at || row.ts || '')) || 0;

export async function queryAuditLog(db: Pick<Database, 'ref'>, query: AuditLogQuery) {
  const size = Math.min(100, Math.max(10, Number.parseInt(String(query.limit), 10) || 50));
  const limit = Math.min(300, Math.max(size, size * 3));
  const cursorText = String(query.cursor || '');
  const cursor = /^[A-Za-z0-9_-]{4,120}$/.test(cursorText) ? cursorText : null;
  let ordered = db.ref('erpAudit').orderByKey();
  if (cursor) ordered = ordered.endAt(cursor);
  const values: unknown = (await ordered.limitToLast(limit + (cursor ? 2 : 1)).get()).val();
  let pairs = Object.entries(
    values && typeof values === 'object' ? (values as Record<string, unknown>) : {},
  ).sort(([a], [b]) => b.localeCompare(a));
  if (cursor) pairs = pairs.filter(([id]) => id < cursor);
  const hasMore = pairs.length > limit;
  const page = pairs.slice(0, limit);
  const module = str(query.module, 64).toLowerCase();
  const level = str(query.level, 20).toLowerCase();
  const actor = str(query.actor, 80).toLowerCase();
  const term = str(query.term, 80).toLowerCase();
  const from = Number(query.from || 0);
  const to = Number(query.to || 0);
  const events = page
    .filter((entry): entry is [string, AuditRow] => Boolean(entry[1]) && typeof entry[1] === 'object')
    .filter(([, row]) => {
      const when = timestamp(row);
      if (module && !str(row.module, 64).toLowerCase().includes(module)) return false;
      if (level && severity(row) !== level) return false;
      if (actor && !str(row.actorLogin, 80).toLowerCase().includes(actor)) return false;
      if (Number.isFinite(from) && from > 0 && when < from) return false;
      if (Number.isFinite(to) && to > 0 && when > to) return false;
      return (
        !term ||
        [row.action, row.entityType, row.entityId, row.scope, row.code, row.module, row.event].some((value) =>
          str(value, 240).toLowerCase().includes(term),
        )
      );
    })
    .slice(0, size)
    .map(([id, row]) => ({
      id,
      ts: row.ts || row.at || 0,
      actorLogin: str(row.actorLogin, 80),
      module: str(row.module, 64),
      action: str(row.action, 64),
      entityType: str(row.entityType, 64),
      entityId: str(row.entityId, 128),
      scope: str(row.scope, 240),
      source: str(row.source, 32),
      level: str(row.level || (row.outcome === 'failed' ? 'error' : 'info'), 16),
      outcome: str(row.outcome || 'success', 32),
      code: str(row.code, 80),
    }));
  const last = page[page.length - 1];
  return {
    events,
    nextCursor: hasMore && last ? last[0] : null,
    scanned: page.length,
    limit: size,
    filterApplied: Boolean(module || level || actor || term || from || to),
  };
}
