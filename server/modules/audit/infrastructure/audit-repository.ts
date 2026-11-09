import { createHmac } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { replaceControlChars } from '../../../shared/domain/text.js';
import { withSpan } from '../../../shared/observability/tracing.js';

export interface AuditEvent {
  actorUid?: unknown;
  actorLogin?: unknown;
  action?: unknown;
  module?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  scope?: unknown;
  outcome?: unknown;
  ip?: string;
}

function clean(value: unknown, max = 160): string {
  return replaceControlChars(String(value == null ? '' : value))
    .trim()
    .slice(0, max);
}

export function pseudonymizeIp(ip: unknown): string {
  const secret = String(process.env.LOGIN_RATE_LIMIT_SECRET || '');
  if (!secret) return '';
  return createHmac('sha256', secret)
    .update(String(ip || 'unknown'))
    .digest('hex');
}

export class AuditRepository {
  private readonly db: Database;

  constructor(db: Database = getFirebaseAdmin().db) {
    this.db = db;
  }

  async record(event: AuditEvent = {}): Promise<true> {
    const payload: Record<string, string | number> = {
      actorUid: clean(event.actorUid, 128),
      actorLogin: clean(event.actorLogin, 80),
      action: clean(event.action, 64),
      module: clean(event.module, 64),
      entityType: clean(event.entityType, 64),
      entityId: clean(event.entityId, 128),
      scope: clean(event.scope, 240),
      outcome: clean(event.outcome || 'success', 32),
      source: 'server',
      ts: Date.now(),
    };
    if (event.ip) payload.ipHash = pseudonymizeIp(event.ip);
    await withSpan(
      'firebase.rtdb.audit.write',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'push',
        'db.path': 'erpAudit',
        'audit.action': payload.action,
        'audit.module': payload.module,
      },
      async () => this.db.ref('erpAudit').push(payload),
    );
    return true;
  }
}

export async function recordAuditSafely(event: AuditEvent): Promise<void> {
  try {
    await new AuditRepository().record(event);
  } catch (error) {
    console.error(
      '[audit] registro não gravado:',
      clean(event.action, 64),
      (error as { code?: unknown } | null)?.code ?? 'audit_failure',
    );
  }
}
