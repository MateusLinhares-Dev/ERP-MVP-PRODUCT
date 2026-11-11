import { randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { fail } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLease } from '../../../shared/firebase/rtdb-transaction.js';
import type { PayableRecord, PaymentRecord } from './payables.js';

type Row = Record<string, unknown>;

export interface ReversalInput {
  payableId?: unknown;
  operationId?: unknown;
  paymentIndex?: unknown;
  payment?: { data?: unknown; valor?: unknown; movBancoId?: unknown };
  expected?: { valor?: unknown; status?: unknown; paymentsCount?: unknown };
}

export interface ReversalDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface TicketRow {
  totalGeral?: number;
  adiantamento?: number;
  pedidoCompra?: { totalPedido?: number };
  saldoPagar?: number;
  status?: string;
  [field: string]: unknown;
}

const LOCK_TTL_MS = 120000;
const SAFE_KEY = /^[A-Za-z0-9_-]{1,120}$/;

const text = (value: unknown, max = 160): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function key(value: unknown): string {
  const result = text(value, 120);
  if (!result || /[.#$[\]/]/.test(result) || hasControlChars(result))
    fail(422, 'INVALID_KEY', 'Identificador inválido.');
  return result;
}

const toCents = (value: unknown): number => Math.round((Number(value) || 0) * 100);
const money = (value: number): number => Math.round(value) / 100;

const entries = (value: unknown): [string, Row][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, Row] =>
      Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

async function findPayable(db: Database, id: string): Promise<[string, PayableRecord] | null> {
  const direct: unknown = (await db.ref('erp/contasPagar/' + id).get()).val();
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const record = direct as PayableRecord;
    if (record.id == null || String(record.id) === id) return [id, record];
  }
  const found = entries((await db.ref('erp/contasPagar').get()).val()).find(
    ([path, row]) => path === id || String(row.id) === id,
  );
  return found ? [found[0], found[1] as PayableRecord] : null;
}

async function findMovement(db: Database, id: string): Promise<[string, Row] | null> {
  const direct: unknown = (await db.ref('erp/lancBanco/' + id).get()).val();
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return [id, direct as Row];
  return (
    entries((await db.ref('erp/lancBanco').get()).val()).find(([, row]) => String(row.id) === id) ?? null
  );
}

function ticketStatus(ticket: TicketRow, balance: number): string {
  if (balance <= 0) return 'Pago';
  const nominal = toCents(ticket.totalGeral ?? ticket.pedidoCompra?.totalPedido ?? 0);
  const opening = nominal - toCents(ticket.adiantamento ?? 0);
  return opening > 0 && balance >= opening ? 'Pendente' : 'Parcial';
}

export async function reversePayablePayment(
  identity: Identity,
  input: ReversalInput,
  { db, now = () => Date.now(), uuid = randomUUID }: ReversalDeps = {},
) {
  if (identity.erpAccess !== true || identity.canPayables !== true)
    fail(403, 'PAYABLES_REQUIRED', 'Sem acesso a Contas a Pagar.');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const id = key(input.payableId);
  const operationId = key(input.operationId);
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) fail(422, 'INVALID_OPERATION', 'Operação inválida.');
  const index = Number(input.paymentIndex);
  if (!Number.isInteger(index) || index < 0) fail(422, 'INVALID_PAYMENT', 'Pagamento inválido.');
  const instance = await database(db);
  const opKey =
    key(String(identity.uid || identity.erpUser || 'user').replace(/[^a-zA-Z0-9_-]/g, '_')) +
    '_' +
    operationId;
  const opRef = instance.ref('erp/financePayableOperations/' + opKey);
  const replay = (await opRef.get()).val() as { result?: Row } | null;
  if (replay?.result) return { ...replay.result, alreadyCommitted: true };
  const lockRef = instance.ref('erpFinancePayableLocks/' + id);
  const owner = uuid();
  if (
    !(await acquireLease(lockRef, owner, {
      now,
      ttlMs: LOCK_TTL_MS,
      meta: { operationKey: opKey, kind: 'payable-reversal' },
    }))
  ) {
    fail(
      409,
      'PAYMENT_IN_PROGRESS',
      'Há outra operação em andamento nesta conta. Aguarde alguns segundos e tente de novo.',
    );
  }
  let ticketLock: Reference | null = null;
  let committed = false;
  try {
    const found = await findPayable(instance, id);
    if (!found) fail(404, 'PAYABLE_NOT_FOUND', 'Conta não encontrada na nuvem.');
    const [path, original] = found;
    const payments: PaymentRecord[] = Array.isArray(original.pagamentos) ? original.pagamentos : [];
    const expected = input.expected ?? {};
    if (
      (expected.valor != null && toCents(expected.valor) !== toCents(original.valor)) ||
      (expected.status != null && String(expected.status) !== String(original.status)) ||
      (expected.paymentsCount != null && Number(expected.paymentsCount) !== payments.length)
    ) {
      fail(409, 'PAYABLE_CHANGED', 'A conta foi alterada em outra tela. Atualize e tente de novo.');
    }
    const payment = payments[index];
    if (!payment) fail(404, 'PAYMENT_NOT_FOUND', 'Pagamento não encontrado. Atualize e tente de novo.');
    const claimed = input.payment ?? {};
    if (
      text(claimed.data) !== text(payment.data) ||
      toCents(claimed.valor) !== toCents(payment.valor) ||
      text(claimed.movBancoId) !== text(payment.movBancoId)
    ) {
      fail(409, 'PAYABLE_CHANGED', 'O pagamento mudou em outra tela. Atualize e tente de novo.');
    }
    if (toCents(payment.adt) > 0) {
      fail(
        409,
        'PAYMENT_HAS_ADVANCE',
        'Este pagamento usou adiantamento. Para não desfazer a compensação pela metade, peça ajuda ao suporte.',
      );
    }
    const cash = toCents(payment.valor);
    if (cash <= 0) fail(422, 'EMPTY_PAYMENT', 'Este pagamento não tem valor em dinheiro para excluir.');
    const updates: Row = {};
    let removedMovementId = '';
    const movementId = text(payment.movBancoId, 120);
    if (movementId && SAFE_KEY.test(movementId)) {
      const movement = await findMovement(instance, movementId);
      if (movement) {
        const movementPayable = text(movement[1].payableId);
        if (movementPayable && movementPayable !== id)
          fail(409, 'MOVEMENT_MISMATCH', 'A saída no banco pertence a outra conta. Nada foi alterado.');
        updates['lancBanco/' + movement[0]] = null;
        updates['lancBancoDeletedV2/' + movementId] = true;
        removedMovementId = movementId;
      }
    }
    const updated: PayableRecord = {
      ...original,
      pagamentos: payments.filter((_, position) => position !== index),
      valorPago: money(Math.max(0, toCents(original.valorPago) - cash)),
      _upd: now(),
    };
    if (original.status === 'Pago') {
      updated.status = 'Pendente';
      updated.valor = money(cash);
      updated.dataPgto = '';
    } else {
      updated.valor = money(toCents(original.valor) + cash);
    }
    if (movementId && String(original.movBancoIdCP || '') === movementId) delete updated.movBancoIdCP;
    updates['contasPagar/' + path] = updated;
    let ticket: TicketRow | null = null;
    const ticketKey = text(original.ticket);
    if (ticketKey) {
      const safeTicket = key(ticketKey);
      const candidate = instance.ref('erpFinancePayableTicketLocks/' + safeTicket);
      if (
        !(await acquireLease(candidate, owner, {
          now,
          ttlMs: LOCK_TTL_MS,
          meta: { kind: 'payable-reversal' },
        }))
      )
        fail(
          409,
          'TICKET_IN_PROGRESS',
          'Outra operação desta compra está em andamento. Aguarde alguns segundos e tente de novo.',
        );
      ticketLock = candidate;
      const current = (await instance.ref('erp/tickets/' + safeTicket).get()).val() as TicketRow | null;
      if (current) {
        const balance = toCents(current.saldoPagar) + cash;
        ticket = { ...current, saldoPagar: money(balance), status: ticketStatus(current, balance) };
        updates['tickets/' + safeTicket] = ticket;
      }
    }
    const result = {
      payable: updated,
      payableKey: path,
      ticket,
      ticketKey: ticket ? ticketKey : '',
      removedMovementId,
      reversedAmount: money(cash),
    };
    updates['financePayableOperations/' + opKey] = {
      result,
      kind: 'reversal',
      createdAt: now(),
      actor: text(identity.erpUser),
    };
    const atomic: Row = Object.fromEntries(
      Object.entries(updates).map(([field, value]) => ['erp/' + field, value]),
    );
    atomic['erp/_ts'] = now();
    atomic['erpFinancePayableLocks/' + id] = null;
    if (ticketLock) atomic['erpFinancePayableTicketLocks/' + key(ticketKey)] = null;
    await instance.ref().update(atomic);
    committed = true;
    return result;
  } finally {
    if (!committed) {
      if (ticketLock) await releaseLease(ticketLock, owner, { label: 'payable.reversal.ticket.release' });
      await releaseLease(lockRef, owner, { label: 'payable.reversal.release' });
    }
  }
}
