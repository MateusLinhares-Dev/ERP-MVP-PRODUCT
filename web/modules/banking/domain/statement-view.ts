import { parseDecimal } from '../../../shared/domain/decimal.js';
import { foldAccents } from '../../../shared/domain/text.js';
import { brl, isoDate, statement } from './ledger.js';
import type { Raw, Statement, StatementRow } from './ledger.js';

export interface MovementLinks {
  advanceMovementIds: ReadonlySet<string>;
  chequeMovementIds: ReadonlySet<string>;
}

export interface StatementFilter {
  query: string;
  kind: '' | 'entrada' | 'saida';
  from: string;
  to: string;
}

export const emptyStatementFilter = (): StatementFilter => ({ query: '', kind: '', from: '', to: '' });

export interface StatementLine extends StatementRow {
  id: string;
  label: string;
  automatic: boolean;
}

export interface StatementView {
  totals: Omit<Statement, 'rows'>;
  lines: StatementLine[];
  all: number;
}

export function isAutomatic(entry: Raw, links: MovementLinks): boolean {
  const id = String(entry.id ?? '');
  if (/^LB-(PG|REP|VD|CR|CHQ)-/.test(id)) return true;
  if (entry.payableId || entry.saleId || entry.receivableId || entry.chequeId) return true;
  if (entry.source === 'advance' || entry.source === 'cheque' || entry.advanceCode) return true;
  if (/^Adiantamento: /i.test(String(entry.descricao ?? ''))) return true;
  return links.advanceMovementIds.has(id) || links.chequeMovementIds.has(id);
}

export const brDate = (iso: string, raw: unknown): string =>
  iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : String(raw ?? '') || '—';

export function statementView(
  account: Raw,
  entries: readonly unknown[],
  filter: StatementFilter,
  links: MovementLinks,
): StatementView {
  const { rows, ...totals } = statement(account.saldo ?? 0, String(account.cod ?? ''), entries);
  const query = foldAccents(filter.query).trim();
  const lines = rows
    .map((row) => ({
      ...row,
      id: String(row.entry.id ?? ''),
      label: foldAccents(
        [
          brDate(row.date, row.entry.data),
          row.entry.descricao,
          row.incoming ? 'entrada' : 'saida',
          brl(row.amount),
        ].join(' '),
      ),
      automatic: isAutomatic(row.entry, links),
    }))
    .reverse();
  const filtered = lines.filter(
    (line) =>
      (!query || line.label.includes(query)) &&
      (!filter.kind || (line.incoming ? 'entrada' : 'saida') === filter.kind) &&
      (!filter.from || line.date >= filter.from) &&
      (!filter.to || (line.date !== '' && line.date <= filter.to)),
  );
  return { totals, lines: filtered, all: lines.length };
}

export interface EntryForm {
  data: string;
  descricao: string;
  tipo: 'Entrada' | 'Saída';
  valor: string;
}

export const emptyEntryForm = (today: string): EntryForm => ({
  data: today,
  descricao: '',
  tipo: 'Entrada',
  valor: '',
});

export function entryFormOf(entry: Raw): EntryForm {
  const value = Number(entry.valor) || 0;
  return {
    data: isoDate(entry.data),
    descricao: String(entry.descricao ?? ''),
    tipo: entry.tipo === 'Entrada' || entry.tipo === 'Crédito' ? 'Entrada' : 'Saída',
    valor: value ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
  };
}

export type EntryRequest =
  | { ok: true; entry: { data: string; descricao: string; tipo: 'Entrada' | 'Saída'; valor: number } }
  | { ok: false; message: string };

export function entryRequest(form: EntryForm): EntryRequest {
  const data = isoDate(form.data);
  if (!data) return { ok: false, message: 'Informe a data.' };
  const descricao = form.descricao.replace(/\s+/g, ' ').trim();
  if (!descricao) return { ok: false, message: 'Informe a descrição.' };
  if (form.tipo !== 'Entrada' && form.tipo !== 'Saída')
    return { ok: false, message: 'Selecione um tipo de movimentação válido.' };
  const valor = parseDecimal(form.valor);
  if (
    valor === null ||
    !(valor > 0) ||
    !Number.isSafeInteger(Math.round(valor * 100)) ||
    Math.abs(Math.round(valor * 100) - valor * 100) > 0.000001
  )
    return { ok: false, message: 'Informe um valor positivo, com no máximo duas casas decimais.' };
  return { ok: true, entry: { data, descricao, tipo: form.tipo, valor } };
}

export const expectedOf = (entry: Raw) => ({
  data: entry.data,
  descricao: entry.descricao,
  tipo: entry.tipo,
  valor: entry.valor,
});
