import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { toBRDate } from '../../../shared/domain/dates.js';
import { nameKey } from '../../../shared/domain/person.js';
import { fail } from '../../../shared/errors/app-error.js';
import { customerLockPath, withLocks as lockAll } from '../../../shared/firebase/locks.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import { applyCredits, listOf, restoreCredits } from '../domain/sale-credits.js';
import { orderInput, validId } from '../domain/sale-input.js';
import { buildCommit, methodNeedsBank, orderFromSale, validateOrder } from '../domain/sale-order.js';
import type { BankOption, SaleOrder } from '../domain/sale-order.js';
import { RECEIVED, clientCredits, isRaw, isSaleWeighing, receivablesOf, text } from '../domain/sales.js';
import type { Raw, SalesData } from '../domain/sales.js';

export interface SalesDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

type Context = { db: Database; identity: Identity; now: () => number; uuid: () => string };

const KEY_CHARS = /[.#$/[\]]/;
const CREDIT_FORMS = new Set(['Adiantamento', 'Cheque']);

const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const clientLock = customerLockPath;
const saleLock = (id: string): string => 'erpSalesLocks/v-' + id;

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

function keyed(value: unknown): Raw[] {
  return Object.entries(value && typeof value === 'object' ? (value as Raw) : {})
    .filter((entry): entry is [string, Raw] => isRaw(entry[1]))
    .map(([key, row]) => ({ ...row, id: text(row.id) || key }));
}

async function saleReceivables(db: Database, sale: Raw): Promise<Raw[]> {
  const id = text(sale.id);
  const linked = id
    ? keyed((await db.ref('erp/contasReceber').orderByChild('vendaId').equalTo(id).get()).val())
    : [];
  if (linked.length) return linked;
  const client = text(sale.cliente);
  if (!client) return [];
  const sameClient = keyed(
    (await db.ref('erp/contasReceber').orderByChild('cli').equalTo(client).get()).val(),
  );
  return receivablesOf(
    { sales: [], receivables: sameClient, clientAdvances: {}, clientCheques: {}, tickets: {} },
    sale,
  );
}

async function clientLists(db: Database, client: string): Promise<{ advances: Raw[]; cheques: Raw[] }> {
  if (!client || KEY_CHARS.test(client)) return { advances: [], cheques: [] };
  const [advances, cheques] = await Promise.all([
    read(db, 'erp/adtCli/' + client),
    read(db, 'erp/chequesCli/' + client),
  ]);
  return { advances: listOf(advances), cheques: listOf(cheques) };
}

function bankOptions(raw: unknown): BankOption[] {
  return keyed(raw)
    .map((bank) => ({ cod: text(bank.cod) || text(bank.id), banco: text(bank.banco) }))
    .filter((bank) => bank.cod);
}

const withLocks = <T>(context: Context, paths: string[], work: () => Promise<T>): Promise<T> =>
  lockAll(
    context.db,
    paths,
    {
      now: context.now,
      uuid: context.uuid,
      code: 'SALE_IN_PROGRESS',
      message:
        'Outra operação desta venda ou deste cliente está em andamento. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

async function allocateNumber(db: Database): Promise<string> {
  const ref = db.ref('erp/salesNumberSeq');
  let scanned = 0;
  if (!(Number(await read(db, 'erp/salesNumberSeq')) > 0)) {
    for (const sale of keyed(await read(db, 'erp/vendas'))) {
      const match = /^V(\d{1,8})$/i.exec(text(sale.nf));
      if (match) scanned = Math.max(scanned, Number(match[1]));
    }
  }
  const result = await runTransaction(ref, (current) => Math.max(Number(current) || 0, scanned) + 1);
  const value = Number(result.snapshot?.val());
  if (!result.committed || !Number.isFinite(value))
    fail(409, 'SALE_NUMBER_BUSY', 'Não foi possível numerar a venda. Tente de novo.');
  return 'V' + String(value).padStart(4, '0');
}

const actor = (identity: Identity): string => text(identity.erpUser || identity.uid).slice(0, 80);

function requireSaleId(value: unknown): string {
  const id = text(value);
  if (!validId(id)) fail(422, 'INVALID_SALE', 'Venda inválida. Atualize a tela.');
  return id;
}

async function existingSale(db: Database, id: string): Promise<Raw> {
  const sale = await read(db, 'erp/vendas/' + id);
  if (!isRaw(sale)) fail(404, 'SALE_NOT_FOUND', 'Venda não encontrada. Atualize a tela.');
  return { ...(sale as Raw), id };
}

async function saveSale(context: Context, body: Raw) {
  const { db, identity, now, uuid } = context;
  const { order: input, problem } = orderInput(body.order);
  if (problem) fail(422, problem.code, problem.message);
  if (!input.client) fail(422, 'SALE_INVALID', 'Informe o cliente.');
  const first = input.saleId ? await existingSale(db, input.saleId) : null;
  const locks = [clientLock(input.client)];
  if (first) locks.push(saleLock(input.saleId), clientLock(first.cliente));
  return withLocks(context, locks, async () => {
    const previous = input.saleId ? await existingSale(db, input.saleId) : null;
    const expected = body.expectedUpdate;
    if (
      previous &&
      expected != null &&
      previous.atualizadoEm != null &&
      Number(previous.atualizadoEm) !== Number(expected)
    )
      fail(409, 'SALE_CHANGED', 'A venda foi alterada em outra tela. Feche e abra de novo.');
    const today = businessTodayISO(now());
    const receivables = previous ? await saleReceivables(db, previous) : [];
    const lists = await clientLists(db, input.client);
    const [banksRaw, cutoffRaw] = await Promise.all([
      read(db, 'erp/bancos'),
      read(db, 'erp/config/legacyRepairs/bankMovement/cutoffDate'),
    ]);
    const before =
      previous && Array.isArray(previous.pesagens) ? previous.pesagens.map(text).filter(validId) : [];
    const tickets: Record<string, Raw> = {};
    for (const key of new Set([...input.weighings, ...before])) {
      const ticket = await read(db, 'erp/tickets/' + key);
      if (isRaw(ticket)) tickets[key] = ticket;
    }
    const data: SalesData = {
      sales: previous ? [previous] : [],
      receivables,
      clientAdvances: { [input.client]: lists.advances },
      clientCheques: { [input.client]: lists.cheques },
      tickets,
    };
    let order: SaleOrder;
    if (previous) {
      const base = orderFromSale(data, previous, today);
      if (base.lockedClient && nameKey(base.client) !== nameKey(input.client))
        fail(
          422,
          'CLIENT_LOCKED',
          'Esta venda já tem recebimento ou abatimento: o cliente não pode ser trocado.',
        );
      const pending = new Set(base.installments.map((row) => row.receivableId).filter(Boolean));
      if (input.installments.some((row) => row.receivableId && !pending.has(row.receivableId)))
        fail(
          409,
          'SALE_CHANGED',
          'As parcelas desta venda mudaram em outra tela. Feche e abra a venda de novo.',
        );
      order = { ...input, locked: base.locked, lockedClient: base.lockedClient };
    } else
      order = { ...input, installments: input.installments.map((row) => ({ ...row, receivableId: '' })) };
    for (const key of input.weighings) {
      const ticket = tickets[key];
      if (!isSaleWeighing(ticket))
        fail(422, 'WEIGHING_INVALID', `A pesagem ${key} não é uma pesagem de venda finalizada.`);
      const linked = text(ticket.vendaId);
      if ((linked && linked !== input.saleId) || (ticket.vendaArquivada === true && !before.includes(key)))
        fail(409, 'WEIGHING_USED', `A pesagem ${text(ticket.ticket) || key} já foi usada em outra venda.`);
    }
    const credits = clientCredits(data, input.client);
    const message = validateOrder(order, credits);
    if (message) fail(422, 'SALE_INVALID', message);
    const banks = bankOptions(banksRaw);
    for (const row of order.installments)
      if (
        row.received &&
        row.bank &&
        methodNeedsBank(row.method) &&
        !banks.some((bank) => bank.cod === row.bank)
      )
        fail(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
    if (!previous && !order.number.trim()) order = { ...order, number: await allocateNumber(db) };
    let sequence = 0;
    const commit = buildCommit(order, {
      data,
      credits,
      banks,
      today,
      now: now(),
      user: actor(identity),
      newId: (prefix) =>
        prefix === 'VD-'
          ? 'VD-' + now() + uuid().replace(/-/g, '').slice(0, 4)
          : prefix + now().toString(36) + (++sequence).toString(36) + uuid().replace(/-/g, '').slice(0, 5),
    });
    const id = text(commit.sale.id);
    const saleRef = text(commit.sale.nf) || id;
    const advanceUses = commit.creditUses.filter((use) => use.kind === 'advance');
    const chequeUses = commit.creditUses.filter((use) => use.kind === 'cheque');
    const applied = applyCredits(lists.advances, lists.cheques, commit.creditUses, saleRef);
    if (applied.problem) fail(409, applied.problem.code, applied.problem.message);
    const cutoff = text(cutoffRaw);
    const movements: Raw[] = [];
    for (const movement of commit.bankMovements) {
      if (cutoff && movement.date < cutoff) continue;
      const movementId = 'LB-VD-' + now() + '-' + uuid().replace(/-/g, '').slice(0, 6);
      movements.push({
        id: movementId,
        bancoCod: movement.bank,
        data: toBRDate(movement.date),
        descricao: movement.description,
        tipo: 'Entrada',
        valor: movement.amount,
        vendaId: id,
        receivableId: movement.receivableId,
        origem: 'venda',
      });
      const receivable = commit.upsertReceivables.find((row) => text(row.id) === movement.receivableId);
      if (receivable) receivable.movBancoId = movementId;
    }
    const updates: Raw = { ['erp/vendas/' + id]: clean(commit.sale), 'erp/_ts': now() };
    for (const row of commit.upsertReceivables) updates['erp/contasReceber/' + text(row.id)] = clean(row);
    for (const removed of commit.removeReceivables) {
      updates['erp/contasReceber/' + removed] = null;
      updates['erp/contasReceberDeletedV2/' + removed] = true;
    }
    if (advanceUses.length) updates['erp/adtCli/' + input.client] = clean(applied.advances);
    if (chequeUses.length) updates['erp/chequesCli/' + input.client] = clean(applied.cheques);
    for (const movement of movements) updates['erp/lancBanco/' + text(movement.id)] = movement;
    for (const key of commit.linkWeighings) {
      updates[`erp/tickets/${key}/vendaId`] = id;
      updates[`erp/tickets/${key}/vendaRef`] = saleRef;
    }
    for (const key of commit.unlinkWeighings)
      if (text(tickets[key]?.vendaId) === id) {
        updates[`erp/tickets/${key}/vendaId`] = null;
        updates[`erp/tickets/${key}/vendaRef`] = null;
      }
    await db.ref().update(updates);
    return clean({
      action: 'save',
      sale: commit.sale,
      client: input.client,
      receivables: commit.upsertReceivables,
      removedReceivables: commit.removeReceivables,
      advances: advanceUses.length ? applied.advances : null,
      cheques: chequeUses.length ? applied.cheques : null,
      bankMovements: movements,
      linkWeighings: commit.linkWeighings,
      unlinkWeighings: commit.unlinkWeighings.filter((key) => text(tickets[key]?.vendaId) === id),
      saleRef,
    });
  });
}

const banked = (row: Raw): boolean => Boolean(text(row.banco)) && text(row.banco) !== '—';

function manualBank(rows: readonly Raw[]): Array<{ banco: string; valor: number }> {
  return rows
    .filter(
      (row) =>
        text(row.status) === RECEIVED &&
        !CREDIT_FORMS.has(text(row.forma)) &&
        !text(row.movBancoId) &&
        banked(row),
    )
    .map((row) => ({ banco: text(row.banco), valor: Number(row.valor) || 0 }));
}

function undoMovement(updates: Raw, row: Raw, undone: string[]): void {
  const movement = text(row.movBancoId);
  if (!validId(movement)) return;
  updates['erp/lancBanco/' + movement] = null;
  updates['erp/lancBancoDeletedV2/' + movement] = true;
  undone.push(movement);
}

async function deleteSale(context: Context, body: Raw) {
  const { db, now } = context;
  const id = requireSaleId(body.saleId);
  const first = await existingSale(db, id);
  return withLocks(context, [saleLock(id), clientLock(first.cliente)], async () => {
    const sale = await existingSale(db, id);
    const client = text(sale.cliente);
    const receivables = await saleReceivables(db, sale);
    const lists = await clientLists(db, client);
    const restored = restoreCredits(lists.advances, lists.cheques, sale, receivables);
    const updates: Raw = {
      ['erp/vendas/' + id]: null,
      ['erp/vendasDeletedV2/' + id]: true,
      'erp/_ts': now(),
    };
    const undone: string[] = [];
    for (const row of receivables) {
      updates['erp/contasReceber/' + text(row.id)] = null;
      updates['erp/contasReceberDeletedV2/' + text(row.id)] = true;
      undoMovement(updates, row, undone);
    }
    if (restored.restored && client && !KEY_CHARS.test(client)) {
      updates['erp/adtCli/' + client] = clean(restored.advances);
      updates['erp/chequesCli/' + client] = clean(restored.cheques);
    }
    const unlinked: string[] = [];
    for (const key of Array.isArray(sale.pesagens) ? sale.pesagens.map(text).filter(validId) : []) {
      if (text(await read(db, `erp/tickets/${key}/vendaId`)) !== id) continue;
      updates[`erp/tickets/${key}/vendaId`] = null;
      updates[`erp/tickets/${key}/vendaRef`] = null;
      unlinked.push(key);
    }
    await db.ref().update(updates);
    return clean({
      action: 'delete',
      saleId: id,
      client,
      removedReceivables: receivables.map((row) => text(row.id)),
      advances: restored.restored ? restored.advances : null,
      cheques: restored.restored ? restored.cheques : null,
      restored: restored.restored,
      bankUndone: undone,
      manualBank: manualBank(receivables),
      unlinkWeighings: unlinked,
    });
  });
}

async function settleSale(context: Context, body: Raw, paid: boolean) {
  const { db, identity, now } = context;
  const id = requireSaleId(body.saleId);
  return withLocks(context, [saleLock(id)], async () => {
    const sale = await existingSale(db, id);
    const today = toBRDate(businessTodayISO(now()));
    const receivables = await saleReceivables(db, sale);
    const updates: Raw = { 'erp/_ts': now() };
    const changed: Raw[] = [];
    const undone: string[] = [];
    for (const row of receivables) {
      if (CREDIT_FORMS.has(text(row.forma))) continue;
      const received = text(row.status) === RECEIVED;
      if (paid === received) continue;
      const next: Raw = {
        ...row,
        status: paid ? RECEIVED : 'Pendente',
        dataReceb: paid ? text(row.dataReceb) || today : '',
      };
      if (!paid) {
        undoMovement(updates, row, undone);
        delete next.movBancoId;
      }
      if (!text(row.vendaId)) next.vendaId = id;
      updates['erp/contasReceber/' + text(row.id)] = clean(next);
      changed.push(next);
    }
    const nextSale: Raw = {
      ...sale,
      status: paid ? 'Pago' : 'Pendente',
      atualizadoEm: now(),
      atualizadoPor: actor(identity),
    };
    updates['erp/vendas/' + id] = clean(nextSale);
    await db.ref().update(updates);
    return clean({
      action: paid ? 'mark-paid' : 'reopen',
      sale: nextSale,
      receivables: changed,
      bankUndone: undone,
      manualBank: paid ? [] : manualBank(receivables),
    });
  });
}

async function archiveWeighing(context: Context, body: Raw) {
  const { db, identity, now } = context;
  const key = text(body.ticket);
  if (!validId(key)) fail(422, 'WEIGHING_INVALID', 'Pesagem inválida. Atualize a tela.');
  const ticket = await read(db, 'erp/tickets/' + key);
  if (!isSaleWeighing(ticket) || text(ticket.vendaId))
    fail(409, 'WEIGHING_USED', 'Esta pesagem já virou venda ou não é uma pesagem de venda.');
  const fields = {
    vendaArquivada: true,
    vendaArquivadaEm: new Date(now()).toISOString(),
    vendaArquivadaPor: actor(identity),
  };
  const updates: Raw = { 'erp/_ts': now() };
  for (const [field, value] of Object.entries(fields)) updates[`erp/tickets/${key}/${field}`] = value;
  await db.ref().update(updates);
  return { action: 'archive-weighing', ticket: key, fields };
}

export async function changeSale(identity: Identity, input: unknown, deps: SalesDeps = {}) {
  if (identity.erpAccess !== true || identity.canSales !== true)
    fail(403, 'SALES_REQUIRED', 'Seu perfil não pode lançar ou alterar vendas.');
  if (!isRaw(input)) fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const body = input as Raw;
  const context: Context = {
    db: await database(deps.db),
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
  };
  const action = text(body.action).slice(0, 30);
  const operationId = text(body.operationId).slice(0, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? context.db.ref('erp/salesOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Raw } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  let result: Raw;
  if (action === 'save') result = await saveSale(context, body);
  else if (action === 'delete') result = await deleteSale(context, body);
  else if (action === 'mark-paid') result = await settleSale(context, body, true);
  else if (action === 'reopen') result = await settleSale(context, body, false);
  else if (action === 'archive-weighing') result = await archiveWeighing(context, body);
  else return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  if (opRef) await opRef.set({ result, createdAt: context.now() });
  return result;
}
