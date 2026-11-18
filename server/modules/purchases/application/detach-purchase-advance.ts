import { randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { acquireLease, releaseLeases, type LeaseEntry } from '../../../shared/firebase/rtdb-transaction.js';
import { refundAdvanceReceipt } from '../domain/advance-refund.js';
import { installmentPayableIds } from '../domain/installments.js';
import { adjustPayable, shiftOpenInstallment } from '../domain/purchase-edit.js';
import {
  cash,
  clone,
  reject,
  round,
  rowEntries,
  type FinancialReceipt,
  type PayableRow,
  type PurchaseTicket,
  type Row,
} from '../domain/purchase-records.js';

export interface DetachAdvanceDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

type HeldLock = LeaseEntry & { ref: Reference; path: string };

function key(value: unknown, label: string): string {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(text)) reject(422, 'INVALID_KEY', label + ' inválido.');
  return text;
}

const hasPaidAmount = (row: PayableRow): boolean =>
  Number(row.valorPago || 0) > 0 ||
  (Array.isArray(row.pagamentos) ? row.pagamentos : []).some(
    (payment) => Number((payment as Row | null)?.valor || 0) > 0,
  );

function stored(record: unknown, ticketNo: string, adtCod: string): Row | null {
  const value = record as { action?: unknown; ticketNo?: unknown; adtCod?: unknown } | null;
  if (!value) return null;
  if (value.action !== 'detach-advance' || value.ticketNo !== ticketNo || value.adtCod !== adtCod)
    reject(409, 'OPERATION_USED', 'Identificador de operação já utilizado.');
  return { ...(value as Row), alreadyCommitted: true };
}

export async function detachPurchaseAdvance(
  identity: Identity,
  input: unknown,
  { db: injected, now = () => Date.now(), uuid = randomUUID }: DetachAdvanceDeps = {},
) {
  if (
    identity.erpAccess !== true ||
    identity.canPurchasing !== true ||
    (identity.canAdvances !== true && identity.canFinance !== true)
  )
    reject(
      403,
      'PURCHASE_FORBIDDEN',
      'Seu perfil não pode tirar adiantamento de compra. É preciso acesso a Compras e a Adiantamentos (ou Financeiro).',
    );
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Row) : null;
  if (!body) reject(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const ticketNo = key(body.ticketNo, 'Pedido');
  const adtCod = key(body.adtCod, 'Adiantamento');
  const operationId = String(body.operationId ?? '');
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) reject(422, 'INVALID_OPERATION', 'Operação inválida.');
  const db = injected ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const opRef = db.ref('erp/purchaseEditOperations/' + actorKey(identity) + '_' + operationId);
  const earlier = stored((await opRef.get()).val(), ticketNo, adtCod);
  if (earlier) return earlier;
  const first = (await db.ref('erp/tickets/' + ticketNo).get()).val() as PurchaseTicket | null;
  if (!first) reject(404, 'TICKET_NOT_FOUND', 'Pedido não encontrado. Atualize o Histórico de compras.');
  const code = key(first.fornecedorCod || first.fornCod, 'Fornecedor');
  const count = Array.isArray(first.parcelas) ? first.parcelas.length : 1;
  const owner = uuid();
  const locks: HeldLock[] = [];
  let committed = false;
  try {
    const paths = [
      'erpFinancePayableTicketLocks/' + ticketNo,
      ...installmentPayableIds(ticketNo, Math.max(1, count)).map((id) => 'erpFinancePayableLocks/' + id),
      'erpFinanceAdvanceLocks/' + code,
    ];
    for (const path of paths) {
      const ref = db.ref(path);
      const acquired = await acquireLease(ref, owner, {
        now,
        ttlMs: 120000,
        meta: { kind: 'purchase-detach' },
      });
      if (!acquired)
        reject(
          409,
          'EDIT_IN_PROGRESS',
          'Outro lançamento financeiro está em andamento. Aguarde alguns segundos e tente novamente.',
        );
      locks.push({ ref, path });
    }
    const again = stored((await opRef.get()).val(), ticketNo, adtCod);
    if (again) return again;
    const [ticketSnap, advancesSnap, payablesSnap] = await Promise.all([
      db.ref('erp/tickets/' + ticketNo).get(),
      db.ref('erp/adiantamentos/' + code).get(),
      db.ref('erp/contasPagar').get(),
    ]);
    const previous = ticketSnap.val() as PurchaseTicket | null;
    if (!previous || String(previous.fornecedorCod || previous.fornCod || '') !== code)
      reject(409, 'TICKET_CHANGED', 'O pedido mudou no Firebase. Reabra o Histórico de compras.');
    const expected = body.expected && typeof body.expected === 'object' ? (body.expected as Row) : null;
    if (
      expected &&
      (['adiantamento', 'saldoPagar', 'totalGeral'] as const).some(
        (field) => cash(Number(expected[field] || 0)) !== cash(Number(previous[field] || 0)),
      )
    )
      reject(409, 'TICKET_CHANGED', 'O pedido mudou em outra tela. Atualize e tente de novo.');
    const receipt = (previous.reciboFinanceiro ?? {}) as FinancialReceipt;
    const row = (receipt.adiantamentos ?? []).find(
      (item) => String(item.cod || '') === adtCod && cash(Number(item.valorAplicado || 0)) > 0,
    );
    if (!row)
      reject(
        409,
        'ADVANCE_NOT_IN_PURCHASE',
        `O adiantamento ${adtCod} não está abatido no pedido ${ticketNo} (talvez já tenha sido tirado). Atualize a tela.`,
      );
    const applied = cash(Number(row.valorAplicado || 0));
    const oldBalance = cash(Number(previous.saldoPagar || 0));
    if (oldBalance < 0)
      reject(
        409,
        'FINANCE_RECONCILIATION_REQUIRED',
        'Este pedido tem crédito a favor do fornecedor. Tirar o adiantamento exige conciliação no financeiro.',
      );
    const refund = refundAdvanceReceipt(previous, advancesSnap.val(), applied, ticketNo, now(), adtCod);
    const nextBalance = oldBalance + applied;
    const next = clone(previous);
    next.reciboFinanceiro = refund.receipt;
    next.adiantamento = round(refund.applied);
    next.saldoPagar = round(nextBalance);
    const updates: Row = {};
    const plan = Array.isArray(previous.parcelas) ? previous.parcelas : [];
    const payablesRaw = payablesSnap.val();
    let payable: Row | null = null;
    if (oldBalance > 0 && plan.length > 1) {
      const shift = shiftOpenInstallment({
        raw: payablesRaw,
        ticketNo,
        previous,
        oldBalance,
        nextBalance,
        at: now(),
      });
      Object.assign(updates, shift.updates);
      next.parcelas = shift.plan;
      payable = (shift.updates['contasPagar/' + shift.path] as Row) ?? null;
    } else {
      const adjusted = adjustPayable(
        payablesRaw,
        ticketNo,
        oldBalance,
        nextBalance,
        operationId,
        code,
        previous,
      );
      updates['contasPagar/' + adjusted.path] = adjusted.updated;
      payable = adjusted.updated as Row;
      if (oldBalance > 0 && plan.length === 1 && plan[0] && typeof plan[0] === 'object') {
        const single = clone(plan[0] as Row);
        single.valor = round(nextBalance);
        next.parcelas = [single];
      }
    }
    const paid = rowEntries<PayableRow>(payablesRaw).some(
      ([, item]) => String(item.ticket || '') === ticketNo && hasPaidAmount(item),
    );
    next.status = paid ? 'Parcial' : 'Pendente';
    updates['tickets/' + ticketNo] = next;
    updates['adiantamentos/' + code] = refund.records;
    updates._ts = now();
    const record: Row = {
      action: 'detach-advance',
      ticketNo,
      adtCod,
      fornCod: code,
      valor: round(applied),
      ticket: next,
      advances: refund.records,
      payable,
      updatedAt: now(),
      actor: String(identity.erpUser || identity.uid || ''),
    };
    updates['purchaseEditOperations/' + actorKey(identity) + '_' + operationId] = record;
    const atomic: Row = Object.fromEntries(
      Object.entries(updates).map(([path, value]) => ['erp/' + path, value]),
    );
    for (const lock of locks) {
      const live = (await lock.ref.get()).val() as { owner?: string } | null;
      if (live?.owner !== owner)
        reject(409, 'PURCHASE_EDIT_BUSY', 'A operação foi alterada por outra sessão.');
      atomic[lock.path] = null;
    }
    await db.ref().update(atomic);
    committed = true;
    return { ...record, alreadyCommitted: false };
  } finally {
    if (!committed) await releaseLeases(locks, owner, { label: 'purchase.detach.lock.release' });
  }
}
