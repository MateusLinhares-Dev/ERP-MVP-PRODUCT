import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { toBRDate } from '../../../shared/domain/dates.js';
import { fail } from '../../../shared/errors/app-error.js';
import { withLocks } from '../../../shared/firebase/locks.js';
import {
  MAX_BATCH,
  cleanInstallments,
  cleanPayableFields,
  deleteProblem,
  editProblem,
  installmentDueDates,
  isRow,
  type Row,
} from '../domain/payable-rules.js';

export interface PayableRegistryDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface Context {
  db: Database;
  identity: Identity;
  now: () => number;
  uuid: () => string;
}

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);
const payableLock = (id: string): string => 'erpFinancePayableLocks/' + id;

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

function requireId(value: unknown): string {
  const id = text(value, 130);
  if (!ID.test(id)) fail(422, 'INVALID_PAYABLE', 'Conta a pagar inválida. Atualize a tela.');
  return id;
}

async function findPayable(db: Database, id: string): Promise<{ path: string; row: Row } | null> {
  const direct = await read(db, 'erp/contasPagar/' + id);
  if (isRow(direct) && (direct.id == null || String(direct.id) === id))
    return { path: id, row: { ...direct, id } };
  const all = await read(db, 'erp/contasPagar');
  const entries = Object.entries(isRow(all) || Array.isArray(all) ? (all as Row) : {});
  const found = entries.find(([path, row]) => isRow(row) && (String(row.id) === id || path === id));
  return found ? { path: found[0], row: { ...(found[1] as Row), id } } : null;
}

async function purchaseOwned(db: Database, row: Row): Promise<boolean> {
  if (text(row.id).startsWith('CPPO_')) return true;
  const ticket = text(row.ticket, 120);
  if (!ticket || !ID.test(ticket)) return false;
  const stored = await read(db, 'erp/tickets/' + ticket);
  return isRow(stored) && Boolean(stored._purchaseOperationId);
}

async function bankOf(db: Database, code: string): Promise<{ cod: string; nome: string }> {
  if (!code) return { cod: '', nome: '' };
  const all = await read(db, 'erp/bancos');
  const list = (Array.isArray(all) ? all : isRow(all) ? Object.values(all) : []).filter(isRow);
  const bank = list.find((item) => text(item.cod) === code || text(item.id) === code);
  if (!bank) fail(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
  const owner =
    text(bank?.tipo) === 'Conta Terceiro' && text(bank?.titular) ? ` (${text(bank?.titular)})` : '';
  return { cod: text(bank?.cod) || code, nome: text(bank?.banco) + owner };
}

const lock = <T>(context: Context, paths: string[], work: () => Promise<T>) =>
  withLocks(
    context.db,
    paths,
    {
      now: context.now,
      uuid: context.uuid,
      code: 'PAYABLE_IN_PROGRESS',
      message:
        'Esta conta está sendo alterada ou paga em outra tela. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

const newId = (context: Context): string =>
  'CP' + context.now().toString(36) + context.uuid().replace(/-/g, '').slice(0, 10);

async function createMany(context: Context, body: Row) {
  const { fields, problem } = cleanPayableFields(body.payable, true);
  if (problem) fail(422, problem.code, problem.message);
  const { plan, problem: planProblem } = cleanInstallments(body.installments);
  if (planProblem) fail(422, planProblem.code, planProblem.message);
  if (!plan && !fields.venc) fail(422, 'INVALID_DATE', 'Informe o vencimento.');
  const bank = await bankOf(context.db, fields.bancoCod ?? '');
  const now = context.now();
  const base: Row = {
    lancto: toBRDate(businessTodayISO(now)),
    desc: fields.desc,
    cred: fields.cred ?? '',
    cat: fields.cat || 'Outros',
    tipoForn: fields.tipoForn ?? 'despesa',
    empresa: fields.empresa,
    bancoCod: bank.cod,
    bancoNome: bank.nome,
    valor: fields.valor,
    status: 'Pendente',
    dataPgto: '',
    obs: fields.obs ?? '',
    criadoPor: actor(context.identity),
    _upd: now,
  };
  if (fields.formaPrevista) base.formaPrevista = fields.formaPrevista;
  const rows: Row[] = [];
  if (plan) {
    const group = 'grp_' + now + '_' + context.uuid().replace(/-/g, '').slice(0, 6);
    installmentDueDates(plan).forEach((due, index) =>
      rows.push({
        ...base,
        id: newId(context),
        desc: `${String(fields.desc)} (${index + 1}/${plan.count})`,
        venc: due,
        grupoId: group,
        totalParcelas: plan.count,
      }),
    );
  } else rows.push({ ...base, id: newId(context), venc: fields.venc });
  const updates: Row = { 'erp/_ts': now };
  for (const row of rows) updates['erp/contasPagar/' + String(row.id)] = clean(row);
  await context.db.ref().update(updates);
  return { action: 'create', payables: rows };
}

async function updateOne(context: Context, body: Row) {
  const id = requireId(body.id);
  const { fields, problem } = cleanPayableFields(body.payable, false);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [payableLock(id)], async () => {
    const found = await findPayable(context.db, id);
    if (!found) fail(404, 'PAYABLE_NOT_FOUND', 'Conta a pagar não encontrada. Atualize a tela.');
    const { path, row } = found as { path: string; row: Row };
    if (await purchaseOwned(context.db, row))
      fail(
        422,
        'PAYABLE_FROM_PURCHASE',
        'Esta conta pertence a um pedido de compra. Para mudar valor, vencimento ou parcelas, use Editar no Histórico de compras.',
      );
    if (body.expectedUpdate != null && row._upd != null && Number(row._upd) !== Number(body.expectedUpdate))
      fail(409, 'PAYABLE_CHANGED', 'Esta conta foi alterada em outra tela. Feche e abra de novo.');
    const blocked = editProblem(row, fields);
    if (blocked) fail(422, blocked.code, blocked.message);
    const next: Row = { ...row, ...fields, _upd: context.now(), alteradoPor: actor(context.identity) };
    if ('bancoCod' in fields) {
      const bank = await bankOf(context.db, fields.bancoCod ?? '');
      next.bancoCod = bank.cod;
      next.bancoNome = bank.nome;
    }
    await context.db.ref().update({ ['erp/contasPagar/' + path]: clean(next), 'erp/_ts': context.now() });
    return { action: 'update', payable: next };
  });
}

function requireIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const ids = [...new Set(list.map(requireId))];
  if (!ids.length) fail(422, 'INVALID_PAYABLE', 'Selecione ao menos uma conta.');
  if (ids.length > MAX_BATCH) fail(422, 'TOO_MANY_PAYABLES', `Exclua no máximo ${MAX_BATCH} contas por vez.`);
  return ids;
}

async function deleteMany(context: Context, body: Row) {
  const ids = requireIds(body.ids);
  return lock(context, ids.map(payableLock), async () => {
    const updates: Row = { 'erp/_ts': context.now() };
    const deleted: string[] = [];
    const purchase: string[] = [];
    for (const id of ids) {
      const found = await findPayable(context.db, id);
      if (!found) continue;
      if (await purchaseOwned(context.db, found.row)) {
        purchase.push(text(found.row.desc || found.row.cred, 60) || id);
        continue;
      }
      const blocked = deleteProblem(found.row);
      if (blocked) fail(422, blocked.code, blocked.message);
      updates['erp/contasPagar/' + found.path] = null;
      updates['erp/contasPagarDeleted/' + id] = true;
      deleted.push(id);
    }
    if (purchase.length)
      fail(
        422,
        'PAYABLE_FROM_PURCHASE',
        `Conta de pedido de compra não se exclui aqui (${purchase.slice(0, 3).join(', ')}). Edite ou exclua o pedido no Histórico de compras.`,
      );
    if (deleted.length) await context.db.ref().update(updates);
    return { action: 'delete', ids: deleted };
  });
}

const allowed = (identity: Identity): boolean =>
  identity.erpAccess === true && (identity.canPayables === true || identity.canFinance === true);

export async function changePayable(identity: Identity, input: unknown, deps: PayableRegistryDeps = {}) {
  const body = isRow(input) ? input : null;
  if (!body) fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  if (!allowed(identity)) fail(403, 'PAYABLES_REQUIRED', 'Seu perfil não pode alterar Contas a Pagar.');
  const context: Context = {
    db: await database(deps.db),
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
  };
  const request = body as Row;
  const action = text(request.action, 20);
  const operationId = text(request.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? context.db.ref('erp/payableOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  let result: Row;
  if (action === 'create') result = await createMany(context, request);
  else if (action === 'update') result = await updateOne(context, request);
  else if (action === 'delete') result = await deleteMany(context, request);
  else return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  const stored = clean(result);
  if (opRef) await opRef.set({ result: stored, createdAt: context.now() });
  return stored;
}
