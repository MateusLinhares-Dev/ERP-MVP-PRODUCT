import { toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { parseDecimal } from '../../../shared/domain/decimal.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export interface Problem {
  code: string;
  message: string;
}

export interface PayableFields {
  desc?: string;
  cred?: string;
  cat?: string;
  empresa?: string;
  tipoForn?: 'compra' | 'despesa';
  bancoCod?: string;
  obs?: string;
  formaPrevista?: string;
  venc?: string;
  valor?: number;
}

export interface Installments {
  count: number;
  day: number;
  firstMonth: string;
}

export const PAID = 'Pago';
export const MAX_INSTALLMENTS = 600;
export const MAX_BATCH = 200;

const text = (value: unknown, max: number): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function money(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : parseDecimal(value);
  if (parsed == null || !Number.isFinite(parsed)) return null;
  return fromCents(toCents(parsed));
}

export const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const paymentsOf = (row: Row): Row[] =>
  Array.isArray(row.pagamentos) ? row.pagamentos.filter(isRow) : [];

export function cleanPayableFields(
  input: unknown,
  requireAll: boolean,
): { fields: PayableFields; problem?: Problem } {
  const source = isRow(input) ? input : {};
  const fields: PayableFields = {};
  const fail = (code: string, message: string) => ({ fields, problem: { code, message } });
  for (const [field, max] of [
    ['desc', 240],
    ['cred', 160],
    ['cat', 80],
    ['empresa', 80],
    ['bancoCod', 130],
    ['obs', 500],
    ['formaPrevista', 40],
  ] as const) {
    if (!(field in source)) continue;
    const value = text(source[field], max + 1);
    if (value.length > max) return fail('FIELD_TOO_LONG', `O campo ${field} passou do tamanho permitido.`);
    if (hasControlChars(value.replace(/[\r\n\t]/g, ' ')))
      return fail('INVALID_TEXT', `O campo ${field} tem caracteres inválidos.`);
    fields[field] = value.replace(/\s+/g, ' ');
  }
  if ('cat' in fields && !fields.cat) fields.cat = 'Outros';
  if ('tipoForn' in source) {
    const kind = text(source.tipoForn, 10);
    if (kind !== 'compra' && kind !== 'despesa') return fail('INVALID_KIND', 'Tipo de fornecedor inválido.');
    fields.tipoForn = kind;
  }
  if ('valor' in source) {
    const value = money(source.valor);
    if (value == null || value <= 0 || value > 1e10)
      return fail('INVALID_AMOUNT', 'Informe um valor maior que zero.');
    fields.valor = value;
  }
  if ('venc' in source) {
    const due = toISODate(source.venc);
    if (!due) return fail('INVALID_DATE', 'Informe o vencimento.');
    fields.venc = toBRDate(due);
  }
  if ('desc' in fields && !fields.desc) return fail('DESCRIPTION_REQUIRED', 'Informe a descrição.');
  if ('empresa' in fields && !fields.empresa)
    return fail('COMPANY_REQUIRED', 'Selecione a empresa responsável por esta conta.');
  if (requireAll) {
    if (!fields.desc) return fail('DESCRIPTION_REQUIRED', 'Informe a descrição.');
    if (fields.valor == null) return fail('INVALID_AMOUNT', 'Informe um valor maior que zero.');
    if (!fields.empresa) return fail('COMPANY_REQUIRED', 'Selecione a empresa responsável por esta conta.');
  }
  return { fields };
}

export function cleanInstallments(input: unknown): { plan: Installments | null; problem?: Problem } {
  if (input == null) return { plan: null };
  const source = isRow(input) ? input : {};
  const count = Number(source.count);
  const day = Number(source.day);
  const firstMonth = text(source.firstMonth, 7);
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS)
    return {
      plan: null,
      problem: { code: 'INVALID_INSTALLMENTS', message: `Informe de 1 a ${MAX_INSTALLMENTS} parcelas.` },
    };
  if (!Number.isInteger(day) || day < 1 || day > 31)
    return { plan: null, problem: { code: 'INVALID_INSTALLMENTS', message: 'Dia de vencimento inválido.' } };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth))
    return {
      plan: null,
      problem: { code: 'INVALID_INSTALLMENTS', message: 'Informe o mês da 1ª parcela.' },
    };
  return { plan: { count, day, firstMonth } };
}

export function installmentDueDates(plan: Installments): string[] {
  const [year, month] = plan.firstMonth.split('-').map(Number) as [number, number];
  return Array.from({ length: plan.count }, (_, index) => {
    const absolute = year * 12 + (month - 1) + index;
    const y = Math.floor(absolute / 12);
    const m = (absolute % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${String(Math.min(plan.day, last)).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  });
}

export function editProblem(row: Row, fields: PayableFields): Problem | null {
  const paid = text(row.status, 20) === PAID;
  if (paid && fields.valor != null && fields.valor !== Number(row.valor))
    return {
      code: 'PAYABLE_PAID',
      message: 'Esta conta já foi paga. Para mudar o valor, exclua o pagamento no histórico (🕒) antes.',
    };
  return null;
}

export function deleteProblem(row: Row): Problem | null {
  if (paymentsOf(row).length)
    return {
      code: 'PAYABLE_HAS_PAYMENTS',
      message: `A conta "${text(row.desc || row.cred, 80)}" tem pagamentos. Exclua os pagamentos no histórico (🕒) antes.`,
    };
  return null;
}
