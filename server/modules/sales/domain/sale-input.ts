import { isISODate } from '../../../shared/domain/dates.js';
import { MAX_INSTALLMENTS } from './installments.js';
import type { OrderInstallment, OrderItem, SaleOrder } from './sale-order.js';
import { isRaw } from './sales.js';
import type { Raw } from './sales.js';

export const MAX_ITEMS = 200;
export const MAX_CREDITS = 60;
export const MAX_WEIGHINGS = 20;
const ID = /^[A-Za-z0-9_-]{1,120}$/;

export interface InputProblem {
  code: string;
  message: string;
}

const clip = (value: unknown, max: number): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

export const validId = (value: unknown): boolean => ID.test(String(value ?? ''));

export function orderInput(raw: unknown): { order: SaleOrder; problem?: InputProblem } {
  const source: Raw = isRaw(raw) ? raw : {};
  const list = (value: unknown, max: number): Raw[] =>
    Array.isArray(value) ? value.filter(isRaw).slice(0, max + 1) : [];
  const itemsRaw = list(source.items, MAX_ITEMS);
  const rowsRaw = list(source.installments, MAX_INSTALLMENTS);
  const credits = (Array.isArray(source.credits) ? source.credits : [])
    .map((item) => clip(item, 140))
    .filter((item) => /^(advance|cheque):.+$/.test(item));
  const weighings = (Array.isArray(source.weighings) ? source.weighings : []).map((item) => clip(item, 120));
  const items = itemsRaw.map<OrderItem>((item, index) => ({
    key: 'i' + index,
    material: clip(item.material, 80),
    description: clip(item.description, 1000),
    unit: clip(item.unit, 10) || 'kg',
    quantity: clip(item.quantity, 24),
    price: clip(item.price, 24),
    ident: clip(item.ident, 40),
    weighing: clip(item.weighing, 120),
  }));
  const installments = rowsRaw.map<OrderInstallment>((row, index) => ({
    key: 'p' + index,
    receivableId: clip(row.receivableId, 120),
    dueDate: clip(row.dueDate, 10),
    amount: clip(row.amount, 24),
    method: clip(row.method, 40),
    bank: clip(row.bank, 120),
    received: row.received === true,
    notes: clip(row.notes, 200),
  }));
  const order: SaleOrder = {
    saleId: clip(source.saleId, 120),
    client: clip(source.client, 160).replace(/\s+/g, ' '),
    number: clip(source.number, 40),
    customerOrder: clip(source.customerOrder, 60),
    date: clip(source.date, 10),
    items,
    notes: clip(source.notes, 2000),
    discount: clip(source.discount, 24),
    freight: clip(source.freight, 24),
    credits: [...new Set(credits)],
    condition: clip(source.condition, 80),
    installments,
    weighings: [...new Set(weighings)],
    locked: [],
    lockedClient: false,
  };
  const fail = (code: string, message: string) => ({ order, problem: { code, message } });
  if (order.saleId && !validId(order.saleId)) return fail('INVALID_SALE', 'Venda inválida. Atualize a tela.');
  if (itemsRaw.length > MAX_ITEMS) return fail('TOO_MANY_ITEMS', `Máximo de ${MAX_ITEMS} itens por venda.`);
  if (rowsRaw.length > MAX_INSTALLMENTS)
    return fail('TOO_MANY_INSTALLMENTS', `Máximo de ${MAX_INSTALLMENTS} parcelas.`);
  if (credits.length > MAX_CREDITS) return fail('TOO_MANY_CREDITS', 'Abatimentos demais numa venda só.');
  if (weighings.length > MAX_WEIGHINGS || weighings.some((key) => !validId(key)))
    return fail('INVALID_WEIGHING', 'Pesagem inválida. Atualize a tela.');
  if (installments.some((row) => row.receivableId && !validId(row.receivableId)))
    return fail('INVALID_RECEIVABLE', 'Parcela inválida. Atualize a tela.');
  if (order.date && !isISODate(order.date)) return fail('INVALID_DATE', 'Data da venda inválida.');
  if (/[.#$/[\]]/.test(order.client) && order.credits.length)
    return fail(
      'INVALID_CLIENT',
      'O nome do cliente tem . # $ [ ] / e não pode usar adiantamentos. Corrija o cadastro.',
    );
  return { order };
}
