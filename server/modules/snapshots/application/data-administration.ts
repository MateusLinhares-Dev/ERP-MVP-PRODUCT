import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { fail } from '../../../shared/errors/app-error.js';
import {
  BUSINESS_SNAPSHOT_NODES,
  createSnapshot,
  isValidSnapshotKey,
  restoreSnapshot,
} from './snapshot-service.js';

const BACKUP_FORMAT = 'MANUELA-ERP-RTDB';
const MAX_IMPORT_BYTES = 2_500_000;
const MAX_EXPORT_BYTES = 3_500_000;
const RESTORE_ACTIONS = new Set(['snapshot-restored', 'manual-database-backup-imported']);

type Body = Record<string, unknown>;

export function isDataOwner(identity: Identity): boolean {
  return identity.erpUser === 'elaine' || identity.engineer === true;
}

export async function changeSnapshots(db: Database, identity: Identity, body: Body) {
  if (!isDataOwner(identity)) fail(403, 'RESTORE_FORBIDDEN', 'A restauração fica restrita à Elaine.');
  const action = String(body.action || '');
  const key = String(body.key || '');
  const operator = String(identity.erpUser);
  if (action === 'snapshot') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) && !/^manual-\d{13}$/.test(key))
      fail(400, 'INVALID_SNAPSHOT', 'Data inválida.');
    return createSnapshot(db, { key, operator });
  }
  if (action === 'restore') {
    if (!isValidSnapshotKey(key) || body.confirmation !== 'RESTAURAR') {
      fail(400, 'INVALID_RESTORE', 'Confirmação ou identificador inválido.');
    }
    const result = await restoreSnapshot(db, { key, operator });
    return { ok: true, ...result, restoredNodes: BUSINESS_SNAPSHOT_NODES.length };
  }
  return fail(400, 'INVALID_ACTION', 'Ação inválida.');
}

export async function restoreHistory(db: Database, identity: Identity) {
  if (!isDataOwner(identity)) fail(403, 'RESTORE_FORBIDDEN', 'Histórico de restauração restrito à Elaine.');
  const snapshot: unknown = (await db.ref('erpAudit').limitToLast(250).get()).val();
  const records = Object.entries(snapshot && typeof snapshot === 'object' ? snapshot : {})
    .map(
      ([id, row]: [string, unknown]) =>
        ({ id, ...(row && typeof row === 'object' ? row : {}) }) as Record<string, unknown>,
    )
    .filter((row) => RESTORE_ACTIONS.has(String(row.action || '')))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 30)
    .map((row) => ({
      at: String(row.at || ''),
      action: row.action,
      actorLogin: String(row.actorLogin || ''),
      snapshotKey: String(row.snapshotKey || ''),
      emergencyKey: String(row.emergencyKey || ''),
    }));
  return { records };
}

export async function exchangeBackup(db: Database, identity: Identity, body: Body) {
  if (!isDataOwner(identity)) fail(403, 'BACKUP_FORBIDDEN', 'Apenas Elaine pode exportar/restaurar dados.');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_IMPORT_BYTES) {
    fail(413, 'BACKUP_TOO_LARGE', 'Arquivo excede o tamanho aceito pela interface.');
  }
  if (body.action === 'export') {
    const erp: unknown = (await db.ref('erp').get()).val() ?? {};
    const payload = {
      format: BACKUP_FORMAT,
      schema: 1,
      exportedAt: new Date().toISOString(),
      note: 'Banco de dados ERP somente. NÃO inclui arquivos binários do Firebase Storage nem credenciais do Firebase Authentication/erpAuth.',
      erp,
    };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_EXPORT_BYTES) {
      fail(
        413,
        'BACKUP_TOO_LARGE',
        'O banco ultrapassa o limite de exportação pela interface. Faça o backup de RTDB pelo console/infraestrutura; nenhum backup incompleto foi baixado.',
      );
    }
    return payload;
  }
  if (body.action === 'import') {
    const backup = (body.backup ?? {}) as Body;
    if (body.confirmation !== 'IMPORTAR' || backup.format !== BACKUP_FORMAT || backup.schema !== 1) {
      fail(400, 'INVALID_BACKUP', 'Formato ou confirmação inválidos.');
    }
    const data = backup.erp;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      fail(400, 'INVALID_BACKUP', 'Nó ERP ausente.');
    const current = ((await db.ref('erp').get()).val() ?? {}) as Body;
    const emergency = 'antes-importacao-' + Date.now();
    await db
      .ref('erpManualBackups/' + emergency)
      .set({ erp: current, at: new Date().toISOString(), operator: identity.erpUser });
    const imported = data as Body;
    await db.ref('erp').set({ ...imported, _appBuild: current._appBuild || imported._appBuild });
    try {
      await db.ref('erpAudit').push({
        action: 'manual-database-backup-imported',
        actorLogin: identity.erpUser,
        module: 'suporte_tecnico',
        at: new Date().toISOString(),
        emergencyKey: emergency,
      });
    } catch (error) {
      console.error('Audit failed AFTER successful import:', error);
    }
    return { ok: true, emergencyKey: emergency };
  }
  return fail(400, 'INVALID_ACTION', 'Ação inválida.');
}
