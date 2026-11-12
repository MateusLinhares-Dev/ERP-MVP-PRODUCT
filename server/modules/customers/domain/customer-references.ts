import { nameKey } from '../../../shared/domain/person.js';
import { FORBIDDEN_NAME_CHARS, type Row } from './customer-rules.js';

export const REFERENCE_PATHS = [
  'vendas',
  'contasReceber',
  'adtCli',
  'chequesCli',
  'fcLanc',
  'fcSaldoIni',
  'precosCli',
  'tickets',
] as const;

export type ReferencePath = (typeof REFERENCE_PATHS)[number];
export type ReferenceData = Partial<Record<ReferencePath, unknown>>;

export interface MoveResult {
  updates: Row;
  moved: Record<ReferencePath, number>;
  invalidKey: boolean;
}

const LIST_MAPS = ['adtCli', 'chequesCli', 'fcLanc'] as const;
const CLOSED_CHEQUE = new Set(['Compensado', 'Devolvido', 'Quitado']);

const records = (value: unknown): [string, Row][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, Row] => Boolean(entry[1]) && typeof entry[1] === 'object',
  );

const listOf = (value: unknown): Row[] =>
  (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []).filter(
    (item): item is Row => Boolean(item) && typeof item === 'object',
  );

const sameName = (value: unknown, source: string): boolean =>
  typeof value === 'string' && value.trim() !== '' && nameKey(value) === source;

export function moveReferences(data: ReferenceData, from: string, to: string): MoveResult {
  const source = nameKey(from);
  const moved = Object.fromEntries(REFERENCE_PATHS.map((path) => [path, 0])) as Record<ReferencePath, number>;
  const updates: Row = {};
  let invalidKey = false;
  if (!source || !to) return { updates, moved, invalidKey };

  for (const [key, sale] of records(data.vendas))
    if (sameName(sale.cliente, source) && sale.cliente !== to) {
      updates[`vendas/${key}/cliente`] = to;
      moved.vendas++;
    }
  for (const [key, receivable] of records(data.contasReceber))
    if (sameName(receivable.cli, source) && receivable.cli !== to) {
      updates[`contasReceber/${key}/cli`] = to;
      moved.contasReceber++;
    }
  for (const [key, ticket] of records(data.tickets)) {
    if (ticket.tipo !== 'venda') continue;
    let touched = false;
    for (const field of ['cliente', 'fornecedor', 'fornecedorNome'])
      if (sameName(ticket[field], source) && ticket[field] !== to) {
        updates[`tickets/${key}/${field}`] = to;
        touched = true;
      }
    if (touched) moved.tickets++;
  }

  const movingKeys = (path: ReferencePath): string[] =>
    Object.keys(data[path] && typeof data[path] === 'object' ? (data[path] as Row) : {}).filter(
      (key) => key !== to && nameKey(key) === source,
    );

  for (const path of LIST_MAPS) {
    const keys = movingKeys(path);
    if (!keys.length) continue;
    const map = data[path] as Row;
    const merged = [...listOf(map[to]), ...keys.flatMap((key) => listOf(map[key]))];
    for (const key of keys) updates[`${path}/${key}`] = null;
    updates[`${path}/${to}`] = merged;
    moved[path] += keys.reduce((sum, key) => sum + listOf(map[key]).length, 0);
    invalidKey ||= FORBIDDEN_NAME_CHARS.test(to);
  }

  const balanceKeys = movingKeys('fcSaldoIni');
  if (balanceKeys.length) {
    const map = data.fcSaldoIni as Row;
    const target = (map[to] && typeof map[to] === 'object' ? map[to] : null) as Row | null;
    let total = Number(target?.valor ?? 0) || 0;
    let date = String(target?.data ?? '');
    for (const key of balanceKeys) {
      const item = (map[key] && typeof map[key] === 'object' ? map[key] : {}) as Row;
      total += Number(item.valor ?? 0) || 0;
      if (!date) date = String(item.data ?? '');
      updates[`fcSaldoIni/${key}`] = null;
    }
    updates[`fcSaldoIni/${to}`] = { valor: Math.round(total * 100) / 100, data: date };
    moved.fcSaldoIni = balanceKeys.length;
    invalidKey ||= FORBIDDEN_NAME_CHARS.test(to);
  }

  const priceKeys = movingKeys('precosCli');
  if (priceKeys.length) {
    const map = data.precosCli as Row;
    const table: Row = {};
    for (const key of priceKeys) {
      Object.assign(table, map[key] && typeof map[key] === 'object' ? (map[key] as Row) : {});
      updates[`precosCli/${key}`] = null;
    }
    Object.assign(table, map[to] && typeof map[to] === 'object' ? (map[to] as Row) : {});
    updates[`precosCli/${to}`] = table;
    moved.precosCli = priceKeys.length;
    invalidKey ||= FORBIDDEN_NAME_CHARS.test(to);
  }

  return { updates, moved, invalidKey };
}

export function openFinance(data: ReferenceData, name: string): string[] {
  const source = nameKey(name);
  if (!source) return [];
  const reasons: string[] = [];
  if (
    records(data.contasReceber).some(
      ([, row]) => sameName(row.cli, source) && row.status !== 'Recebido' && Number(row.valor) > 0.005,
    )
  )
    reasons.push('conta a receber em aberto');
  const lists = (path: 'adtCli' | 'chequesCli'): Row[] =>
    Object.entries(data[path] && typeof data[path] === 'object' ? (data[path] as Row) : {})
      .filter(([key]) => nameKey(key) === source)
      .flatMap(([, value]) => listOf(value));
  if (lists('adtCli').some((row) => (row.status || 'Pendente') === 'Pendente' && Number(row.valor) > 0))
    reasons.push('adiantamento em aberto');
  if (
    lists('chequesCli').some(
      (row) => !CLOSED_CHEQUE.has(String(row.status || 'Pendente')) && Number(row.valor) > 0,
    )
  )
    reasons.push('cheque em aberto');
  return reasons;
}

export function movedSummary(moved: Record<ReferencePath, number>): string {
  const parts = [
    moved.vendas ? `${moved.vendas} venda(s)` : '',
    moved.contasReceber ? `${moved.contasReceber} conta(s) a receber` : '',
    moved.adtCli ? `${moved.adtCli} adiantamento(s)` : '',
    moved.chequesCli ? `${moved.chequesCli} cheque(s)` : '',
    moved.fcLanc ? `${moved.fcLanc} lançamento(s) da ficha` : '',
    moved.precosCli ? 'tabela de preços' : '',
    moved.tickets ? `${moved.tickets} pesagem(ns)` : '',
  ].filter(Boolean);
  return parts.join(', ');
}
