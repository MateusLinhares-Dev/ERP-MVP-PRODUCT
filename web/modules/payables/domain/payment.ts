import { isISODate } from '../../../shared/domain/dates.js';
import { parseDecimal } from '../../../shared/domain/decimal.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import type { PayableRow } from './payables.js';

export interface AdvanceRecord {
  cod?: unknown;
  valor?: unknown;
  status?: unknown;
  ticket?: unknown;
}

export interface PaymentContext {
  fornCod: string;
  ticket: string;
  advances: AdvanceRecord[];
}

const text = (value: unknown): string => (value == null ? '' : String(value).trim());

export function advanceOptions(context: PaymentContext, amount: number) {
  const pending = context.advances.filter((advance) => advance && text(advance.status) === 'Pendente');
  const usable = pending.filter(
    (advance) => !text(advance.ticket) || text(advance.ticket) === context.ticket,
  );
  const available = fromCents(usable.reduce((sum, advance) => sum + Math.max(0, toCents(advance.valor)), 0));
  return {
    available,
    limit: Math.min(available, amount),
    blocked: pending.length - usable.length,
  };
}

export interface PaymentForm {
  total: string;
  advance: string;
  date: string;
  bank: string;
  notes: string;
}

export type PaymentMode = 'pay' | 'advance-only';

export const bankDebit = (form: Pick<PaymentForm, 'total' | 'advance'>): number =>
  fromCents(Math.max(0, toCents(parseDecimal(form.total) ?? 0) - toCents(parseDecimal(form.advance) ?? 0)));

export type PaymentPlan =
  | { ok: true; payload: Record<string, unknown>; cash: number; advance: number }
  | { ok: false; message: string };

const round = (value: number): number => fromCents(Math.round(value * 100));

export function paymentRequest(
  form: PaymentForm,
  row: Pick<PayableRow, 'id' | 'amount' | 'status' | 'payments'>,
  mode: PaymentMode,
  options: { fornCod: string; advanceLimit: number; operationId: string },
): PaymentPlan {
  const total = parseDecimal(form.total);
  const advance = form.advance.trim() ? parseDecimal(form.advance) : 0;
  const onlyAdvance = mode === 'advance-only';
  if (total == null || advance == null)
    return { ok: false, message: 'Confira o valor e a compensação informados.' };
  const advanceAmount = round(advance);
  const amount = onlyAdvance ? 0 : round(total - advance);
  if (
    advance < 0 ||
    advance > options.advanceLimit + 0.001 ||
    amount < 0 ||
    advanceAmount > total + 0.001 ||
    (onlyAdvance ? advance <= 0 : total <= 0) ||
    total > row.amount + 0.001
  )
    return { ok: false, message: 'Confira o valor e a compensação informados.' };
  if (!isISODate(form.date)) return { ok: false, message: 'Informe uma data válida.' };
  const bankCode = amount > 0 ? form.bank : '';
  if (amount > 0 && !bankCode) return { ok: false, message: 'Selecione a conta bancária autorizada.' };
  return {
    ok: true,
    cash: amount,
    advance: advanceAmount,
    payload: {
      operationId: options.operationId,
      payableId: row.id,
      expected: { valor: row.amount, status: row.status, paymentsCount: row.payments },
      date: form.date,
      bankCode,
      amount,
      advanceAmount,
      fornCod: options.fornCod,
      obs: form.notes.trim(),
    },
  };
}

export function reversalRequest(row: PayableRow, index: number, operationId: string) {
  const payment = row.paymentList[index];
  if (!payment) return null;
  return {
    action: 'reverse',
    operationId,
    payableId: row.id,
    paymentIndex: index,
    payment: { data: payment.date, valor: payment.amount, movBancoId: payment.movementId },
    expected: { valor: row.amount, status: row.status, paymentsCount: row.paymentList.length },
  };
}
