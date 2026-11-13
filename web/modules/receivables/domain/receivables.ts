import { toISODate } from '../../../shared/domain/dates.js';
import { parseDecimal } from '../../../shared/domain/decimal.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { foldAccents } from '../../../shared/domain/text.js';

type Raw = Record<string, unknown>;

const text = (value: unknown): string => (value == null ? '' : String(value).trim());
const blank = (value: string): string => (value === '—' || value === '-' ? '' : value);

export interface ReceivableRow {
  id: string;
  date: string;
  number: string;
  client: string;
  amount: number;
  method: string;
  bank: string;
  due: string;
  received: boolean;
  receivedOn: string;
  overdue: boolean;
  notes: string;
  saleId: string;
  fiscal: boolean;
  bankLinked: boolean;
  cheques: string[];
  update: number | null;
}

export function receivableRows(raw: unknown, today: string): ReceivableRow[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter(
      (item): item is Raw => Boolean(item) && typeof item === 'object' && Boolean(text((item as Raw).id)),
    )
    .map((item) => {
      const received = text(item.status) === 'Recebido';
      const due = toISODate(item.venc);
      return {
        id: text(item.id),
        date: toISODate(item.data),
        number: text(item.nf),
        client: text(item.cli),
        amount: fromCents(toCents(item.valor)),
        method: blank(text(item.forma)),
        bank: blank(text(item.banco)),
        due,
        received,
        receivedOn: toISODate(item.dataReceb),
        overdue: !received && Boolean(due) && due < today,
        notes: text(item.obs),
        saleId: text(item.vendaId),
        fiscal: Boolean(text(item.fiscalPartyId)),
        bankLinked: Boolean(text(item.movBancoId)),
        cheques: Array.isArray(item.chequesRecebimento)
          ? item.chequesRecebimento.map(text).filter(Boolean)
          : [],
        update: item.atualizadoEm == null ? null : Number(item.atualizadoEm),
      };
    })
    .sort(
      (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.client.localeCompare(b.client, 'pt-BR'),
    );
}

export interface ReceivableKpis {
  open: number;
  openCount: number;
  overdue: number;
  overdueCount: number;
  received: number;
  receivedCount: number;
}

export function receivableKpis(rows: readonly ReceivableRow[]): ReceivableKpis {
  const sum = (list: readonly ReceivableRow[]) =>
    fromCents(list.reduce((total, row) => total + toCents(row.amount), 0));
  const open = rows.filter((row) => !row.received);
  const overdue = open.filter((row) => row.overdue);
  const received = rows.filter((row) => row.received);
  return {
    open: sum(open),
    openCount: open.length,
    overdue: sum(overdue),
    overdueCount: overdue.length,
    received: sum(received),
    receivedCount: received.length,
  };
}

export type StatusFilter = 'abertos' | 'atrasados' | 'recebidos' | 'todos';

export interface ReceivableFilter {
  status: StatusFilter;
  client: string;
  from: string;
  to: string;
  query: string;
}

export const EMPTY_FILTER: ReceivableFilter = { status: 'abertos', client: '', from: '', to: '', query: '' };

export function filterReceivables(rows: readonly ReceivableRow[], filter: ReceivableFilter): ReceivableRow[] {
  const client = foldAccents(filter.client).trim();
  const words = foldAccents(filter.query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.status === 'abertos' && row.received) return false;
    if (filter.status === 'atrasados' && !row.overdue) return false;
    if (filter.status === 'recebidos' && !row.received) return false;
    if (filter.from && (row.due || '') < filter.from) return false;
    if (filter.to && (row.due || '9999') > filter.to) return false;
    if (client && !foldAccents(row.client).includes(client)) return false;
    if (!words.length) return true;
    const haystack = foldAccents([row.client, row.number, row.notes, row.method, row.bank, row.id].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

export const totalOf = (rows: readonly ReceivableRow[]): number =>
  fromCents(rows.reduce((total, row) => total + toCents(row.amount), 0));

export interface ReceivableForm {
  client: string;
  number: string;
  amount: string;
  due: string;
  notes: string;
}

export type FormResult = { ok: true; payload: Record<string, unknown> } | { ok: false; message: string };

export function formRequest(form: ReceivableForm, row: ReceivableRow | null): FormResult {
  const client = form.client.trim().replace(/\s+/g, ' ');
  const value = parseDecimal(form.amount);
  const fromSale = Boolean(row?.saleId);
  if (!fromSale && !client) return { ok: false, message: 'Informe o cliente.' };
  if (!fromSale && !row?.received && (value == null || value <= 0))
    return { ok: false, message: 'Informe um valor maior que zero.' };
  if (!form.due) return { ok: false, message: 'Informe o vencimento.' };
  const fields: Record<string, unknown> = { nf: form.number.trim(), venc: form.due, obs: form.notes.trim() };
  if (!fromSale) fields.cli = client;
  if (!fromSale && !row?.received) fields.valor = value;
  if (!row) return { ok: true, payload: { action: 'create', receivable: fields } };
  return {
    ok: true,
    payload: { action: 'update', id: row.id, receivable: fields, expectedUpdate: row.update ?? undefined },
  };
}

export interface ChequeForm {
  num: string;
  banco: string;
  valor: string;
  bomPara: string;
}

export interface ReceiveForm {
  date: string;
  bank: string;
  method: string;
  notes: string;
  cheques: readonly ChequeForm[];
}

export function chequeDifference(
  cheques: readonly ChequeForm[],
  amount: number,
): { total: number; difference: number } {
  const cents = cheques.reduce((sum, cheque) => sum + toCents(parseDecimal(cheque.valor) ?? 0), 0);
  return { total: fromCents(cents), difference: fromCents(cents - toCents(amount)) };
}

export function receiveRequest(form: ReceiveForm, row: ReceivableRow): FormResult {
  if (!form.date) return { ok: false, message: 'Informe a data do recebimento.' };
  const withCheques = form.cheques.length > 0;
  for (const [index, cheque] of form.cheques.entries()) {
    const value = parseDecimal(cheque.valor);
    if (!cheque.num.trim() || value == null || value <= 0)
      return { ok: false, message: `Preencha número e valor do cheque ${index + 1}.` };
  }
  return {
    ok: true,
    payload: {
      action: 'receive',
      id: row.id,
      date: form.date,
      bank: withCheques ? '' : form.bank,
      method: withCheques ? 'Cheque' : form.method,
      notes: form.notes.trim(),
      cheques: form.cheques.map((cheque) => ({
        num: cheque.num.trim(),
        banco: cheque.banco.trim(),
        valor: parseDecimal(cheque.valor) ?? 0,
        bomPara: cheque.bomPara,
      })),
    },
  };
}
