import { createHmac } from 'node:crypto';
import { getFirebaseAdmin } from './firebase-admin.js';
import {
  withSpan,
} from '../observability/tracing.js';

function clean(value, max = 160) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export function pseudonymizeIp(ip) {
  const secret = String(process.env.LOGIN_RATE_LIMIT_SECRET || '');
  if (!secret) return '';
  return createHmac('sha256', secret).update(String(ip || 'unknown')).digest('hex');
}

export class AuditRepository {
  constructor() { this.db = getFirebaseAdmin().db; }

  async record(event = {}) {
    const payload = {
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
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'push',
        'db.path':
          'erpAudit',
        'audit.action':
          payload.action,
        'audit.module':
          payload.module,
      },
      async () =>
        this.db
          .ref('erpAudit')
          .push(payload),
    );
    return true;
  }
}
