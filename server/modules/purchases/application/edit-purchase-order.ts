import { createHash, randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { isoToBrazilianDate } from '../../../shared/domain/business-date.js';
import { acquireLease, releaseLeases, type LeaseEntry } from '../../../shared/firebase/rtdb-transaction.js';
import { supplierOptions, supplierTombstones } from '../../suppliers/domain/supplier-directory.js';
import { refundAdvanceReceipt } from '../domain/advance-refund.js';
import {
  MAX_INSTALLMENTS,
  installmentPayableIds,
  installmentSignature,
  normalizeInstallments,
  type Installment,
} from '../domain/installments.js';
import {
  adjustLedger,
  adjustPayable,
  adjustReceipt,
  adjustmentOfCredit,
  applyPlan,
  applySupplier,
  assemble,
  assertSupplierChangeAllowed,
  currentPlan,
  purchasePayables,
  replanPayables,
  shiftOpenInstallment,
  untouchedPayable,
  type EditInput,
  type OpenInstallmentShift,
  type Replan,
} from '../domain/purchase-edit.js';
import {
  cash,
  reject,
  round,
  rowEntries,
  type PayableRow,
  type PurchaseTicket,
  type Row,
} from '../domain/purchase-records.js';

export { refundAdvanceReceipt } from '../domain/advance-refund.js';

async function activeSupplier(
  db: Database,
  code: string,
): Promise<{ cod: string; nome: string } | undefined> {
  const paths = [
    'erp/fornecedores',
    'erp/fornDeleted',
    'erp/fornDeletedV2',
    'erp/fornecedoresDeleted',
    'erp/fornecedoresDeletedV2',
  ];
  const [suppliers, ...tombstones] = (await Promise.all(paths.map((path) => db.ref(path).get()))).map(
    (snap): unknown => snap.val(),
  );
  const deletedCodes = new Set([...supplierTombstones(tombstones[0]), ...supplierTombstones(tombstones[1])]);
  const deletedIds = new Set([...supplierTombstones(tombstones[2]), ...supplierTombstones(tombstones[3])]);
  return supplierOptions(suppliers, deletedCodes, deletedIds).find((supplier) => supplier.cod === code);
}

export interface EditDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

type HeldLock = LeaseEntry & { ref: Reference; path: string };

function key(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(text)) reject(422, 'INVALID_KEY', 'Código inválido.');
  return text;
}

function signature(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(signature).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Row;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((field) => JSON.stringify(field) + ':' + signature(record[field]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

const hash = (value: unknown): string => createHash('sha256').update(signature(value)).digest('hex');

async function acquire(ref: Reference, owner: string, now: () => number): Promise<void> {
  const acquired = await acquireLease(ref, owner, { now, ttlMs: 120000, meta: { kind: 'purchase-edit' } });
  if (!acquired) {
    reject(
      409,
      'EDIT_IN_PROGRESS',
      'Outro lançamento financeiro está em andamento. Aguarde alguns segundos e tente novamente.',
    );
  }
}

function committedReceipt(record: unknown, ticketNo: string): Row | null {
  const stored = record as { ticket?: PurchaseTicket } | null;
  if (!stored?.ticket) return null;
  if (String(stored.ticket.ticket) !== ticketNo)
    reject(409, 'OPERATION_USED', 'Identificador de operação já utilizado.');
  return { ...stored, alreadyCommitted: true };
}

const hasPaidAmount = (row: PayableRow): boolean =>
  Number(row.valorPago || 0) > 0 ||
  (Array.isArray(row.pagamentos) ? row.pagamentos : []).some(
    (payment) => Number((payment as Row | null)?.valor || 0) > 0,
  );

function patchSinglePayable(
  updates: Row,
  payablesRaw: unknown,
  ticketNo: string,
  single: Installment,
  planChanged: boolean,
  at: number,
): void {
  const payableId = 'CPPO_' + ticketNo;
  const stored = rowEntries<PayableRow>(payablesRaw);
  const path = Object.prototype.hasOwnProperty.call(updates, 'contasPagar/' + payableId)
    ? payableId
    : planChanged
      ? stored.find(
          ([entry, row]) =>
            entry === payableId && String(row.id || '') === payableId && row.status === 'Pendente',
        )?.[0]
      : undefined;
  if (!path) return;
  const base =
    (updates['contasPagar/' + path] as PayableRow | undefined) ??
    stored.find(([entry]) => entry === path)?.[1];
  if (base?.status !== 'Pendente') return;
  const patched: PayableRow = { ...base, venc: isoToBrazilianDate(single.vencimento), _upd: at };
  if (single.forma) patched.formaPrevista = single.forma;
  else delete patched.formaPrevista;
  if (single.obs) patched.obs = single.obs;
  updates['contasPagar/' + path] = patched;
}

export async function editPurchaseOrder(
  identity: Identity,
  input: EditInput,
  { db: injected, now = () => Date.now(), uuid = randomUUID }: EditDeps = {},
) {
  if (identity.erpAccess !== true || identity.canPurchasing !== true) {
    reject(403, 'PURCHASE_FORBIDDEN', 'Sem autorização para editar compras.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    reject(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const ticketNo = key(input.ticketNo);
  const opId = key(input.operationId);
  if (!/^[a-f0-9-]{36}$/i.test(opId)) reject(422, 'INVALID_OPERATION', 'Operação inválida.');
  const expected = input.expectedTicket;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    reject(422, 'EXPECTED_TICKET_REQUIRED', 'A versão original do pedido é obrigatória.');
  }
  const db = injected ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey =
    key(String(identity.uid || identity.erpUser || 'operador').replace(/[^\w-]/g, '_')) + '_' + opId;
  const opRef = db.ref('erp/purchaseEditOperations/' + opKey);
  const earlier = committedReceipt((await opRef.get()).val(), ticketNo);
  if (earlier) return earlier;
  const incomingTicket = (input.ticket ?? {}) as PurchaseTicket;
  const requestedCount = Array.isArray(incomingTicket.parcelas) ? incomingTicket.parcelas.length : 0;
  if (requestedCount > MAX_INSTALLMENTS)
    reject(422, 'TOO_MANY_INSTALLMENTS', 'Máximo de ' + MAX_INSTALLMENTS + ' parcelas.');
  const first = (await db.ref('erp/tickets/' + ticketNo).get()).val() as PurchaseTicket | null;
  if (!first) reject(404, 'TICKET_NOT_FOUND', 'Pedido não encontrado.');
  const firstCount = Array.isArray(first.parcelas) ? first.parcelas.length : 0;
  const payableLockIds = [
    ...new Set([
      ...installmentPayableIds(ticketNo, firstCount),
      ...installmentPayableIds(ticketNo, requestedCount),
    ]),
  ].sort();
  const code = key(first.fornecedorCod || first.fornCod);
  const owner = uuid();
  const locks: HeldLock[] = [];
  let committed = false;
  try {
    const lockPaths = [
      'erpFinancePayableTicketLocks/' + ticketNo,
      ...payableLockIds.map((id) => 'erpFinancePayableLocks/' + id),
    ];
    for (const path of lockPaths) {
      const ref = db.ref(path);
      await acquire(ref, owner, now);
      locks.push({ ref, path });
    }
    const priorReceipt = committedReceipt((await opRef.get()).val(), ticketNo);
    if (priorReceipt) return priorReceipt;
    const paths = [
      'erp/tickets/' + ticketNo,
      'erp/adiantamentos/' + code,
      'erp/saldos/' + code,
      'erp/saldoDevedor/' + code,
      'erp/contasPagar',
    ];
    const snaps = await Promise.all(paths.map((path) => db.ref(path).get()));
    const value = (index: number): unknown => snaps[index]?.val();
    const previous = value(0) as PurchaseTicket | null;
    if (!previous || hash(previous) !== hash(expected)) {
      reject(
        409,
        'TICKET_CHANGED',
        'O pedido mudou no Firebase. Reabra o histórico para editar os valores atuais.',
      );
    }
    const result = assemble(previous, input);
    const requestedSupplier = String(incomingTicket.fornecedorCod ?? '').trim();
    const supplierChanged = Boolean(requestedSupplier) && requestedSupplier !== code;
    const supplierCode = supplierChanged ? key(requestedSupplier) : code;
    if (supplierChanged) {
      assertSupplierChangeAllowed(previous, value(4), ticketNo);
      const supplier = await activeSupplier(db, supplierCode);
      if (!supplier)
        reject(
          422,
          'SUPPLIER_NOT_FOUND',
          'Fornecedor não encontrado ou inativo. Atualize a lista e selecione novamente.',
        );
      applySupplier(result.ticket, supplier.cod, supplier.nome);
    }
    const updates: Row = { ['tickets/' + ticketNo]: result.ticket };
    const changed = result.difference !== 0;
    const advancesUsed = Number(previous.adiantamento || 0) > 0;
    if (changed && advancesUsed) {
      const creditLock = db.ref('erpFinanceAdvanceLocks/' + code);
      await acquire(creditLock, owner, now);
      locks.push({ ref: creditLock, path: 'erpFinanceAdvanceLocks/' + code });
      snaps[1] = await db.ref('erp/adiantamentos/' + code).get();
      snaps[2] = await db.ref('erp/saldos/' + code).get();
      snaps[3] = await db.ref('erp/saldoDevedor/' + code).get();
      const live: unknown = (await db.ref('erp/tickets/' + ticketNo).get()).val();
      if (!live || hash(live) !== hash(previous))
        reject(409, 'TICKET_CHANGED', 'O pedido mudou durante a edição. Reabra o Histórico.');
    }
    let advanceRefund: Row | null = null;
    let replanned: Replan | null = null;
    const oldBalance = cash(Number(previous.saldoPagar || 0));
    const previousPlan = Array.isArray(previous.parcelas) ? (previous.parcelas as unknown[]) : [];
    let openShift: OpenInstallmentShift | null = null;
    if (
      oldBalance > 0 &&
      previousPlan.length > 1 &&
      changed &&
      purchasePayables(value(4), ticketNo, previous).rows.some(([, row]) => !untouchedPayable(row))
    ) {
      openShift = shiftOpenInstallment({
        raw: value(4),
        ticketNo,
        previous,
        oldBalance,
        nextBalance: result.balance,
        at: now(),
      });
      Object.assign(updates, openShift.updates);
      result.ticket.parcelas = openShift.plan;
    }
    const rawRequested = openShift
      ? null
      : Array.isArray(incomingTicket.parcelas)
        ? incomingTicket.parcelas
        : previousPlan.length > 1
          ? previousPlan
          : null;
    const requested =
      (rawRequested || supplierChanged) && result.balance > 0
        ? normalizeInstallments(rawRequested, {
            balanceCents: result.balance,
            purchaseDate: String(result.ticket.dataCompra),
            defaultDueDate: String(result.ticket.vencimentoSaldo),
          })
        : null;
    const requestedLength = requested?.length ?? 0;
    if (oldBalance <= 0 && requestedLength > 1) {
      reject(
        409,
        'INSTALLMENTS_AFTER_PAYMENT',
        'Esta compra já estava quitada: a diferença vira uma conta única em Contas a Pagar. Deixe uma parcela só.',
      );
    }
    const multi = oldBalance > 0 && (previousPlan.length > 1 || requestedLength > 1 || supplierChanged);
    const planChanged =
      installmentSignature(currentPlan(previous) as Installment[]) !== installmentSignature(requested ?? []);
    const refundToAdvance = (): void => {
      const refund = refundAdvanceReceipt(previous, value(1), -result.balance, ticketNo, now());
      updates['adiantamentos/' + code] = refund.records;
      result.ticket.reciboFinanceiro = refund.receipt;
      result.ticket.adiantamento = round(refund.applied);
      result.ticket.saldoPagar = 0;
      result.ticket.status = 'Pago';
      advanceRefund = { valor: round(-result.balance), adiantamentos: refund.refunds };
    };
    if (openShift) {
      result.ticket.status = previous.status === 'Parcial' ? 'Parcial' : 'Pendente';
    } else if (multi && (changed || planChanged || supplierChanged)) {
      if (result.balance < 0 && !advancesUsed) {
        reject(
          409,
          'FINANCE_RECONCILIATION_REQUIRED',
          'O valor altera a natureza do saldo do pedido. Essa mudança exige conciliação específica.',
        );
      }
      if (result.balance < 0) refundToAdvance();
      replanned = replanPayables({
        raw: value(4),
        ticketNo,
        previous,
        next: result.ticket,
        installments: requested ?? [],
        supplierCode,
        oldBalance,
        at: now(),
      });
      Object.assign(updates, replanned.updates);
      applyPlan(result.ticket, requested ?? []);
    } else if (changed) {
      const payments = rowEntries<PayableRow>(value(4))
        .map(([, row]) => row)
        .filter((row) => String(row.ticket || '') === ticketNo);
      if (oldBalance < 0 && result.balance <= 0 && advancesUsed) {
        if (payments.some(hasPaidAmount)) {
          reject(
            409,
            'PAID_AND_ADVANCE_RECONCILIATION_REQUIRED',
            'Existem pagamentos e adiantamentos vinculados ao mesmo pedido. É necessária conciliação específica.',
          );
        }
        const changes = adjustReceipt(previous, result.ticket, result.total, value(1), ticketNo);
        updates['adiantamentos/' + code] = adjustLedger(value(1), changes, ticketNo);
        const oldCredit = -oldBalance;
        const newCredit = Math.max(0, -result.balance);
        const saldo = adjustmentOfCredit(value(2), oldCredit, newCredit, ticketNo);
        const legacy = adjustmentOfCredit(value(3), oldCredit, newCredit, ticketNo);
        if (saldo !== null) updates['saldos/' + code] = saldo;
        if (legacy !== null) updates['saldoDevedor/' + code] = legacy;
      } else if (oldBalance >= 0 && result.balance >= 0) {
        const payable = adjustPayable(
          value(4) ?? [],
          ticketNo,
          oldBalance,
          result.balance,
          opId,
          code,
          previous,
        );
        updates['contasPagar/' + payable.path] = payable.updated;
      } else if (oldBalance >= 0 && result.balance < 0 && advancesUsed) {
        refundToAdvance();
        if (oldBalance > 0) {
          const payable = adjustPayable(value(4) ?? [], ticketNo, oldBalance, 0, opId, code, previous);
          updates['contasPagar/' + payable.path] = payable.updated;
        }
      } else {
        reject(
          409,
          'FINANCE_RECONCILIATION_REQUIRED',
          'O valor altera a natureza do saldo do pedido. Essa mudança exige conciliação específica.',
        );
      }
    }
    const single = requested?.length === 1 ? requested[0] : undefined;
    if (!replanned && single && Number(result.ticket.saldoPagar) > 0) {
      applyPlan(result.ticket, [single]);
      patchSinglePayable(updates, value(4), ticketNo, single, planChanged, now());
    } else if (!replanned && Number(result.ticket.saldoPagar) <= 0 && !multi) {
      delete result.ticket.parcelas;
    }
    updates._ts = now();
    const firstPayable =
      Object.entries(updates).find(([path, row]) => path.startsWith('contasPagar/') && row)?.[1] ?? null;
    const record = {
      ticket: result.ticket,
      advances: updates['adiantamentos/' + code] || null,
      saldo: updates['saldos/' + code] || null,
      creditLegacy: updates['saldoDevedor/' + code] || null,
      payable: replanned ? (replanned.payables[0] ?? null) : firstPayable,
      ...(replanned ? { payables: replanned.payables, removedPayableIds: replanned.removed } : {}),
      ...(advanceRefund ? { advanceRefund } : {}),
      updatedAt: now(),
      actor: String(identity.erpUser || identity.uid || ''),
    };
    updates['purchaseEditOperations/' + opKey] = record;
    const atomic: Row = Object.fromEntries(
      Object.entries(updates).map(([path, row]) => ['erp/' + path, row]),
    );
    for (const lock of locks) {
      const live = (await lock.ref.get()).val() as { owner?: string } | null;
      if (live?.owner !== owner) reject(409, 'PURCHASE_EDIT_BUSY', 'A edição foi alterada por outra sessão.');
      atomic[lock.path] = null;
    }
    try {
      await db.ref().update(atomic);
      committed = true;
    } catch (error) {
      const confirmed = (await opRef.get().catch(() => null))?.val() as
        | { ticket?: PurchaseTicket }
        | null
        | undefined;
      if (confirmed?.ticket && String(confirmed.ticket.ticket) === ticketNo) {
        committed = true;
        return { ...confirmed, alreadyCommitted: true };
      }
      throw error;
    }
    return { ...record, alreadyCommitted: false };
  } finally {
    if (!committed) await releaseLeases(locks, owner, { label: 'purchase.edit.lock.release' });
  }
}
