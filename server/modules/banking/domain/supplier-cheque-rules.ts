import { toBRDate } from '../../../shared/domain/dates.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { chequeIdentity, normalizeChequeBank } from '../../advances/domain/advance-rules.js';
import { isRow, type Problem, type Row } from './bank-ledger-rules.js';

export const MAX_CREATE = 100;
export const MAX_DISCOUNT = 200;
export const APPLIED = 'Quitado';
export const CANCELLED = 'Cancelado';
export const CLEARED = 'Compensado';
export const EDIT_STATUSES: readonly string[] = ['Pendente', CLEARED, 'Vencido'];
export const DISCOUNT_VALUES: readonly string[] = ['Descontado', 'A descontar'];
export const DEFAULT_TYPE = 'Emitido (A Pagar)';
export const DEFAULT_PURPOSE = 'Adiantamento';

const TEXT_FIELDS: Record<string, [number, string]> = {
  num: [30, 'O número do cheque'],
  banco: [80, 'O banco'],
  tipo: [40, 'O tipo'],
  finalidade: [40, 'A finalidade'],
  empresa: [160, 'A empresa'],
  vinculo: [120, 'O vínculo'],
  obs: [500, 'A observação'],
};
const DATE_FIELDS: Record<string, string> = {
  bomPara: 'O bom para',
  data: 'A data',
  dataCompensacao: 'A data de compensação',
};
export const EDIT_FIELDS: readonly string[] = [
  'num',
  'valor',
  'bomPara',
  'data',
  'banco',
  'tipo',
  'finalidade',
  'empresa',
  'vinculo',
  'obs',
  'status',
];
const PURCHASE_LOCKED: readonly string[] = ['num', 'valor', 'banco', 'status', 'vinculo'];

const problem = (code: string, message: string): Problem => ({ code, message });

export const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const listOf = (value: unknown): Row[] =>
  (Array.isArray(value) ? value : isRow(value) ? Object.values(value) : []).filter(isRow);

function money(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(cents - amount * 100) > 0.000001 || cents <= 0 || cents > 100_000_000_000) return null;
  return fromCents(cents);
}

export function cleanPatch(
  input: unknown,
  allowed: readonly string[],
): { fields: Row; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const fields: Row = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const raw = source[key];
    if (key === 'valor') {
      const valor = money(raw);
      if (valor === null)
        return {
          fields: {},
          problem: problem('INVALID_AMOUNT', 'Informe o valor do cheque, com no máximo duas casas decimais.'),
        };
      fields.valor = valor;
      continue;
    }
    if (key === 'status') {
      fields.status = text(raw, 40);
      continue;
    }
    const dateLabel = DATE_FIELDS[key];
    if (dateLabel) {
      const value = String(raw ?? '').trim();
      const date = value ? toBRDate(value) : '';
      if (value && !date)
        return {
          fields: {},
          problem: problem('INVALID_DATE', `${dateLabel} está inválido. Use dd/mm/aaaa.`),
        };
      fields[key] = date;
      continue;
    }
    const spec = TEXT_FIELDS[key];
    if (!spec) continue;
    const value = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (value.length > spec[0])
      return { fields: {}, problem: problem('FIELD_TOO_LONG', `${spec[1]} passou do tamanho permitido.`) };
    if (hasControlChars(value))
      return { fields: {}, problem: problem('INVALID_TEXT', `${spec[1]} tem caracteres inválidos.`) };
    fields[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'num') && !fields.num)
    return { fields: {}, problem: problem('CHEQUE_NUMBER_REQUIRED', 'Informe o número do cheque.') };
  return { fields, problem: null };
}

export const chequeRef = (cheque: Row, code: string): string =>
  text(cheque.id, 100) || 'CHQ_' + text(cheque.num, 30) + '_' + code;

export function locate(list: readonly Row[], ref: string, code: string): number {
  const matches = list.map((row, at) => (chequeRef(row, code) === ref ? at : -1)).filter((at) => at >= 0);
  return matches.length === 1 ? (matches[0] ?? -1) : matches.length > 1 ? -2 : -1;
}

export const appliedTicket = (cheque: Row): string =>
  text(cheque._aplicadoTicket, 60) ||
  (text(cheque.status) === APPLIED || text(cheque.statusAnterior) === APPLIED
    ? text(cheque.vinculo, 60)
    : '');

export const isApplied = (cheque: Row): boolean =>
  Boolean(text(cheque._aplicadoTicket)) ||
  text(cheque.status) === APPLIED ||
  text(cheque.statusAnterior) === APPLIED;

export const isCancelled = (cheque: Row): boolean => text(cheque.status) === CANCELLED;

export const isCleared = (cheque: Row): boolean =>
  text(cheque.status) === CLEARED || Boolean(text(cheque.dataCompensacao));

export function purchaseChanges(current: Row, patch: Row): string[] {
  return PURCHASE_LOCKED.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return false;
    if (key === 'valor') return toCents(current.valor) !== toCents(patch.valor);
    if (key === 'banco') return normalizeChequeBank(current.banco) !== normalizeChequeBank(patch.banco);
    return text(current[key]) !== text(patch[key]);
  });
}

export const identityOf = (cheque: Row): string | null => chequeIdentity(cheque.banco, cheque.num);

export function sameChequeElsewhere(
  groups: ReadonlyMap<string, Row[]>,
  cheque: Row,
  skip: Row | null,
): { code: string; cheque: Row } | null {
  const wanted = identityOf(cheque);
  if (!wanted) return null;
  for (const [code, list] of groups) {
    for (const row of list) {
      if (row === skip || isCancelled(row)) continue;
      if (identityOf(row) === wanted) return { code, cheque: row };
    }
  }
  return null;
}

export function nextChequeId(taken: ReadonlySet<string>, now: number, random: () => number): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id =
      'CHQ' +
      now.toString(36).toUpperCase() +
      Math.floor(random() * 46656)
        .toString(36)
        .toUpperCase();
    if (!taken.has(id)) return id;
  }
  return 'CHQ' + now.toString(36).toUpperCase() + String(taken.size);
}

export const tombstoneList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '')).filter(Boolean)
    : isRow(value)
      ? Object.keys(value)
      : [];
