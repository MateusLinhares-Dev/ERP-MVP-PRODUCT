export interface AuditEvent {
  ts: number;
  level: string;
  module: string;
  action: string;
  actorLogin: string;
  source: string;
  entityType?: string;
  entityId?: string;
  code?: string;
}

export interface LogFilters {
  module?: string;
  level?: string;
  actor?: string;
  term?: string;
  from?: string;
  to?: string;
}

export const LOG_PAGE_SIZE = 50;
export const LOG_LEVELS: readonly string[] = ['error', 'warn', 'info'];
const CSV_COLUMNS = [
  'ts',
  'level',
  'module',
  'action',
  'actorLogin',
  'source',
  'entityType',
  'entityId',
  'code',
] as const;
const DATE_FILTERS = new Set(['from', 'to']);

export function logsQuery(filters: LogFilters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(LOG_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    params.set(key, DATE_FILTERS.has(key) ? String(new Date(String(value)).getTime()) : String(value));
  }
  return params.toString();
}

export function eventIdentification(event: AuditEvent): string {
  return [event.entityType, event.entityId, event.code].filter(Boolean).join(' / ');
}

export function auditEvents(raw: unknown): {
  events: AuditEvent[];
  nextCursor: string | null;
  scanned: number;
} {
  const data =
    raw && typeof raw === 'object'
      ? (raw as { events?: unknown; nextCursor?: unknown; scanned?: unknown })
      : {};
  return {
    events: Array.isArray(data.events) ? (data.events as AuditEvent[]) : [],
    nextCursor: typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null,
    scanned: Number(data.scanned) || 0,
  };
}

export function logsHint(found: number, scanned: number, hasMore: boolean): string {
  if (found) return `${found} evento(s) exibido(s) · ${scanned} registro(s) analisado(s).`;
  if (hasMore)
    return `Nenhum evento nos ${scanned} registros mais recentes analisados. Toque em Próxima para continuar procurando.`;
  return `Nenhum evento encontrado em ${scanned} registro(s).`;
}

function csvCell(value: unknown): string {
  return (
    '"' +
    String(value ?? '')
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"'
  );
}

export function logsCsv(events: readonly AuditEvent[]): string {
  const lines = [
    CSV_COLUMNS.join(';'),
    ...events.map((event) => CSV_COLUMNS.map((key) => csvCell(event[key])).join(';')),
  ];
  return '﻿' + lines.join('\r\n');
}
