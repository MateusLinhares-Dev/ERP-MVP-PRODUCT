import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { toBRDate } from '../../../shared/domain/dates.js';
import { toCents } from '../../../shared/domain/money.js';
import { fail } from '../../../shared/errors/app-error.js';
import { withLocks } from '../../../shared/firebase/locks.js';
import { supplierExists } from '../../advances/domain/advance-rules.js';
import { isRow, type Row } from '../domain/bank-ledger-rules.js';
import {
  APPLIED,
  CANCELLED,
  CLEARED,
  DEFAULT_PURPOSE,
  DEFAULT_TYPE,
  DISCOUNT_VALUES,
  EDIT_FIELDS,
  EDIT_STATUSES,
  MAX_CREATE,
  MAX_DISCOUNT,
  appliedTicket,
  chequeRef,
  cleanPatch,
  identityOf,
  isApplied,
  isCancelled,
  isCleared,
  listOf,
  locate,
  nextChequeId,
  purchaseChanges,
  sameChequeElsewhere,
  text,
  tombstoneList,
} from '../domain/supplier-cheque-rules.js';

export interface SupplierChequeDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
  random?: () => number;
}

interface Context {
  db: Database;
  identity: Identity;
  now: () => number;
  uuid: () => string;
  random: () => number;
}

interface Book {
  code: string;
  list: Row[];
  groups: Map<string, Row[]>;
  supplierTombstones: string[];
}

const KEY_CHARS = /[.#$/[\]]/;
const GLOBAL_LOCK = 'erpFinanceAdvanceLocks/__supplier_cheques__';
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);

async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

function supplierCode(value: unknown): string {
  const code = text(value, 60);
  if (!code || KEY_CHARS.test(code)) fail(422, 'INVALID_SUPPLIER', 'Selecione um fornecedor válido.');
  return code;
}

const lock = <T>(context: Context, code: string, work: () => Promise<T>) =>
  withLocks(
    context.db,
    ['erpFinanceAdvanceLocks/' + code, GLOBAL_LOCK],
    {
      now: context.now,
      uuid: context.uuid,
      code: 'SUPPLIER_CHEQUE_IN_PROGRESS',
      message:
        'Outra operação com cheques ou compras deste fornecedor está em andamento. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

async function openBook(context: Context, code: string): Promise<Book> {
  const [all, itemTombstones, itemTombstonesV2, supplierTombstones] = await Promise.all([
    read(context.db, 'erp/cheques'),
    read(context.db, 'erp/chequeItensDeleted'),
    read(context.db, 'erp/chequeItensDeletedV2'),
    read(context.db, 'erp/chequesPorFornDeleted'),
  ]);
  const deletedItems = new Set([...tombstoneList(itemTombstones), ...tombstoneList(itemTombstonesV2)]);
  const deletedSuppliers = tombstoneList(supplierTombstones);
  const groups = new Map<string, Row[]>();
  for (const [key, raw] of Object.entries(isRow(all) ? all : {})) {
    if (key !== code && deletedSuppliers.includes(key)) continue;
    const rows = listOf(raw).filter((row) => !deletedItems.has(key + '::' + text(row.id, 100)));
    groups.set(key, key === code && deletedSuppliers.includes(key) ? [] : rows);
  }
  if (!groups.has(code)) groups.set(code, []);
  return { code, list: groups.get(code) ?? [], groups, supplierTombstones: deletedSuppliers };
}

function withIds(list: Row[], code: string): Row[] {
  const used = new Set(list.map((row) => text(row.id, 100)).filter(Boolean));
  return list.map((row) => {
    if (text(row.id, 100)) return row;
    const base = chequeRef(row, code);
    let id = base;
    for (let copy = 2; used.has(id); copy++) id = base + '_' + copy;
    used.add(id);
    return { ...row, id };
  });
}

async function save(context: Context, book: Book, list: Row[]): Promise<Row[]> {
  const next = clean(withIds(list, book.code));
  const updates: Row = { ['erp/cheques/' + book.code]: next, 'erp/_ts': context.now() };
  if (book.supplierTombstones.includes(book.code))
    updates['erp/chequesPorFornDeleted'] = book.supplierTombstones.filter((item) => item !== book.code);
  await context.db.ref().update(updates);
  return next;
}

function found(book: Book, ref: unknown, hint?: unknown): number {
  const wanted = text(ref, 100);
  let index = locate(book.list, wanted, book.code);
  const at = Number(hint);
  const hinted = Number.isInteger(at) ? book.list[at] : undefined;
  if (index === -2 && hinted && chequeRef(hinted, book.code) === wanted) index = at;
  if (index === -2)
    fail(
      409,
      'CHEQUE_AMBIGUOUS',
      'Há mais de um cheque com esta identificação. Atualize a tela e tente de novo.',
    );
  if (index < 0) fail(404, 'CHEQUE_NOT_FOUND', 'Cheque não encontrado. Atualize a lista de cheques.');
  return index;
}

function checkExpected(current: Row, expected: unknown): void {
  if (!isRow(expected)) return;
  const sameValue = expected.valor == null || toCents(expected.valor) === toCents(current.valor);
  const sameStatus =
    expected.status == null || text(expected.status) === (text(current.status) || 'Pendente');
  if (!sameValue || !sameStatus)
    fail(409, 'CHEQUE_CHANGED', 'Este cheque mudou em outra tela. Atualize a lista e tente de novo.');
}

function duplicateMessage(cheque: Row, where: { code: string; cheque: Row }, names: Map<string, string>) {
  const owner = names.get(where.code) || where.code;
  return (
    `O cheque nº ${text(cheque.num)}${text(cheque.banco) ? ' (' + text(cheque.banco) + ')' : ''} já está lançado` +
    ` para ${owner}. O mesmo banco não pode ter dois cheques com o mesmo número.`
  );
}

async function supplierNames(context: Context): Promise<{ raw: unknown; names: Map<string, string> }> {
  const raw = await read(context.db, 'erp/fornecedores');
  const names = new Map<string, string>();
  for (const row of listOf(raw)) names.set(text(row.cod, 60), text(row.nome, 160));
  return { raw, names };
}

const purchaseMessage = (cheque: Row, what: string) =>
  `Este cheque faz parte do pagamento da compra ${appliedTicket(cheque) || '(sem número)'}. ` +
  `${what} deixaria a compra errada. Para mudar, fale com o financeiro para conciliar a compra.`;

const stamp = (context: Context, row: Row): Row => ({
  ...row,
  alteradoPor: actor(context.identity),
  _upd: context.now(),
});

async function createCheques(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const rows = Array.isArray(body.cheques) ? body.cheques : [];
  if (!rows.length) fail(422, 'NO_CHEQUES', 'Adicione ao menos um cheque.');
  if (rows.length > MAX_CREATE)
    fail(422, 'TOO_MANY_CHEQUES', `Lance no máximo ${MAX_CREATE} cheques por vez.`);
  const cleaned = rows.map((row, index) => {
    const { fields, problem } = cleanPatch(row, EDIT_FIELDS);
    if (problem) fail(422, problem.code, `Cheque ${index + 1}: ${problem.message}`);
    if (!fields.num) fail(422, 'CHEQUE_NUMBER_REQUIRED', `Cheque ${index + 1}: informe o número do cheque.`);
    if (fields.valor == null) fail(422, 'INVALID_AMOUNT', `Cheque ${index + 1}: informe o valor do cheque.`);
    const status = text(fields.status) || 'Pendente';
    if (status !== 'Pendente' && status !== CLEARED)
      fail(422, 'INVALID_STATUS', `Cheque ${index + 1}: situação inválida.`);
    const entry: Row = { ...fields, status };
    return entry;
  });
  const { raw, names } = await supplierNames(context);
  if (!supplierExists(raw, code))
    fail(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado. Atualize a tela.');
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const taken = new Set([...book.groups.values()].flat().map((row) => text(row.id, 100)));
    const added: Row[] = [];
    for (const fields of cleaned) {
      const where = sameChequeElsewhere(book.groups, fields, null);
      if (where) fail(409, 'CHEQUE_EXISTS', duplicateMessage(fields, where, names));
      const id = nextChequeId(taken, context.now(), context.random);
      taken.add(id);
      const cheque: Row = {
        id,
        num: fields.num,
        banco: fields.banco ?? '',
        tipo: fields.tipo || DEFAULT_TYPE,
        finalidade: fields.finalidade || DEFAULT_PURPOSE,
        empresa: fields.empresa ?? '',
        valor: fields.valor,
        bomPara: fields.bomPara ?? '',
        vinculo: fields.vinculo ?? '',
        status: fields.status,
        dataCompensacao: fields.status === CLEARED ? fields.bomPara || '' : '',
        statusDesc: 'Descontado',
        criadoPor: actor(context.identity),
      };
      if (fields.obs) cheque.obs = fields.obs;
      added.push(cheque);
      book.groups.get(code)?.push(cheque);
    }
    const cheques = await save(context, book, book.groups.get(code) ?? []);
    return { action: 'create', fornCod: code, created: added.map((row) => row.id), cheques };
  });
}

async function updateCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const { fields, problem } = cleanPatch(body.cheque, EDIT_FIELDS);
  if (problem) fail(422, problem.code, problem.message);
  if (!Object.keys(fields).length) fail(422, 'NOTHING_TO_CHANGE', 'Nada para alterar.');
  if (fields.status != null && !EDIT_STATUSES.includes(text(fields.status)))
    fail(422, 'INVALID_STATUS', 'Situação do cheque inválida.');
  const { names } = await supplierNames(context);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    checkExpected(current, body.expected);
    if (isApplied(current) && purchaseChanges(current, fields).length)
      fail(
        409,
        'CHEQUE_IN_PURCHASE',
        purchaseMessage(current, 'Mudar número, banco, valor, vínculo ou situação'),
      );
    const next: Row = { ...current, ...fields };
    if (fields.status != null && fields.status !== CLEARED) next.dataCompensacao = '';
    if (fields.num != null || fields.banco != null) {
      const where = isCancelled(next) ? null : sameChequeElsewhere(book.groups, next, current);
      if (where) fail(409, 'CHEQUE_EXISTS', duplicateMessage(next, where, names));
    }
    book.list[index] = stamp(context, next);
    const cheques = await save(context, book, book.list);
    return { action: 'update', fornCod: code, id: chequeRef(next, code), cheques };
  });
}

async function deleteCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    checkExpected(current, body.expected);
    if (isApplied(current)) fail(409, 'CHEQUE_IN_PURCHASE', purchaseMessage(current, 'Excluir o cheque'));
    const cheques = await save(
      context,
      book,
      book.list.filter((_, at) => at !== index),
    );
    return { action: 'delete', fornCod: code, removed: clean(current), cheques };
  });
}

async function clearCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const raw = text(body.date, 20);
  const date = raw ? toBRDate(raw) : '';
  if (!date) fail(422, 'INVALID_DATE', 'Informe a data da compensação.');
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    if (isCancelled(current))
      fail(409, 'CHEQUE_CANCELLED', 'Este cheque está cancelado. Reative-o antes de compensar.');
    const next: Row = { ...current, status: CLEARED, dataCompensacao: date };
    if (text(current.status) === APPLIED) next.statusAnterior = APPLIED;
    book.list[index] = stamp(context, next);
    const cheques = await save(context, book, book.list);
    return { action: 'clear', fornCod: code, id: chequeRef(next, code), cheques };
  });
}

async function reopenCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    if (!isCleared(current)) fail(409, 'CHEQUE_NOT_CLEARED', 'Este cheque não está compensado.');
    const back =
      text(current._aplicadoTicket) || text(current.statusAnterior) === APPLIED ? APPLIED : 'Pendente';
    const next: Row = { ...current, status: back, dataCompensacao: '' };
    delete next.statusAnterior;
    book.list[index] = stamp(context, next);
    const cheques = await save(context, book, book.list);
    return { action: 'reopen', fornCod: code, id: chequeRef(next, code), status: back, cheques };
  });
}

async function discountCheques(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const value = text(body.value, 20);
  if (!DISCOUNT_VALUES.includes(value)) fail(422, 'INVALID_DISCOUNT', 'Escolha descontado ou a descontar.');
  const refs = (Array.isArray(body.ids) ? body.ids : [])
    .map((item: unknown) =>
      isRow(item)
        ? { ref: text(item.id, 100), index: item.index }
        : { ref: text(item, 100), index: undefined },
    )
    .filter((item) => item.ref);
  if (!refs.length) fail(422, 'NO_CHEQUES', 'Escolha ao menos um cheque.');
  if (refs.length > MAX_DISCOUNT) fail(422, 'TOO_MANY_CHEQUES', `Escolha no máximo ${MAX_DISCOUNT} cheques.`);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const indexes = refs.map((item) => found(book, item.ref, item.index));
    if (new Set(indexes).size !== indexes.length)
      fail(422, 'DUPLICATE_CHEQUES', 'Há cheques repetidos na seleção.');
    for (const index of indexes) {
      const current = book.list[index] as Row;
      if (isCancelled(current))
        fail(409, 'CHEQUE_CANCELLED', `O cheque nº ${text(current.num)} está cancelado. Atualize a lista.`);
      book.list[index] = stamp(context, { ...current, statusDesc: value });
    }
    const cheques = await save(context, book, book.list);
    return { action: 'discount', fornCod: code, value, count: indexes.length, cheques };
  });
}

async function cancelCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    if (isApplied(current)) fail(409, 'CHEQUE_IN_PURCHASE', purchaseMessage(current, 'Cancelar o cheque'));
    if (isCancelled(current)) return { action: 'cancel', fornCod: code, cheques: clean(book.list) };
    book.list[index] = stamp(context, { ...current, status: CANCELLED, dataCompensacao: '' });
    const cheques = await save(context, book, book.list);
    return { action: 'cancel', fornCod: code, id: chequeRef(current, code), cheques };
  });
}

async function reactivateCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const { names } = await supplierNames(context);
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const index = found(book, body.id, body.index);
    const current = book.list[index] as Row;
    if (!isCancelled(current)) fail(409, 'CHEQUE_NOT_CANCELLED', 'Este cheque não está cancelado.');
    const next: Row = { ...current, status: 'Pendente', dataCompensacao: '' };
    const where = sameChequeElsewhere(book.groups, next, current);
    if (where) fail(409, 'CHEQUE_EXISTS', duplicateMessage(next, where, names));
    book.list[index] = stamp(context, next);
    const cheques = await save(context, book, book.list);
    return { action: 'reactivate', fornCod: code, id: chequeRef(next, code), cheques };
  });
}

function receiptHasCheque(ticket: unknown, cheque: Row): boolean {
  if (!isRow(ticket)) return false;
  const receipt = isRow(ticket.reciboFinanceiro) ? ticket.reciboFinanceiro : {};
  return listOf(receipt.cheques).some(
    (row) =>
      (text(row.id) && text(row.id) === text(cheque.id)) ||
      (!text(row.id) && text(row.num) === text(cheque.num) && toCents(row.valorAplicado) > 0),
  );
}

async function restoreCheque(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const record = isRow(body.cheque) ? body.cheque : null;
  if (!record) fail(422, 'INVALID_CHEQUE', 'O registro do cheque está vazio.');
  const source = record as Row;
  const { fields, problem } = cleanPatch(
    { ...source, valor: Number(source.valor), status: undefined },
    EDIT_FIELDS.filter((key) => key !== 'status'),
  );
  if (problem) fail(422, problem.code, problem.message);
  if (!fields.num || fields.valor == null)
    fail(422, 'INVALID_CHEQUE', 'O registro do cheque não tem número ou valor.');
  const { raw, names } = await supplierNames(context);
  if (!supplierExists(raw, code))
    fail(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado. Atualize a tela.');
  return lock(context, code, async () => {
    const book = await openBook(context, code);
    const oldId = text(source.id, 100);
    const wanted = identityOf(fields);
    const here = book.list.some(
      (row) =>
        (oldId && (text(row.id, 100) === oldId || text(row.restauradoDe, 100) === oldId)) ||
        (Boolean(wanted) && !isCancelled(row) && identityOf(row) === wanted),
    );
    if (here)
      fail(409, 'CHEQUE_EXISTS', 'Este cheque já existe na lista do fornecedor. Não precisa restaurar.');
    const where = text(source.status) === CANCELLED ? null : sameChequeElsewhere(book.groups, fields, null);
    if (where) fail(409, 'CHEQUE_EXISTS', duplicateMessage(fields, where, names));
    const ticketNo = appliedTicket(source);
    const stillApplied =
      Boolean(ticketNo) &&
      !KEY_CHARS.test(ticketNo) &&
      receiptHasCheque(await read(context.db, 'erp/tickets/' + ticketNo), source);
    const allowed = [...EDIT_STATUSES, CANCELLED];
    const previous = text(source.status);
    const status = stillApplied ? APPLIED : allowed.includes(previous) ? previous : 'Pendente';
    const taken = new Set([...book.groups.values()].flat().map((row) => text(row.id, 100)));
    const cheque: Row = {
      ...fields,
      id: nextChequeId(taken, context.now(), context.random),
      tipo: fields.tipo || DEFAULT_TYPE,
      finalidade: fields.finalidade || DEFAULT_PURPOSE,
      statusDesc: DISCOUNT_VALUES.includes(text(source.statusDesc, 20))
        ? text(source.statusDesc, 20)
        : 'Descontado',
      status,
      dataCompensacao: status === CLEARED ? toBRDate(source.dataCompensacao) || fields.bomPara || '' : '',
      restauradoDe: oldId,
      restauradoPor: actor(context.identity),
      _upd: context.now(),
    };
    if (stillApplied) cheque._aplicadoTicket = ticketNo;
    const cheques = await save(context, book, [...book.list, cheque]);
    return { action: 'restore', fornCod: code, id: cheque.id, status, cheques };
  });
}

const ACTIONS: Record<string, (context: Context, body: Row) => Promise<Row>> = {
  create: createCheques,
  update: updateCheque,
  delete: deleteCheque,
  clear: clearCheque,
  reopen: reopenCheque,
  discount: discountCheques,
  cancel: cancelCheque,
  reactivate: reactivateCheque,
  restore: restoreCheque,
};

export async function changeSupplierCheque(
  identity: Identity,
  input: unknown,
  deps: SupplierChequeDeps = {},
) {
  const body = isRow(input) ? input : null;
  if (!body) return fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  if (identity.erpAccess !== true || identity.canFinance !== true)
    fail(403, 'FINANCE_REQUIRED', 'Seu perfil não pode alterar cheques de fornecedores.');
  const action = ACTIONS[text(body.action, 30)];
  if (!action) return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  const db = deps.db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const context: Context = {
    db,
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
    random: deps.random ?? Math.random,
  };
  const operationId = text(body.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? db.ref('erp/supplierChequeOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  const result = clean(await action(context, body));
  if (opRef) await opRef.set({ result, createdAt: context.now() });
  return result;
}
