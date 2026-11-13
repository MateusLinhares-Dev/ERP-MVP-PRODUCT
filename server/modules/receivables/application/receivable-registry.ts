import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { isISODate, toBRDate } from '../../../shared/domain/dates.js';
import { fail } from '../../../shared/errors/app-error.js';
import { customerLockPath, withLocks } from '../../../shared/firebase/locks.js';
import {
  CREDIT_FORMS,
  RECEIVED,
  chequeRecords,
  chequeSummary,
  cleanCheques,
  cleanFields,
  listOf,
  removableCheques,
  type Row,
} from '../domain/receivable-rules.js';

export interface ReceivableDeps {
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
const KEY_CHARS = /[.#$/[\]]/;
const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

function requireId(value: unknown): string {
  const id = text(value, 130);
  if (!ID.test(id)) fail(422, 'INVALID_RECEIVABLE', 'Conta a receber inválida. Atualize a tela.');
  return id;
}

async function existing(db: Database, id: string): Promise<Row> {
  const row = await read(db, 'erp/contasReceber/' + id);
  if (!row || typeof row !== 'object')
    fail(404, 'RECEIVABLE_NOT_FOUND', 'Conta a receber não encontrada. Atualize a tela.');
  return { ...(row as Row), id };
}

async function bankOf(db: Database, code: string): Promise<{ cod: string; banco: string }> {
  const banks = listOf(await read(db, 'erp/bancos'));
  const bank = banks.find((item) => text(item.cod) === code || text(item.id) === code);
  if (!bank) fail(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
  return { cod: text(bank?.cod) || code, banco: text(bank?.banco) };
}

async function bankMovement(
  context: Context,
  bank: { cod: string },
  dateISO: string,
  row: Row,
): Promise<Row | null> {
  const cutoff = text(await read(context.db, 'erp/config/legacyRepairs/bankMovement/cutoffDate'), 10);
  if (cutoff && dateISO < cutoff) return null;
  return {
    id: 'LB-CR-' + context.now() + '-' + context.uuid().replace(/-/g, '').slice(0, 6),
    bancoCod: bank.cod,
    data: toBRDate(dateISO),
    descricao: 'Recebto: ' + text(row.cli, 160) + (text(row.nf) ? ' NF ' + text(row.nf) : ''),
    tipo: 'Entrada',
    valor: Number(row.valor) || 0,
    contaReceberId: text(row.id, 120),
    origem: 'contas-receber',
  };
}

function undoMovement(updates: Row, row: Row): string {
  const movement = text(row.movBancoId, 130);
  if (!ID.test(movement)) return '';
  updates['erp/lancBanco/' + movement] = null;
  updates['erp/lancBancoDeletedV2/' + movement] = true;
  return movement;
}

const lock = (context: Context, paths: string[], work: () => Promise<Row>) =>
  withLocks(
    context.db,
    paths,
    {
      now: context.now,
      uuid: context.uuid,
      code: 'RECEIVABLE_IN_PROGRESS',
      message:
        'Outra operação desta conta ou deste cliente está em andamento. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

const rowLock = (id: string): string => 'erpReceivableLocks/' + id;

function receiptDate(value: unknown, today: string): string {
  const date = text(value, 10) || today;
  if (!isISODate(date)) fail(422, 'INVALID_DATE', 'Data de recebimento inválida.');
  return date;
}

async function receiveInto(context: Context, updates: Row, row: Row, body: Row, today: string): Promise<Row> {
  const date = receiptDate(body.date, today);
  const { cheques, problem } = cleanCheques(body.cheques);
  if (problem) fail(422, problem.code, problem.message);
  const notes = text(body.notes, 500);
  const next: Row = { ...row, status: RECEIVED, dataReceb: toBRDate(date) };
  if (notes) next.obs = notes;
  let movement: Row | null = null;
  let chequeRows: Row[] = [];
  if (cheques.length) {
    const client = text(row.cli, 160);
    if (!client || KEY_CHARS.test(client))
      fail(422, 'INVALID_CLIENT', 'O nome deste cliente não permite guardar cheques. Corrija o cadastro.');
    const current = listOf(await read(context.db, 'erp/chequesCli/' + client));
    const taken = cheques.find((cheque) =>
      current.some((item) => text(item.num) === cheque.num && text(item.banco) === cheque.banco),
    );
    if (taken) fail(409, 'CHEQUE_EXISTS', `O cheque nº ${taken.num} já está na lista deste cliente.`);
    chequeRows = chequeRecords(cheques, row, date, text(row.id, 120));
    updates['erp/chequesCli/' + client] = clean([...current, ...chequeRows]);
    next.forma = 'Cheque';
    next.banco = '';
    next.bancoCod = '';
    next.chequesRecebimento = cheques.map((cheque) => cheque.num);
    next.obs = [text(next.obs, 400), chequeSummary(cheques)].filter(Boolean).join(' | ');
  } else if (text(body.bank)) {
    const bank = await bankOf(context.db, text(body.bank, 130));
    next.banco = bank.banco;
    next.bancoCod = bank.cod;
    if (text(body.method, 40)) next.forma = text(body.method, 40);
    movement = await bankMovement(context, bank, date, next);
    if (movement) {
      next.movBancoId = movement.id;
      updates['erp/lancBanco/' + text(movement.id)] = movement;
    }
  } else if (text(body.method, 40)) next.forma = text(body.method, 40);
  next.recebidoPor = actor(context.identity);
  return { next, movement, chequeRows };
}

async function createOne(context: Context, body: Row) {
  const { fields, problem } = cleanFields(body.receivable, true);
  if (problem) fail(422, problem.code, problem.message);
  const today = businessTodayISO(context.now());
  const id = 'CR' + context.now().toString(36) + context.uuid().replace(/-/g, '').slice(0, 6);
  const base: Row = {
    id,
    data: toBRDate(today),
    cli: fields.cli,
    nf: fields.nf ?? '',
    valor: fields.valor,
    forma: fields.forma || '—',
    banco: '—',
    venc: fields.venc,
    status: 'Pendente',
    dataReceb: '',
    obs: fields.obs ?? '',
    criadoPor: actor(context.identity),
    criadoEm: new Date(context.now()).toISOString(),
  };
  return lock(context, [rowLock(id), customerLockPath(fields.cli)], async () => {
    const updates: Row = { 'erp/_ts': context.now() };
    let result: Row = { next: base, movement: null, chequeRows: [] };
    if (body.received && typeof body.received === 'object')
      result = await receiveInto(context, updates, base, body.received as Row, today);
    updates['erp/contasReceber/' + id] = clean(result.next);
    await context.db.ref().update(updates);
    return {
      action: 'create',
      receivable: result.next,
      bankMovements: result.movement ? [result.movement] : [],
      cheques: chequeResult(result),
    };
  });
}

function chequeResult(result: Row): Row | null {
  const rows = Array.isArray(result.chequeRows) ? (result.chequeRows as Row[]) : [];
  return rows.length ? { client: text((result.next as Row).cli, 160), added: rows } : null;
}

async function updateOne(context: Context, body: Row) {
  const id = requireId(body.id);
  const { fields, problem } = cleanFields(body.receivable, false);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [rowLock(id)], async () => {
    const row = await existing(context.db, id);
    if (
      body.expectedUpdate != null &&
      row.atualizadoEm != null &&
      Number(row.atualizadoEm) !== Number(body.expectedUpdate)
    )
      fail(409, 'RECEIVABLE_CHANGED', 'Esta conta foi alterada em outra tela. Feche e abra de novo.');
    if (
      text(row.vendaId) &&
      ((fields.valor != null && fields.valor !== Number(row.valor)) ||
        (fields.cli && fields.cli !== text(row.cli, 160)))
    )
      fail(
        422,
        'RECEIVABLE_FROM_SALE',
        'Esta conta é de uma venda: valor e cliente mudam pela venda (Vendas → editar).',
      );
    if (text(row.status) === RECEIVED && fields.valor != null && fields.valor !== Number(row.valor))
      fail(422, 'RECEIVABLE_RECEIVED', 'Esta conta já foi recebida. Estorne a baixa antes de mudar o valor.');
    const next: Row = {
      ...row,
      ...fields,
      atualizadoEm: context.now(),
      alteradoPor: actor(context.identity),
    };
    await context.db.ref().update({ ['erp/contasReceber/' + id]: clean(next), 'erp/_ts': context.now() });
    return { action: 'update', receivable: next };
  });
}

async function receiveOne(context: Context, body: Row) {
  const id = requireId(body.id);
  const first = await existing(context.db, id);
  return lock(context, [rowLock(id), customerLockPath(first.cli)], async () => {
    const row = await existing(context.db, id);
    if (text(row.status) === RECEIVED) fail(409, 'ALREADY_RECEIVED', 'Esta conta já foi recebida.');
    const updates: Row = { 'erp/_ts': context.now() };
    const result = await receiveInto(context, updates, row, body, businessTodayISO(context.now()));
    updates['erp/contasReceber/' + id] = clean({ ...(result.next as Row), atualizadoEm: context.now() });
    await context.db.ref().update(updates);
    return {
      action: 'receive',
      receivable: { ...(result.next as Row), atualizadoEm: context.now() },
      bankMovements: result.movement ? [result.movement] : [],
      cheques: chequeResult(result),
    };
  });
}

async function undoReceipt(
  context: Context,
  row: Row,
  updates: Row,
): Promise<{ next: Row; bankUndone: string[]; cheques: Row | null }> {
  if (CREDIT_FORMS.has(text(row.forma)) && text(row.vendaId) && !Array.isArray(row.chequesRecebimento))
    fail(422, 'RECEIVABLE_FROM_SALE', 'Este recebimento é um abatimento de venda: desfaça pela venda.');
  const bankUndone = [undoMovement(updates, row)].filter(Boolean);
  let cheques: Row | null = null;
  if (Array.isArray(row.chequesRecebimento) && row.chequesRecebimento.length) {
    const client = text(row.cli, 160);
    const current = KEY_CHARS.test(client) ? [] : listOf(await read(context.db, 'erp/chequesCli/' + client));
    const { keep, blocked } = removableCheques(current, row);
    if (blocked.length)
      fail(
        409,
        'CHEQUE_ALREADY_USED',
        `Os cheques ${blocked.join(', ')} já foram depositados ou devolvidos. Resolva no controle de cheques antes.`,
      );
    updates['erp/chequesCli/' + client] = clean(keep);
    cheques = { client, list: keep };
  }
  const next: Row = { ...row, status: 'Pendente', dataReceb: '' };
  delete next.movBancoId;
  delete next.chequesRecebimento;
  delete next.recebidoPor;
  if (text(next.forma) === 'Cheque' && Array.isArray(row.chequesRecebimento)) next.forma = '—';
  if (bankUndone.length) {
    next.banco = '—';
    next.bancoCod = '';
  }
  return { next, bankUndone, cheques };
}

async function reopenOne(context: Context, body: Row) {
  const id = requireId(body.id);
  const first = await existing(context.db, id);
  return lock(context, [rowLock(id), customerLockPath(first.cli)], async () => {
    const row = await existing(context.db, id);
    if (text(row.status) !== RECEIVED) fail(409, 'NOT_RECEIVED', 'Esta conta não está recebida.');
    const updates: Row = { 'erp/_ts': context.now() };
    const result = await undoReceipt(context, row, updates);
    const next = { ...result.next, atualizadoEm: context.now(), alteradoPor: actor(context.identity) };
    updates['erp/contasReceber/' + id] = clean(next);
    await context.db.ref().update(updates);
    return { action: 'reopen', receivable: next, bankUndone: result.bankUndone, cheques: result.cheques };
  });
}

async function deleteOne(context: Context, body: Row) {
  const id = requireId(body.id);
  const first = await existing(context.db, id);
  if (text(first.vendaId))
    fail(422, 'RECEIVABLE_FROM_SALE', 'Esta conta é de uma venda: exclua ou edite pela venda.');
  return lock(context, [rowLock(id), customerLockPath(first.cli)], async () => {
    const row = await existing(context.db, id);
    const updates: Row = { 'erp/_ts': context.now() };
    const undone =
      text(row.status) === RECEIVED
        ? await undoReceipt(context, row, updates)
        : { bankUndone: [], cheques: null };
    updates['erp/contasReceber/' + id] = null;
    updates['erp/contasReceberDeletedV2/' + id] = true;
    await context.db.ref().update(updates);
    return { action: 'delete', id, bankUndone: undone.bankUndone, cheques: undone.cheques };
  });
}

function allowed(identity: Identity, action: string): boolean {
  if (identity.erpAccess !== true) return false;
  if (identity.canReceivables === true || identity.canFinance === true) return true;
  return action === 'create' && identity.canCustomers === true;
}

export async function changeReceivable(identity: Identity, input: unknown, deps: ReceivableDeps = {}) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Row) : null;
  if (!body) fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const action = text(body?.action, 20);
  if (!allowed(identity, action))
    fail(403, 'RECEIVABLES_REQUIRED', 'Seu perfil não pode alterar Contas a Receber.');
  const context: Context = {
    db: await database(deps.db),
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
  };
  const operationId = text(body?.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? context.db.ref('erp/receivableOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  const request = body as Row;
  let result: Row;
  if (action === 'create') result = await createOne(context, request);
  else if (action === 'update') result = await updateOne(context, request);
  else if (action === 'receive') result = await receiveOne(context, request);
  else if (action === 'reopen') result = await reopenOne(context, request);
  else if (action === 'delete') result = await deleteOne(context, request);
  else return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  const stored = clean(result);
  if (opRef) await opRef.set({ result: stored, createdAt: context.now() });
  return stored;
}
