import { toBRDate } from '../../../shared/domain/dates.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';

export type Row = Record<string, unknown>;

export interface SupplierBalance {
  valor: number;
  ticket: string;
  data: string;
  raw: Row;
}

const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function readBalance(...sources: unknown[]): SupplierBalance | null {
  for (const raw of sources) {
    if (raw == null || raw === '') continue;
    const record: Row = isRow(raw) ? raw : { valor: Number(raw) };
    const cents = toCents(record.valor);
    if (cents <= 0) continue;
    return {
      valor: fromCents(cents),
      ticket: text(record.ticket, 60),
      data: toBRDate(record.data) || text(record.data, 10),
      raw: record,
    };
  }
  return null;
}

export const isPurchaseCredit = (balance: SupplierBalance): boolean => Boolean(balance.ticket);

export function sameBalance(balance: SupplierBalance, expected: unknown): boolean {
  if (!isRow(expected)) return true;
  if (expected.valor != null && toCents(expected.valor) !== toCents(balance.valor)) return false;
  if (expected.ticket != null && text(expected.ticket, 60) !== balance.ticket) return false;
  return true;
}
