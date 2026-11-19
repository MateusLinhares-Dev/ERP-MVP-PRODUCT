import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { nameKey, tombstoneIds } from '../../../shared/domain/person.js';
import { fail } from '../../../shared/errors/app-error.js';
import { customerLockPath, withLocks } from '../../../shared/firebase/locks.js';
import { customerEntries } from '../../customers/domain/customer-rules.js';
import {
  MAX_CHEQUES,
  SALE_USED,
  advanceUsed,
  cleanAdvance,
  cleanCheque,
  cleanEntry,
  cleanOpeningBalance,
  fromReceipt,
  isRow,
  listOf,
  locateCheque,
  nextAdvanceCode,
  nextChequeStatus,
  nextEntryId,
  sameCheque,
  text,
  usedInSale,
  type Row,
} from '../domain/client-credit-rules.js';

export interface ClientCreditDeps {
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

const KEY_CHARS = /[.#$/[\]]/;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);

async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

function clientName(value: unknown): string {
  const name = text(value, 160);
  if (!name || KEY_CHARS.test(name))
    fail(422, 'INVALID_CLIENT', 'Selecione um cliente válido. Nomes com . # $ [ ] / não podem ser usados.');
  return name;
}

async function registeredClient(db: Database, value: unknown): Promise<string> {
  const name = clientName(value);
  const [raw, deleted] = await Promise.all([read(db, 'erp/clientes'), read(db, 'erp/clientesDeleted')]);
  const wanted = nameKey(name);
  const found = customerEntries(raw, tombstoneIds(deleted)).find(
    (entry) => nameKey(entry.record.nome) === wanted,
  );
  if (!found) fail(422, 'CLIENT_NOT_FOUND', 'Cliente não encontrado no cadastro. Atualize a tela.');
  return clientName(found.record.nome);
}

const lock = <T>(context: Context, client: string, work: () => Promise<T>) =>
  withLocks(
    context.db,
    [customerLockPath(client)],
    {
      now: context.now,
      uuid: context.uuid,
      code: 'CLIENT_CREDIT_IN_PROGRESS',
      message:
        'Outra operação deste cliente está em andamento (venda ou recebimento). Aguarde alguns segundos.',
    },
    work,
  );

async function save(context: Context, path: string, client: string, list: Row[]): Promise<void> {
  await context.db.ref().update({ ['erp/' + path + '/' + client]: clean(list), 'erp/_ts': context.now() });
}

async function createAdvance(context: Context, body: Row) {
  const client = await registeredClient(context.db, body.cliente);
  const { fields, problem } = cleanAdvance(body.advance);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/adtCli/' + client));
    const bankCode = text((body.advance as Row | undefined)?.bancoCod, 60);
    let bancoNome = '';
    if (bankCode) {
      const banks = listOf(await read(context.db, 'erp/bancos'));
      const bank = banks.find((item) => text(item.cod) === bankCode);
      if (!bank) fail(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
      bancoNome = text(bank?.banco);
    }
    const cod = nextAdvanceCode(new Set(list.map((item) => text(item.cod))), context.now(), context.random);
    const advance: Row = {
      cod,
      ...fields,
      bancoCod: bankCode,
      bancoNome,
      status: 'Pendente',
      criadoPor: actor(context.identity),
    };
    const next = [...list, advance];
    await save(context, 'adtCli', client, next);
    return { action: 'create-advance', cliente: client, advance, advances: next };
  });
}

async function deleteAdvance(context: Context, body: Row) {
  const client = clientName(body.cliente);
  const cod = text(body.cod, 40);
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/adtCli/' + client));
    const matches = list.filter((item) => text(item.cod) === cod);
    if (matches.length !== 1)
      fail(404, 'ADVANCE_NOT_FOUND', 'Adiantamento não encontrado ou duplicado. Atualize a tela.');
    const advance = matches[0] as Row;
    if (advanceUsed(advance))
      fail(
        409,
        'ADVANCE_USED',
        'Este adiantamento já foi usado em venda' +
          (text(advance.vinculo) ? ' (' + text(advance.vinculo) + ')' : '') +
          '. Para devolver o valor, exclua ou edite a venda. Depois, se precisar, exclua o adiantamento.',
      );
    const next = list.filter((item) => item !== advance);
    await save(context, 'adtCli', client, next);
    return { action: 'delete-advance', cliente: client, cod, advances: next };
  });
}

async function createCheques(context: Context, body: Row) {
  const client = await registeredClient(context.db, body.cliente);
  const rows = Array.isArray(body.cheques) ? body.cheques : [];
  if (!rows.length) fail(422, 'NO_CHEQUES', 'Adicione ao menos um cheque.');
  if (rows.length > MAX_CHEQUES)
    fail(422, 'TOO_MANY_CHEQUES', `Lance no máximo ${MAX_CHEQUES} cheques por vez.`);
  const cleaned = rows.map((row, index) => {
    const { fields, problem } = cleanCheque(row, true);
    if (problem) fail(422, problem.code, `Cheque ${index + 1}: ${problem.message}`);
    return fields;
  });
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/chequesCli/' + client));
    const seen: Row[] = [...list];
    for (const cheque of cleaned) {
      if (seen.some((item) => sameCheque(item, cheque.num, cheque.banco)))
        fail(
          409,
          'CHEQUE_EXISTS',
          `O cheque nº ${text(cheque.num)}${text(cheque.banco) ? ' (' + text(cheque.banco) + ')' : ''} já está na lista deste cliente.`,
        );
      seen.push(cheque);
    }
    const added = cleaned.map((cheque) => ({ ...cheque, criadoPor: actor(context.identity) }));
    const next = [...list, ...added];
    await save(context, 'chequesCli', client, next);
    return { action: 'create-cheques', cliente: client, added: added.length, cheques: next };
  });
}

function found(list: Row[], body: Row): number {
  const index = locateCheque(list, body.num, body.banco, body.index);
  if (index === -2)
    fail(
      409,
      'CHEQUE_AMBIGUOUS',
      'Há mais de um cheque com este número e banco. Atualize a tela e tente de novo.',
    );
  if (index < 0) fail(404, 'CHEQUE_NOT_FOUND', 'Cheque não encontrado. Atualize a lista de cheques.');
  return index;
}

const saleMessage = (cheque: Row) =>
  `Este cheque foi usado na venda ${text(cheque.vinculo) || ''}`.trim() +
  '. Para mudar número, banco, valor ou situação, desfaça pela venda (o cheque volta a ficar pendente).';
const receiptMessage =
  'Este cheque veio do recebimento de uma conta a receber. Para mudar número, banco ou valor, estorne o recebimento em Contas a Receber.';

async function updateCheque(context: Context, body: Row) {
  const client = clientName(body.cliente);
  const input = isRow(body.cheque) ? body.cheque : {};
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/chequesCli/' + client));
    const index = found(list, body);
    const current = list[index] as Row;
    const saleUsed = usedInSale(current);
    const requested = text(input.status) || 'Pendente';
    if (saleUsed && requested !== SALE_USED) fail(409, 'CHEQUE_USED_IN_SALE', saleMessage(current));
    const { fields, problem } = cleanCheque(
      { ...input, status: saleUsed ? 'Pendente' : input.status },
      false,
    );
    if (problem) fail(422, problem.code, problem.message);
    if (saleUsed) {
      fields.status = current.status;
      fields.motivoDevolucao = text(current.motivoDevolucao, 200);
    }
    const moneyChanged =
      text(current.num) !== text(fields.num) ||
      !sameCheque(current, current.num, fields.banco) ||
      Math.round(Number(current.valor || 0) * 100) !== Math.round(Number(fields.valor) * 100);
    if (saleUsed && moneyChanged) fail(409, 'CHEQUE_USED_IN_SALE', saleMessage(current));
    if (fromReceipt(current) && moneyChanged) fail(409, 'CHEQUE_FROM_RECEIPT', receiptMessage);
    if (moneyChanged && list.some((item, at) => at !== index && sameCheque(item, fields.num, fields.banco)))
      fail(409, 'CHEQUE_EXISTS', `O cheque nº ${text(fields.num)} já está na lista deste cliente.`);
    if (fromReceipt(current)) fields.tipo = current.tipo;
    if (saleUsed || fromReceipt(current)) fields.vinculo = text(current.vinculo, 120);
    const next = list.map((item, at) =>
      at === index ? { ...item, ...fields, alteradoPor: actor(context.identity), _upd: context.now() } : item,
    );
    await save(context, 'chequesCli', client, next);
    return { action: 'update-cheque', cliente: client, cheques: next };
  });
}

async function cycleChequeStatus(context: Context, body: Row) {
  const client = clientName(body.cliente);
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/chequesCli/' + client));
    const index = found(list, body);
    const current = list[index] as Row;
    if (usedInSale(current)) fail(409, 'CHEQUE_USED_IN_SALE', saleMessage(current));
    if (body.expectedStatus != null && text(body.expectedStatus) !== (text(current.status) || 'Pendente'))
      fail(409, 'CHEQUE_CHANGED', 'A situação deste cheque mudou em outra tela. Atualize a lista.');
    const status = nextChequeStatus(current.status);
    const updated: Row = { ...current, status, alteradoPor: actor(context.identity), _upd: context.now() };
    if (status === 'Devolvido') updated.motivoDevolucao = text(body.motivo, 200);
    if (status === 'Pendente') updated.motivoDevolucao = '';
    const next = list.map((item, at) => (at === index ? updated : item));
    await save(context, 'chequesCli', client, next);
    return { action: 'cycle-cheque-status', cliente: client, status, cheques: next };
  });
}

async function deleteCheque(context: Context, body: Row) {
  const client = clientName(body.cliente);
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/chequesCli/' + client));
    const index = found(list, body);
    const current = list[index] as Row;
    if (usedInSale(current))
      fail(
        409,
        'CHEQUE_USED_IN_SALE',
        saleMessage(current).replace('Para mudar número, banco, valor ou situação', 'Para excluir'),
      );
    if (fromReceipt(current))
      fail(
        409,
        'CHEQUE_FROM_RECEIPT',
        'Este cheque veio do recebimento de uma conta a receber. Para excluí-lo, estorne o recebimento em Contas a Receber.',
      );
    const next = list.filter((_, at) => at !== index);
    await save(context, 'chequesCli', client, next);
    return { action: 'delete-cheque', cliente: client, cheques: next };
  });
}

async function ledgerClient(db: Database, value: unknown): Promise<string> {
  const name = clientName(value);
  const wanted = nameKey(name);
  const [raw, deleted, ...own] = await Promise.all([
    read(db, 'erp/clientes'),
    read(db, 'erp/clientesDeleted'),
    ...['fcLanc', 'fcSaldoIni', 'adtCli', 'chequesCli'].map((node) => read(db, 'erp/' + node + '/' + name)),
  ]);
  if (customerEntries(raw, tombstoneIds(deleted)).some((entry) => nameKey(entry.record.nome) === wanted))
    return name;
  if (own.some((item) => item != null)) return name;
  const [sales, receivables] = await Promise.all([read(db, 'erp/vendas'), read(db, 'erp/contasReceber')]);
  if (
    listOf(sales).some((row) => nameKey(row.cliente) === wanted) ||
    listOf(receivables).some((row) => nameKey(row.cli) === wanted)
  )
    return name;
  return fail(422, 'CLIENT_NOT_FOUND', 'Cliente não encontrado no cadastro nem nas vendas. Atualize a tela.');
}

async function saveEntry(context: Context, body: Row) {
  const client = await ledgerClient(context.db, body.cliente);
  const input = isRow(body.entry) ? body.entry : {};
  const { fields, problem } = cleanEntry(input);
  if (problem) fail(422, problem.code, problem.message);
  const id = text(input.id, 60);
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/fcLanc/' + client));
    let entry: Row;
    let next: Row[];
    if (id) {
      const index = list.findIndex((row) => text(row.id, 60) === id);
      if (index < 0) fail(404, 'ENTRY_NOT_FOUND', 'Lançamento não encontrado. Atualize a ficha.');
      const current = list[index] as Row;
      const expected = isRow(body.expected) ? body.expected : null;
      if (
        expected &&
        (Math.round(Number(expected.debito || 0) * 100) !== Math.round(Number(current.debito || 0) * 100) ||
          Math.round(Number(expected.credito || 0) * 100) !== Math.round(Number(current.credito || 0) * 100))
      )
        fail(409, 'ENTRY_CHANGED', 'Este lançamento mudou em outra tela. Atualize a ficha e tente de novo.');
      entry = { ...current, ...fields, id, alteradoPor: actor(context.identity), _upd: context.now() };
      next = list.map((row, at) => (at === index ? entry : row));
    } else {
      const taken = new Set(list.map((row) => text(row.id, 60)));
      entry = {
        id: nextEntryId(taken, context.now(), context.random),
        ...fields,
        criadoPor: actor(context.identity),
      };
      next = [...list, entry];
    }
    await save(context, 'fcLanc', client, next);
    return { action: 'save-entry', cliente: client, entry, entries: next };
  });
}

async function deleteEntry(context: Context, body: Row) {
  const client = clientName(body.cliente);
  const id = text(body.id, 60);
  if (!id) fail(422, 'ENTRY_NOT_FOUND', 'Lançamento não encontrado. Atualize a ficha.');
  return lock(context, client, async () => {
    const list = listOf(await read(context.db, 'erp/fcLanc/' + client));
    const removed = list.find((row) => text(row.id, 60) === id);
    if (!removed) fail(404, 'ENTRY_NOT_FOUND', 'Lançamento não encontrado. Atualize a ficha.');
    const next = list.filter((row) => row !== removed);
    await save(context, 'fcLanc', client, next);
    return { action: 'delete-entry', cliente: client, removed, entries: next };
  });
}

async function setOpeningBalance(context: Context, body: Row) {
  const client = await ledgerClient(context.db, body.cliente);
  const { fields, problem } = cleanOpeningBalance(body.balance);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, client, async () => {
    const tombstones: unknown = await read(context.db, 'erp/fcSaldoIniDeleted');
    const updates: Row = {
      ['erp/fcSaldoIni/' + client]: fields
        ? { ...fields, alteradoPor: actor(context.identity), _upd: context.now() }
        : null,
      'erp/_ts': context.now(),
    };
    if (fields && Array.isArray(tombstones) && tombstones.some((item) => item === client))
      updates['erp/fcSaldoIniDeleted'] = tombstones.filter((item) => item !== client);
    if (fields && isRow(tombstones) && client in tombstones)
      updates['erp/fcSaldoIniDeleted/' + client] = null;
    await context.db.ref().update(updates);
    return {
      action: 'set-opening-balance',
      cliente: client,
      balance: updates['erp/fcSaldoIni/' + client] ?? null,
    };
  });
}

const ACTIONS: Record<string, (context: Context, body: Row) => Promise<Row>> = {
  'create-advance': createAdvance,
  'delete-advance': deleteAdvance,
  'create-cheques': createCheques,
  'update-cheque': updateCheque,
  'cycle-cheque-status': cycleChequeStatus,
  'delete-cheque': deleteCheque,
  'save-entry': saveEntry,
  'delete-entry': deleteEntry,
  'set-opening-balance': setOpeningBalance,
};

export async function changeClientCredit(identity: Identity, input: unknown, deps: ClientCreditDeps = {}) {
  const body = isRow(input) ? input : null;
  if (!body) return fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  if (identity.erpAccess !== true || identity.canFinance !== true)
    fail(403, 'FINANCE_REQUIRED', 'Seu perfil não pode alterar adiantamentos e cheques de clientes.');
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
    ? db.ref('erp/clientCreditOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  const result = clean(await action(context, body));
  if (opRef) await opRef.set({ result, createdAt: context.now() });
  return result;
}
