import type { Database } from 'firebase-admin/database';
import { fail } from '../../../shared/errors/app-error.js';

type ErpData = Record<string, unknown>;

export const BUSINESS_SNAPSHOT_NODES: readonly string[] = Object.freeze([
  'tickets',
  'adiantamentos',
  'cheques',
  'adtCli',
  'chequesCli',
  'bancos',
  'lancBanco',
  'fornecedores',
  'clientes',
  'contasPagar',
  'contasReceber',
  'estoque',
  'historico',
  'funcEdit',
  'folha',
  'vales',
  'ponto',
  'epi',
  'frota',
  'manutencao',
  'viagem',
  'combustivel',
  'agendaEntregas',
  'almoxa',
  'almoxaMov',
  'custosCasa',
  'veicPess',
  'manutPess',
]);

const TOMBSTONE_NODES: readonly string[] = Object.freeze([
  'ticketsDeleted',
  'ticketsDeletedV2',
  'fornDeleted',
  'fornDeletedV2',
  'contasPagarDeleted',
  'contasPagarDeletedV2',
  ...[
    'bancos',
    'lancBanco',
    'fornecedores',
    'clientes',
    'contasReceber',
    'vales',
    'ponto',
    'epi',
    'frota',
    'manutencao',
    'viagem',
    'combustivel',
    'agendaEntregas',
    'almoxa',
    'almoxaMov',
    'historico',
  ].flatMap((node) => [node + 'Deleted', node + 'DeletedV2']),
]);

const TOMBSTONE_ALIASES: Record<string, string> = {
  fornDeleted: 'fornecedores',
  fornDeletedV2: 'fornecedores',
  ticketsDeleted: 'tickets',
  ticketsDeletedV2: 'tickets',
  contasPagarDeleted: 'contasPagar',
  contasPagarDeletedV2: 'contasPagar',
};

const has = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function isValidSnapshotKey(key: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(key) || /^antes-restauracao-\d{13}$/.test(key) || /^manual-\d{13}$/.test(key)
  );
}

export function normalizeBusinessSnapshot(
  erp: ErpData | null | undefined,
  operator: string,
  now = Date.now(),
): ErpData {
  const source = erp ?? {};
  const snapshot: ErpData = { _schema: 2, _ts: now, _user: operator };
  for (const node of BUSINESS_SNAPSHOT_NODES) snapshot[node] = has(source, node) ? source[node] : null;
  return snapshot;
}

export function buildExactRestorePatch(snapshot: unknown): ErpData {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    throw new Error('Snapshot inválido.');
  const source = snapshot as ErpData;
  const patch: ErpData = {};
  for (const node of BUSINESS_SNAPSHOT_NODES)
    if (has(source, node)) patch['erp/' + node] = source[node] ?? null;
  for (const node of TOMBSTONE_NODES) {
    const base = TOMBSTONE_ALIASES[node] ?? node.replace(/Deleted(?:V2)?$/, '');
    if (has(source, base)) patch['erp/' + node] = null;
  }
  patch['erp/_ts'] = Date.now();
  return patch;
}

export async function createSnapshot(
  db: Database,
  { key, operator, overwrite = false }: { key: string; operator: string; overwrite?: boolean },
): Promise<{ key: string; created: boolean }> {
  if (!isValidSnapshotKey(key)) throw new Error('Identificador de snapshot inválido.');
  const ref = db.ref('erp_snapshots/' + key);
  if (!overwrite && (await ref.get()).exists()) return { key, created: false };
  const source = ((await db.ref('erp').get()).val() ?? {}) as ErpData;
  await ref.set(normalizeBusinessSnapshot(source, operator));
  return { key, created: true };
}

export async function restoreSnapshot(
  db: Database,
  { key, operator }: { key: string; operator: string },
): Promise<{ key: string; emergency: string }> {
  if (!isValidSnapshotKey(key)) throw new Error('Identificador de snapshot inválido.');
  const snapshot: unknown = (await db.ref('erp_snapshots/' + key).get()).val();
  if (!snapshot) fail(404, 'SNAPSHOT_NOT_FOUND', 'Snapshot não encontrado.');
  const before = ((await db.ref('erp').get()).val() ?? {}) as ErpData;
  const emergency = 'antes-restauracao-' + Date.now();
  await db.ref('erp_snapshots/' + emergency).set(normalizeBusinessSnapshot(before, operator));
  const patch = buildExactRestorePatch(snapshot);
  try {
    await db.ref().update(patch);
  } catch (error) {
    if (error && typeof error === 'object') Object.assign(error, { emergency });
    throw error;
  }
  try {
    await db.ref('erpAudit').push({
      action: 'snapshot-restored',
      module: 'suporte_tecnico',
      actorLogin: operator,
      at: new Date().toISOString(),
      snapshotKey: key,
      emergencyKey: emergency,
    });
  } catch (error) {
    console.error('Audit failed AFTER successful restore:', error);
  }
  return { key, emergency };
}
