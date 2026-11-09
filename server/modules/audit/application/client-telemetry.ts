import { createHash } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { replaceControlChars } from '../../../shared/domain/text.js';
import { fail } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import { AuditRepository } from '../infrastructure/audit-repository.js';

const EVENT_KINDS = ['js_error', 'unhandled_rejection', 'api_failure', 'permission_denied'];
const WINDOW_MS = 60_000;
const MAX_EVENTS = 12;

interface RateWindow {
  start?: number;
  count?: number;
}

const clean = (value: unknown, max: number): string => replaceControlChars(String(value || '')).slice(0, max);

export async function recordClientTelemetry(
  db: Database,
  identity: Identity,
  input: Record<string, unknown>,
) {
  const kind = String(input.kind);
  if (!EVENT_KINDS.includes(kind)) fail(400, 'INVALID_EVENT', 'Tipo de evento inválido.');
  const uid = String(identity.uid);
  const ref = db.ref('erpTelemetryRate').child(createHash('sha256').update(uid).digest('hex'));
  const now = Date.now();
  const tx = await runTransaction(ref, (value) => {
    const current = (value ?? {}) as RateWindow;
    const start = Number(current.start) || 0;
    if (now - start >= WINDOW_MS || start > now) return { start: now, count: 1 };
    if (Number(current.count) >= MAX_EVENTS) return undefined;
    return { start, count: Number(current.count || 0) + 1 };
  });
  if (!tx.committed) fail(429, 'LOG_RATE_LIMIT', 'Limite de eventos atingido.');
  await new AuditRepository(db).record({
    actorUid: identity.uid,
    actorLogin: identity.erpUser,
    action: kind,
    module: clean(input.module, 40) || 'frontend',
    entityType: 'error',
    entityId: clean(input.code, 50),
    scope: clean(input.path, 100),
    outcome: 'failed',
  });
  return { ok: true };
}
