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

const BATCH_SIZE = 300;
const MAX_SCANNED = 6000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{4,120}$/;

interface Filters {
  module: string;
  level: string;
  actor: string;
  term: string;
  from: number;
  to: number;
}

function filtersOf(query: AuditLogQuery): Filters {
  return {
    module: str(query.module, 64).toLowerCase(),
    level: str(query.level, 20).toLowerCase(),
    actor: str(query.actor, 80).toLowerCase(),
    term: str(query.term, 80).toLowerCase(),
    from: Number(query.from || 0),
    to: Number(query.to || 0),
  };
}

function matches(row: AuditRow, filters: Filters): boolean {
  const when = timestamp(row);
  if (filters.module && !str(row.module, 64).toLowerCase().includes(filters.module)) return false;
  if (filters.level && severity(row) !== filters.level) return false;
  if (filters.actor && !str(row.actorLogin, 80).toLowerCase().includes(filters.actor)) return false;
  if (Number.isFinite(filters.from) && filters.from > 0 && when < filters.from) return false;
  if (Number.isFinite(filters.to) && filters.to > 0 && when > filters.to) return false;
  return (
    !filters.term ||
    [row.action, row.entityType, row.entityId, row.scope, row.code, row.module, row.event].some((value) =>
      str(value, 240).toLowerCase().includes(filters.term),
    )
  );
}

async function olderThan(db: Pick<Database, 'ref'>, cursor: string | null): Promise<[string, unknown][]> {
  let ordered = db.ref('erpAudit').orderByKey();
  if (cursor) ordered = ordered.endAt(cursor);
  const values: unknown = (await ordered.limitToLast(BATCH_SIZE + (cursor ? 1 : 0)).get()).val();
  const pairs = Object.entries(
    values && typeof values === 'object' ? (values as Record<string, unknown>) : {},
  );
  return pairs.filter(([id]) => !cursor || id < cursor).sort(([a], [b]) => b.localeCompare(a));
}

function present(id: string, row: AuditRow) {
  return {
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
  };
}

export async function queryAuditLog(db: Pick<Database, 'ref'>, query: AuditLogQuery) {
  const size = Math.min(100, Math.max(10, Number.parseInt(String(query.limit), 10) || 50));
  const cursorText = String(query.cursor || '');
  let cursor = KEY_PATTERN.test(cursorText) ? cursorText : null;
  const filters = filtersOf(query);
  const found: [string, AuditRow][] = [];
  let scanned = 0;
  let exhausted = false;
  while (found.length < size && scanned < MAX_SCANNED) {
    const batch = await olderThan(db, cursor);
    if (!batch.length) {
      exhausted = true;
      break;
    }
    for (const [id, raw] of batch) {
      scanned++;
      cursor = id;
      if (raw && typeof raw === 'object' && matches(raw as AuditRow, filters))
        found.push([id, raw as AuditRow]);
      if (found.length >= size || scanned >= MAX_SCANNED) break;
    }
    if (batch.length < BATCH_SIZE && cursor === batch[batch.length - 1]?.[0]) {
      exhausted = true;
      break;
    }
  }
  const events = found
    .map(([id, row]) => present(id, row))
    .sort((a, b) => timestamp(b as AuditRow) - timestamp(a as AuditRow));
  return {
    events,
    nextCursor: exhausted ? null : cursor,
    scanned,
    limit: size,
    filterApplied: Boolean(
      filters.module || filters.level || filters.actor || filters.term || filters.from || filters.to,
    ),
  };
}
