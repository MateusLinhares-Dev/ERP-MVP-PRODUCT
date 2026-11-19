import { toBRDate } from '../../../shared/domain/dates.js';
import { foldAccents } from '../../../shared/domain/fold.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export interface Problem {
  code: string;
  message: string;
}

export const CHEQUE_CYCLE = ['Pendente', 'Compensado', 'Devolvido', 'Pago (após devolução)'] as const;
export const SALE_USED = 'Quitado';
export const MAX_CHEQUES = 100;
const CHEQUE_TYPES = ['Adiantamento', 'Pagamento'];
const RETURNED = new Set(['Devolvido', 'Pago (após devolução)']);

const problem = (code: string, message: string): Problem => ({ code, message });

export const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const listOf = (value: unknown): Row[] =>
  (Array.isArray(value) ? value : isRow(value) ? Object.values(value) : []).filter(isRow);

export const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function textField(value: unknown, max: number, label: string): { value: string; problem: Problem | null } {
  const raw = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length > max)
    return { value: '', problem: problem('FIELD_TOO_LONG', `${label} passou do tamanho permitido.`) };
  if (hasControlChars(raw))
    return { value: '', problem: problem('INVALID_TEXT', `${label} tem caracteres inválidos.`) };
  return { value: raw, problem: null };
}

function money(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(cents - amount * 100) > 0.000001 || cents <= 0 || cents > 100_000_000_000) return null;
  return fromCents(cents);
}

function date(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return toBRDate(raw) || null;
}

export function cleanAdvance(input: unknown): { fields: Row; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const valor = money(source.valor);
  if (valor === null)
    return {
      fields: {},
      problem: problem('INVALID_AMOUNT', 'Informe um valor válido, com no máximo duas casas decimais.'),
    };
  const data = date(source.data);
  if (!data) return { fields: {}, problem: problem('INVALID_DATE', 'Informe a data do adiantamento.') };
  const fields: Row = { valor, data };
  for (const [field, max, label] of [
    ['forma', 30, 'A forma'],
    ['vinculo', 120, 'O vínculo'],
    ['obs', 500, 'A observação'],
  ] as const) {
    const cleaned = textField(source[field], max, label);
    if (cleaned.problem) return { fields: {}, problem: cleaned.problem };
    fields[field] = cleaned.value;
  }
  fields.forma = fields.forma || 'PIX';
  return { fields, problem: null };
}

export function cleanCheque(input: unknown, creating: boolean): { fields: Row; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const num = textField(source.num, 30, 'O número do cheque');
  if (num.problem) return { fields: {}, problem: num.problem };
  if (!num.value)
    return { fields: {}, problem: problem('CHEQUE_NUMBER_REQUIRED', 'Informe o número do cheque.') };
  const valor = money(source.valor);
  if (valor === null)
    return {
      fields: {},
      problem: problem('INVALID_AMOUNT', 'Informe o valor do cheque, com no máximo duas casas decimais.'),
    };
  const data = date(source.data);
  const bomPara = date(source.bomPara);
  if (data === null || bomPara === null)
    return { fields: {}, problem: problem('INVALID_DATE', 'Data inválida. Use dd/mm/aaaa.') };
  const fields: Row = { num: num.value, valor, data, bomPara };
  for (const [field, max, label] of [
    ['banco', 80, 'O banco'],
    ['emitente', 160, 'O emitente'],
    ['vinculo', 120, 'O vínculo'],
    ['obs', 500, 'A observação'],
    ['motivoDevolucao', 200, 'O motivo da devolução'],
  ] as const) {
    const cleaned = textField(source[field], max, label);
    if (cleaned.problem) return { fields: {}, problem: cleaned.problem };
    fields[field] = cleaned.value;
  }
  fields.tipo = CHEQUE_TYPES.includes(String(source.tipo)) ? String(source.tipo) : 'Adiantamento';
  const status = String(source.status ?? 'Pendente');
  const allowed: readonly string[] = creating ? ['Pendente', 'Compensado'] : CHEQUE_CYCLE;
  if (!allowed.includes(status))
    return { fields: {}, problem: problem('INVALID_STATUS', 'Situação do cheque inválida.') };
  fields.status = status;
  if (!RETURNED.has(status)) fields.motivoDevolucao = '';
  return { fields, problem: null };
}

const bankKey = (value: unknown): string => foldAccents(text(value)).replace(/\s+/g, ' ');

export const sameCheque = (row: Row, num: unknown, banco: unknown): boolean =>
  text(row.num) === text(num) && bankKey(row.banco) === bankKey(banco);

export function locateCheque(list: readonly Row[], num: unknown, banco: unknown, position: unknown): number {
  const index = Number(position);
  const hinted = Number.isInteger(index) ? list[index] : undefined;
  if (hinted && sameCheque(hinted, num, banco)) return index;
  const matches = list.map((row, at) => (sameCheque(row, num, banco) ? at : -1)).filter((at) => at >= 0);
  return matches.length === 1 ? (matches[0] ?? -1) : matches.length > 1 ? -2 : -1;
}

export const usedInSale = (cheque: Row): boolean => text(cheque.status) === SALE_USED;
export const fromReceipt = (cheque: Row): boolean =>
  Boolean(text(cheque.contaReceberId)) || text(cheque.tipo) === 'Recebimento';

export function nextChequeStatus(current: unknown): string {
  const index = (CHEQUE_CYCLE as readonly string[]).indexOf(text(current) || 'Pendente');
  return CHEQUE_CYCLE[(index + 1) % CHEQUE_CYCLE.length] ?? 'Pendente';
}

export function advanceUsed(advance: Row): boolean {
  const uses = Array.isArray(advance.usos)
    ? advance.usos
    : isRow(advance.usos)
      ? Object.values(advance.usos)
      : [];
  return uses.length > 0 || ['Quitado', 'Aplicado'].includes(text(advance.status));
}

export function nextAdvanceCode(taken: ReadonlySet<string>, now: number, random: () => number): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = 'ADTC' + String(now).slice(-8) + String(Math.floor(random() * 100)).padStart(2, '0');
    if (!taken.has(code)) return code;
  }
  return 'ADTC' + String(now) + String(Math.floor(random() * 1000)).padStart(3, '0');
}

export const centsOf = (value: unknown): number => toCents(value);

export const ENTRY_SIDES: Readonly<Record<string, 'debito' | 'credito'>> = {
  entrega: 'debito',
  deposito: 'credito',
  ch_devol: 'debito',
  reembolso: 'credito',
};

function measure(value: unknown, digits: number): number | null {
  if (value == null || value === '') return 0;
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return null;
  const scale = 10 ** digits;
  return Math.round(amount * scale) / scale;
}

export function cleanEntry(input: unknown): { fields: Row; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const tipo = text(source.tipo, 20);
  const side = ENTRY_SIDES[tipo];
  if (!side) return { fields: {}, problem: problem('INVALID_TYPE', 'Tipo de lançamento inválido.') };
  const valor = money(source.valor);
  if (valor === null)
    return {
      fields: {},
      problem: problem('INVALID_AMOUNT', 'Informe o valor do lançamento, com no máximo duas casas decimais.'),
    };
  const data = date(source.data);
  if (data === null)
    return { fields: {}, problem: problem('INVALID_DATE', 'Data inválida. Use dd/mm/aaaa.') };
  const peso = measure(source.peso, 3);
  const valorkg = measure(source.valorkg, 4);
  if (peso === null || valorkg === null)
    return { fields: {}, problem: problem('INVALID_WEIGHT', 'Peso ou valor por kg inválido.') };
  const fields: Row = {
    data,
    tipo,
    peso,
    valorkg,
    debito: side === 'debito' ? valor : 0,
    credito: side === 'credito' ? valor : 0,
  };
  for (const [field, max, label] of [
    ['material', 80, 'O material'],
    ['num', 40, 'O número do cheque'],
    ['emitente', 160, 'O emitente'],
    ['destino', 160, 'O destino'],
    ['hist', 300, 'O histórico'],
  ] as const) {
    const cleaned = textField(source[field], max, label);
    if (cleaned.problem) return { fields: {}, problem: cleaned.problem };
    fields[field] = cleaned.value;
  }
  if (!fields.hist)
    return { fields: {}, problem: problem('HISTORY_REQUIRED', 'Informe o histórico do lançamento.') };
  return { fields, problem: null };
}

export function cleanOpeningBalance(input: unknown): { fields: Row | null; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const amount = typeof source.valor === 'number' ? source.valor : Number.NaN;
  if (!Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000)
    return { fields: null, problem: problem('INVALID_AMOUNT', 'Informe um valor válido.') };
  const cents = Math.round(amount * 100);
  if (Math.abs(cents - amount * 100) > 0.000001)
    return { fields: null, problem: problem('INVALID_AMOUNT', 'Use no máximo duas casas decimais.') };
  if (cents === 0) return { fields: null, problem: null };
  const data = date(source.data);
  if (data === null)
    return { fields: null, problem: problem('INVALID_DATE', 'Data inválida. Use dd/mm/aaaa.') };
  return { fields: { valor: fromCents(cents), data }, problem: null };
}

export const nextEntryId = (taken: ReadonlySet<string>, now: number, random: () => number): string => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = 'fcl' + String(now) + String(Math.floor(random() * 1000)).padStart(3, '0');
    if (!taken.has(id)) return id;
  }
  return 'fcl' + String(now) + String(taken.size);
};
