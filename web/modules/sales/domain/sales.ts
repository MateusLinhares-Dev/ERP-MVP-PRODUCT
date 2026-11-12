import { daysBetween, toISODate } from '../../../shared/domain/dates.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { foldAccents } from '../../../shared/domain/text.js';

export type Raw = Record<string, unknown>;

export interface SalesData {
  sales: Raw[];
  receivables: Raw[];
  clientAdvances: Record<string, Raw[]>;
  clientCheques: Record<string, Raw[]>;
  tickets: Record<string, Raw>;
}

export const text = (value: unknown): string => (value == null ? '' : String(value).trim());
export const amount = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
export const isRaw = (value: unknown): value is Raw => Boolean(value) && typeof value === 'object';

export const RECEIVED = 'Recebido';
const SETTLED_SALE = new Set(['Pago', 'Permuta']);
const CLOSED_CHEQUE = new Set(['Compensado', 'Devolvido', 'Quitado']);

export function receivablesOf(data: SalesData, saleId: string): Raw[] {
  if (!saleId) return [];
  return data.receivables.filter((row) => isRaw(row) && text(row.vendaId) === saleId);
}

export function itemQuantity(item: Raw): number {
  return amount(item.qt ?? item.pesoLiq ?? item.quantidade);
}

export interface SaleRow {
  id: string;
  number: string;
  date: string;
  client: string;
  materials: string[];
  kg: number;
  total: number;
  received: number;
  pending: number;
  due: string;
  status: string;
  overdue: boolean;
  settled: boolean;
}

export function saleRow(data: SalesData, sale: Raw, today: string): SaleRow {
  const id = text(sale.id);
  const total = amount(sale.total);
  const items = Array.isArray(sale.itens) ? sale.itens.filter(isRaw) : [];
  const linked = receivablesOf(data, id);
  const stored = text(sale.status) || 'Pendente';
  let receivedCents = 0;
  let pendingCents = 0;
  let firstPending = '';
  for (const row of linked) {
    const cents = toCents(row.valor);
    if (text(row.status) === RECEIVED) receivedCents += cents;
    else {
      pendingCents += cents;
      const due = toISODate(row.venc) || toISODate(row.data);
      if (due && (!firstPending || due < firstPending)) firstPending = due;
    }
  }
  if (!linked.length) {
    if (SETTLED_SALE.has(stored)) receivedCents = toCents(total);
    else pendingCents = toCents(total);
  }
  const settled = pendingCents <= 0;
  const status = settled
    ? stored === 'Permuta'
      ? 'Permuta'
      : 'Pago'
    : stored === 'Pago'
      ? 'Pendente'
      : stored;
  const due = settled ? toISODate(sale.venc) : firstPending || toISODate(sale.venc);
  return {
    id,
    number: text(sale.nf),
    date: toISODate(sale.data),
    client: text(sale.cliente),
    materials: [...new Set(items.map((item) => text(item.mat)).filter(Boolean))],
    kg: items.reduce((sum, item) => sum + itemQuantity(item), 0),
    total,
    received: fromCents(receivedCents),
    pending: fromCents(pendingCents),
    due,
    status,
    overdue: !settled && Boolean(due) && due < today,
    settled,
  };
}

export function saleRows(data: SalesData, today: string): SaleRow[] {
  return data.sales
    .filter((sale): sale is Raw => isRaw(sale) && Boolean(text(sale.id)))
    .map((sale) => saleRow(data, sale, today))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export interface SalesKpis {
  total: number;
  count: number;
  month: number;
  monthCount: number;
  pending: number;
  pendingCount: number;
  overdue: number;
}

export function salesKpis(rows: readonly SaleRow[], today: string): SalesKpis {
  const month = today.slice(0, 7);
  const ofMonth = rows.filter((row) => row.date.startsWith(month));
  const open = rows.filter((row) => !row.settled);
  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    count: rows.length,
    month: ofMonth.reduce((sum, row) => sum + row.total, 0),
    monthCount: ofMonth.length,
    pending: open.reduce((sum, row) => sum + row.pending, 0),
    pendingCount: open.length,
    overdue: rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.pending, 0),
  };
}

export type StatusFilter = 'todos' | 'pendente' | 'pago';

export interface HistoryFilter {
  status: StatusFilter;
  client: string;
  from: string;
  to: string;
  query: string;
}

export const EMPTY_FILTER: HistoryFilter = { status: 'todos', client: '', from: '', to: '', query: '' };

export function filterSales(rows: readonly SaleRow[], filter: HistoryFilter): SaleRow[] {
  const client = foldAccents(filter.client).trim();
  const words = foldAccents(filter.query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.status === 'pendente' && row.settled) return false;
    if (filter.status === 'pago' && !row.settled) return false;
    if (filter.from && row.date < filter.from) return false;
    if (filter.to && row.date > filter.to) return false;
    if (client && !foldAccents(row.client).includes(client)) return false;
    if (!words.length) return true;
    const haystack = foldAccents([row.number, row.client, row.id, ...row.materials].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

export function summarize(rows: readonly SaleRow[]): {
  total: number;
  kg: number;
  received: number;
  pending: number;
} {
  return rows.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      kg: sum.kg + row.kg,
      received: sum.received + row.received,
      pending: sum.pending + row.pending,
    }),
    { total: 0, kg: 0, received: 0, pending: 0 },
  );
}

export interface ClientCredit {
  kind: 'advance' | 'cheque';
  ref: string;
  date: string;
  amount: number;
  detail: string;
  bank: string;
}

function byClient(map: Record<string, Raw[]>, client: string): Raw[] {
  const direct = map[client];
  if (Array.isArray(direct)) return direct.filter(isRaw);
  const key = Object.keys(map).find((name) => foldAccents(name).trim() === foldAccents(client).trim());
  const list = key ? map[key] : undefined;
  return Array.isArray(list) ? list.filter(isRaw) : [];
}

export function clientCredits(data: SalesData, client: string): ClientCredit[] {
  if (!text(client)) return [];
  const cheques = byClient(data.clientCheques, client)
    .filter(
      (row) => !CLOSED_CHEQUE.has(text(row.status) || 'Pendente') && amount(row.valor) > 0 && text(row.num),
    )
    .map<ClientCredit>((row) => ({
      kind: 'cheque',
      ref: text(row.num),
      date: text(row.bomPara) || text(row.data),
      amount: amount(row.valor),
      detail: [text(row.bomPara) ? 'bom para ' + text(row.bomPara) : '', text(row.banco)]
        .filter(Boolean)
        .join(' · '),
      bank: text(row.banco),
    }));
  const advances = byClient(data.clientAdvances, client)
    .filter(
      (row) => (text(row.status) || 'Pendente') === 'Pendente' && amount(row.valor) > 0 && text(row.cod),
    )
    .map<ClientCredit>((row) => ({
      kind: 'advance',
      ref: text(row.cod),
      date: text(row.data),
      amount: amount(row.valor),
      detail: [text(row.data), text(row.forma), text(row.bancoNome)].filter(Boolean).join(' · '),
      bank: text(row.bancoNome),
    }));
  return [...cheques, ...advances];
}

export interface CreditUse {
  kind: 'advance' | 'cheque';
  ref: string;
  cents: number;
  bank: string;
}

export function planCredits(
  balanceCents: number,
  credits: readonly ClientCredit[],
): { uses: CreditUse[]; remaining: number; error?: string } {
  let remaining = Math.max(0, Math.round(balanceCents));
  const uses: CreditUse[] = [];
  for (const credit of credits.filter((item) => item.kind === 'cheque')) {
    const cents = toCents(credit.amount);
    if (cents <= 0) continue;
    if (cents > remaining)
      return {
        uses: [],
        remaining,
        error: `O cheque nº ${credit.ref} é maior que o saldo a receber desta venda. Cheque não pode ser usado em parte: desmarque-o ou ajuste os valores.`,
      };
    uses.push({ kind: 'cheque', ref: credit.ref, cents, bank: credit.bank });
    remaining -= cents;
  }
  for (const credit of credits.filter((item) => item.kind === 'advance')) {
    const cents = toCents(credit.amount);
    if (cents <= 0) continue;
    if (remaining <= 0)
      return {
        uses: [],
        remaining,
        error: `O saldo desta venda já está coberto. Desmarque o adiantamento ${credit.ref}.`,
      };
    const used = Math.min(cents, remaining);
    uses.push({ kind: 'advance', ref: credit.ref, cents: used, bank: credit.bank });
    remaining -= used;
  }
  return { uses, remaining };
}

export interface PendingWeighing {
  key: string;
  ticket: string;
  date: string;
  client: string;
  plate: string;
  kg: number;
  items: Array<{ material: string; kg: number }>;
}

export function weighingItems(ticket: Raw): Array<{ material: string; kg: number }> {
  const loads = Array.isArray(ticket.pesagens) ? ticket.pesagens.filter(isRaw) : [];
  const fromLoads = loads
    .map((load) => ({ material: text(load.material), kg: amount(load.pesoLiquido) }))
    .filter((item) => item.kg > 0);
  if (fromLoads.length) return fromLoads;
  const items = Array.isArray(ticket.itens) ? ticket.itens.filter(isRaw) : [];
  const fromItems = items
    .map((item) => ({ material: text(item.mat ?? item.material), kg: amount(item.pesoLiq ?? item.qt) }))
    .filter((item) => item.kg > 0);
  if (fromItems.length) return fromItems;
  const net = amount(ticket.pesoLiquido);
  return net > 0 ? [{ material: text(ticket.material), kg: net }] : [];
}

export function isSaleWeighing(ticket: unknown): ticket is Raw {
  return (
    isRaw(ticket) &&
    text(ticket.tipo) === 'venda' &&
    ticket._balFinalizado === true &&
    text(ticket.status) === 'Aguard. Preço'
  );
}

export function pendingWeighings(data: SalesData): PendingWeighing[] {
  return Object.entries(data.tickets)
    .filter(([, ticket]) => isSaleWeighing(ticket) && !text(ticket.vendaId) && ticket.vendaArquivada !== true)
    .map(([key, ticket]) => {
      const items = weighingItems(ticket);
      return {
        key,
        ticket: text(ticket.ticket) || key,
        date: toISODate(ticket.dataSaida) || toISODate(ticket.data),
        client: text(ticket.cliente) || text(ticket.fornecedor),
        plate: text(ticket.placa),
        kg: items.reduce((sum, item) => sum + item.kg, 0),
        items,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.ticket.localeCompare(a.ticket));
}

export const RECENT_WEIGHING_DAYS = 15;

export function splitWeighings(
  rows: readonly PendingWeighing[],
  today: string,
): { recent: PendingWeighing[]; old: PendingWeighing[] } {
  const isOld = (row: PendingWeighing) =>
    Boolean(row.date) && daysBetween(row.date, today) > RECENT_WEIGHING_DAYS;
  return { recent: rows.filter((row) => !isOld(row)), old: rows.filter(isOld) };
}
