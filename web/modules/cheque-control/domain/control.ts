import { parseDecimal } from '../../../shared/domain/decimal.js';
import { foldAccents } from '../../../shared/domain/text.js';

export type Raw = Record<string, unknown>;
export type Situation = 'A' | 'C' | 'X' | 'N';
export type SituationFilter = Situation | 'TODOS';

export interface ControlCheque {
  id: string;
  bank: string;
  number: string;
  holder: string;
  value: number;
  issued: string;
  due: string;
  cleared: string;
  situation: Situation;
  discountsPurchase: boolean;
  advanceCode: string;
  supplierCode: string;
  chequeType: string;
  bankMovementId: string;
  destination: string;
  destinationCode: string;
  destinationType: string;
}

export interface ChequeBank {
  name: string;
  slug: string;
  code: string;
  color: string;
  order: number;
}

export interface Destination {
  name: string;
  code: string;
  type: string;
}

export const SITUATION_LABEL: Record<Situation, string> = {
  A: 'A Compensar',
  C: 'Compensado',
  X: 'Cancelado',
  N: 'Não existe',
};

export const SITUATION_FILTERS: readonly { value: SituationFilter; label: string }[] = [
  { value: 'A', label: 'A Compensar' },
  { value: 'C', label: 'Compensados' },
  { value: 'X', label: 'Cancelados' },
  { value: 'N', label: 'Não existe' },
  { value: 'TODOS', label: 'Todos' },
];

const isRaw = (value: unknown): value is Raw =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => String(value ?? '').trim();
const situationOf = (value: unknown): Situation => {
  const status = text(value);
  return status === 'C' || status === 'X' || status === 'N' ? status : 'A';
};

export function normalizeCheques(raw: unknown, deleted: unknown): ControlCheque[] {
  const gone = isRaw(deleted) ? deleted : {};
  const source = isRaw(raw) ? raw : {};
  return Object.entries(source)
    .filter(([id, row]) => isRaw(row) && !gone[id])
    .map(([key, value]) => {
      const row = value as Raw;
      return {
        id: text(row.id) || key,
        bank: text(row.b),
        number: text(row.n),
        holder: text(row.c),
        value: Number.isFinite(Number(row.v)) ? Number(row.v) : 0,
        issued: text(row.d),
        due: text(row.venc),
        cleared: text(row.cd),
        situation: situationOf(row.s),
        discountsPurchase: row.dc === true,
        advanceCode: text(row.advanceCode),
        supplierCode: text(row.fornCod),
        chequeType: text(row.tipoCheque),
        bankMovementId: text(row.movBancoId),
        destination: text(row.dest),
        destinationCode: text(row.fornecedorCod) || text(row.clienteCod),
        destinationType: text(row.fornecedorCod) ? 'Fornecedor' : text(row.clienteCod) ? 'Cliente' : '',
      };
    });
}

export const searchKey = (value: unknown): string =>
  foldAccents(String(value ?? ''))
    .toLowerCase()
    .trim();

export interface Totals {
  A: { count: number; value: number };
  C: { count: number; value: number };
  X: { count: number; value: number };
  N: { count: number; value: number };
  all: number;
}

export function totalsOf(cheques: readonly ControlCheque[]): Totals {
  const totals: Totals = {
    A: { count: 0, value: 0 },
    C: { count: 0, value: 0 },
    X: { count: 0, value: 0 },
    N: { count: 0, value: 0 },
    all: cheques.length,
  };
  for (const cheque of cheques) {
    const bucket = totals[cheque.situation];
    bucket.count += 1;
    bucket.value = Math.round((bucket.value + cheque.value) * 100) / 100;
  }
  return totals;
}

export interface BankSummary {
  bank: string;
  color: string;
  pendingCount: number;
  pendingValue: number;
  clearedCount: number;
  clearedValue: number;
}

export function bankSummaries(
  cheques: readonly ControlCheque[],
  banks: readonly ChequeBank[],
): BankSummary[] {
  return banks
    .map((bank) => {
      const own = cheques.filter((cheque) => cheque.bank === bank.name);
      const sum = (situation: Situation) =>
        Math.round(
          own
            .filter((cheque) => cheque.situation === situation)
            .reduce((total, cheque) => total + cheque.value, 0) * 100,
        ) / 100;
      return {
        bank: bank.name,
        color: bank.color,
        pendingCount: own.filter((cheque) => cheque.situation === 'A').length,
        pendingValue: sum('A'),
        clearedCount: own.filter((cheque) => cheque.situation === 'C').length,
        clearedValue: sum('C'),
      };
    })
    .filter((summary) => summary.pendingCount > 0 || summary.clearedCount > 0);
}

export interface Filters {
  situation: SituationFilter;
  bank: string;
  search: string;
}

const numberOf = (value: string): number => {
  const digits = Number.parseInt(value.replace(/\D/g, ''), 10);
  return Number.isFinite(digits) ? digits : 0;
};

export function visibleCheques(
  cheques: readonly ControlCheque[],
  filters: Filters,
  banks: readonly ChequeBank[],
): ControlCheque[] {
  const wanted = searchKey(filters.search);
  const order = new Map(banks.map((bank) => [bank.name, bank.order]));
  return cheques
    .filter((cheque) => filters.situation === 'TODOS' || cheque.situation === filters.situation)
    .filter((cheque) => filters.bank === 'TODOS' || cheque.bank === filters.bank)
    .filter(
      (cheque) =>
        !wanted ||
        searchKey([cheque.number, cheque.holder, cheque.destination, cheque.bank].join(' ')).includes(wanted),
    )
    .sort((a, b) => {
      const byOrder = (order.get(a.bank) ?? 8) - (order.get(b.bank) ?? 8);
      if (byOrder) return byOrder;
      if (a.bank !== b.bank) return a.bank.localeCompare(b.bank, 'pt-BR');
      return numberOf(a.number) - numberOf(b.number);
    });
}

export const sumOf = (cheques: readonly ControlCheque[]): number =>
  Math.round(cheques.reduce((total, cheque) => total + cheque.value, 0) * 100) / 100;

export function autoDebit(
  cheque: Pick<ControlCheque, 'advanceCode' | 'chequeType' | 'supplierCode'>,
  advanceHasMovement: (supplierCode: string, advanceCode: string) => boolean,
): boolean | null {
  if (!cheque.advanceCode) return null;
  if (cheque.chequeType === 'Cheque de Terceiro') return false;
  if (advanceHasMovement(cheque.supplierCode, cheque.advanceCode)) return false;
  return true;
}

export interface ClearingLine {
  id: string;
  bankCode: string;
  debit: boolean;
}

export function depositLines(
  selected: readonly ControlCheque[],
  bankCode: (bank: string) => string,
  advanceHasMovement: (supplierCode: string, advanceCode: string) => boolean,
): ClearingLine[] {
  return selected
    .filter((cheque) => cheque.situation === 'A')
    .map((cheque) => {
      const auto = autoDebit(cheque, advanceHasMovement);
      return { id: cheque.id, bankCode: bankCode(cheque.bank), debit: auto ?? !cheque.discountsPurchase };
    });
}

export function pendingForDeposit(cheques: readonly ControlCheque[], bank: string): ControlCheque[] {
  return cheques
    .filter((cheque) => cheque.situation === 'A' && (bank === 'TODOS' || cheque.bank === bank))
    .sort((a, b) => a.bank.localeCompare(b.bank, 'pt-BR') || numberOf(a.number) - numberOf(b.number));
}

export const parseAmount = (value: string): number => {
  const parsed = parseDecimal(value);
  return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

export function destinationsOf(
  clients: readonly Raw[],
  suppliers: readonly Raw[],
  expenseSuppliers: readonly Raw[],
  deletedSuppliers: ReadonlySet<string>,
): Destination[] {
  const groups: [readonly Raw[], string][] = [
    [clients, 'Cliente'],
    [suppliers, 'Fornecedor'],
    [expenseSuppliers, 'Fornecedor de despesa'],
  ];
  const seen = new Set<string>();
  const result: Destination[] = [];
  for (const [list, type] of groups) {
    for (const item of list) {
      if (!isRaw(item) || item.inativo || item.ativo === false || item._deleted) continue;
      const code = text(item.cod ?? item.codigo ?? item.id);
      if (type === 'Fornecedor' && deletedSuppliers.has(code)) continue;
      const name = text(item.nome ?? item.razaoSocial ?? item.razao);
      if (!name) continue;
      const key = type + '|' + (code || foldAccents(name).toUpperCase());
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name, code, type });
    }
  }
  const rank: Record<string, number> = { Fornecedor: 0, 'Fornecedor de despesa': 1, Cliente: 2 };
  return result.sort(
    (a, b) => (rank[a.type] ?? 3) - (rank[b.type] ?? 3) || a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export function matchDestinations(
  destinations: readonly Destination[],
  query: string,
  chosen: boolean,
): Destination[] {
  const wanted = searchKey(query);
  if (!wanted || chosen) return destinations.slice(0, 200);
  return destinations
    .filter(
      (item) =>
        searchKey(item.name).includes(wanted) ||
        searchKey(item.code).includes(wanted) ||
        searchKey(item.type).includes(wanted),
    )
    .slice(0, 200);
}

export function pickDestination(
  destinations: readonly Destination[],
  chosen: { code: string; type: string },
  name: string,
): Destination | null {
  const key = (value: string) => foldAccents(value.trim()).toUpperCase();
  const exact = destinations.find(
    (item) => item.code === chosen.code && item.type === chosen.type && key(item.name) === key(name),
  );
  if (exact) return exact;
  const same = destinations.filter((item) => key(item.name) === key(name));
  return same.length === 1 ? (same[0] ?? null) : null;
}

export const LARGE_JUMP = 250;
const REVIEW_MAX_ROWS = 48;
const REVIEW_EXPAND_SMALL = 8;

export interface Gap {
  start: number;
  end: number;
  count: number;
  large: boolean;
}

export interface BankSequence {
  bank: string;
  numbers: number[];
  gaps: Gap[];
}

export function sequences(cheques: readonly ControlCheque[]): BankSequence[] {
  const groups = new Map<string, Set<number>>();
  for (const cheque of cheques) {
    const value = Number.parseInt(cheque.number.replace(/\D/g, ''), 10);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    const bank = cheque.bank || 'Sem banco';
    const set = groups.get(bank) ?? new Set<number>();
    set.add(value);
    groups.set(bank, set);
  }
  return [...groups].map(([bank, set]) => {
    const numbers = [...set].sort((a, b) => a - b);
    const gaps: Gap[] = [];
    for (let index = 1; index < numbers.length; index++) {
      const previous = numbers[index - 1] ?? 0;
      const current = numbers[index] ?? 0;
      const count = current - previous - 1;
      if (count > 0) gaps.push({ start: previous + 1, end: current - 1, count, large: count > LARGE_JUMP });
    }
    return { bank, numbers, gaps };
  });
}

export interface ReviewRow {
  bank: string;
  gap: Gap;
  number: number | null;
  type: 'missing' | 'range' | 'jump';
}

export interface Review {
  rows: ReviewRow[];
  total: number;
  jumps: number;
  limited: boolean;
}

export function reviewOf(groups: readonly BankSequence[]): Review {
  const rows: ReviewRow[] = [];
  let total = 0;
  let jumps = 0;
  let limited = false;
  const push = (row: ReviewRow) => {
    if (rows.length < REVIEW_MAX_ROWS) rows.push(row);
    else limited = true;
  };
  for (const group of groups) {
    for (const gap of group.gaps) {
      total += 1;
      if (gap.large) {
        jumps += 1;
        push({ bank: group.bank, gap, number: null, type: 'jump' });
        continue;
      }
      if (gap.count <= REVIEW_EXPAND_SMALL) {
        for (let value = gap.start; value <= gap.end; value++) {
          if (rows.length >= REVIEW_MAX_ROWS) {
            limited = true;
            break;
          }
          rows.push({ bank: group.bank, gap, number: value, type: 'missing' });
        }
      } else push({ bank: group.bank, gap, number: gap.start, type: 'range' });
    }
  }
  return { rows, total, jumps, limited };
}

const fmt = (value: number): string => value.toLocaleString('pt-BR');

export function gapLabel(gap: Gap): string {
  return gap.start === gap.end ? fmt(gap.start) : `${fmt(gap.start)}–${fmt(gap.end)} (${fmt(gap.count)})`;
}

export function reviewText(row: ReviewRow): string {
  if (row.type === 'jump')
    return `Salto ${fmt(row.gap.start - 1)} → ${fmt(row.gap.end + 1)} · confirme se é outro talão/série`;
  if (row.type === 'range')
    return `Faltam ${fmt(row.gap.count)} números: ${fmt(row.gap.start)}–${fmt(row.gap.end)}. Cadastre individualmente após conferência.`;
  return `Cheque nº ${fmt(row.number ?? 0)} não identificado na sequência`;
}

export interface NumberCheck {
  tone: '' | 'ok' | 'warn' | 'bad';
  message: string;
  duplicate: boolean;
  confirm: string;
}

export function checkNumber(
  cheques: readonly ControlCheque[],
  bank: string,
  numberText: string,
  editingId: string,
): NumberCheck {
  const value = Number.parseInt(numberText.replace(/\D/g, ''), 10);
  const existing = cheques
    .filter((cheque) => cheque.id !== editingId && cheque.bank === bank)
    .map((cheque) => Number.parseInt(cheque.number.replace(/\D/g, ''), 10))
    .filter(Number.isFinite);
  const max = existing.length ? Math.max(...existing) : null;
  if (Number.isFinite(value) && existing.includes(value))
    return { tone: 'bad', message: 'Este número já existe neste banco.', duplicate: true, confirm: '' };
  if (Number.isFinite(value) && max != null && value > max + 1) {
    const gap = value - max - 1;
    const large = gap > LARGE_JUMP;
    return {
      tone: 'warn',
      message: large
        ? `Salto de ${fmt(max)} para ${fmt(value)}. Você está pulando uma faixa muito grande: confira se é um novo talão/série.`
        : `Você está pulando: ${gapLabel({ start: max + 1, end: value - 1, count: gap, large: false })}`,
      duplicate: false,
      confirm:
        editingId === ''
          ? large
            ? `Salto de numeração entre ${fmt(max)} e ${fmt(value)}. Pode ser uma nova série ou talão; confirme antes de salvar.`
            : `Números faltantes: ${gapLabel({ start: max + 1, end: value - 1, count: gap, large: false })}.`
          : '',
    };
  }
  if (Number.isFinite(value) && max != null && value === max + 1)
    return { tone: 'ok', message: 'Próximo número da sequência.', duplicate: false, confirm: '' };
  return {
    tone: '',
    message: max != null ? 'Último número cadastrado neste banco: ' + fmt(max) : '',
    duplicate: false,
    confirm: '',
  };
}

export function csvOf(cheques: readonly ControlCheque[]): string {
  const rows = [...cheques].sort((a, b) =>
    a.bank !== b.bank ? a.bank.localeCompare(b.bank) : numberOf(a.number) - numberOf(b.number),
  );
  const lines = ['Nº;Banco;Cliente;Valor;Data Saída;Caiu em;Situação'];
  for (const cheque of rows) {
    lines.push(
      [
        cheque.number,
        cheque.bank,
        cheque.holder.replace(/;/g, ','),
        cheque.value.toFixed(2).replace('.', ','),
        cheque.issued,
        cheque.cleared,
        SITUATION_LABEL[cheque.situation],
      ].join(';'),
    );
  }
  return '﻿' + lines.join('\n');
}
