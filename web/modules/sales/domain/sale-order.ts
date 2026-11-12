import { parseDecimal, toFieldText } from '../../../shared/domain/decimal.js';
import { isISODate, toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { formatAmount, fromCents, toCents } from '../../../shared/domain/money.js';
import { nameKey } from '../../../shared/domain/text.js';
import { MAX_INSTALLMENTS, parseCondition, planSize, splitPlan } from './installments.js';
import { RECEIVED, amount, isRaw, planCredits, receivablesOf, text, weighingItems } from './sales.js';
import type { ClientCredit, CreditUse, Raw, SalesData } from './sales.js';

export const PAYMENT_METHODS = [
  'PIX',
  'Dinheiro',
  'Transferência',
  'Depósito',
  'Boleto',
  'Cheque',
  'Cartão',
  'Permuta',
  'A prazo',
] as const;

const NO_BANK = new Set(['Permuta', 'A prazo', 'Dinheiro']);
const PERMUTA = /permuta/i;

export interface OrderItem {
  key: string;
  material: string;
  description: string;
  unit: string;
  quantity: string;
  price: string;
  ident: string;
  weighing: string;
}

export interface OrderInstallment {
  key: string;
  receivableId: string;
  dueDate: string;
  amount: string;
  method: string;
  bank: string;
  received: boolean;
  notes: string;
}

export interface LockedReceipt {
  id: string;
  date: string;
  method: string;
  bank: string;
  amount: number;
  notes: string;
}

export interface SaleOrder {
  saleId: string;
  client: string;
  number: string;
  customerOrder: string;
  date: string;
  items: OrderItem[];
  notes: string;
  discount: string;
  freight: string;
  credits: string[];
  condition: string;
  installments: OrderInstallment[];
  weighings: string[];
  locked: LockedReceipt[];
  lockedClient: boolean;
}

let sequence = 0;
export const nextKey = (prefix: string): string => `${prefix}${++sequence}-${Date.now().toString(36)}`;

export const creditKey = (credit: { kind: string; ref: string }): string => `${credit.kind}:${credit.ref}`;

export const numberOf = (value: string): number => parseDecimal(value) ?? 0;

export function blankItem(): OrderItem {
  return {
    key: nextKey('item'),
    material: '',
    description: '',
    unit: 'kg',
    quantity: '',
    price: '',
    ident: '',
    weighing: '',
  };
}

export function blankOrder(today: string, client = ''): SaleOrder {
  return {
    saleId: '',
    client,
    number: '',
    customerOrder: '',
    date: today,
    items: [blankItem()],
    notes: '',
    discount: '',
    freight: '',
    credits: [],
    condition: '',
    installments: [],
    weighings: [],
    locked: [],
    lockedClient: false,
  };
}

function installmentOf(row: Raw, fallbackDate: string): OrderInstallment {
  return {
    key: nextKey('parcela'),
    receivableId: text(row.id),
    dueDate: toISODate(row.venc) || toISODate(row.data) || fallbackDate,
    amount: toFieldText(amount(row.valor)),
    method: text(row.forma).replace(/^[—-]$/, ''),
    bank: text(row.bancoCod) || text(row.banco).replace(/^[—-]$/, ''),
    received: false,
    notes: text(row.obs),
  };
}

export function orderFromSale(data: SalesData, sale: Raw, today: string): SaleOrder {
  const id = text(sale.id);
  const date = toISODate(sale.data) || today;
  const items = (Array.isArray(sale.itens) ? sale.itens.filter(isRaw) : []).map<OrderItem>((item) => ({
    key: nextKey('item'),
    material: text(item.mat) || text(item.matBase),
    description: text(item.descricao) || text(item.obs),
    unit: text(item.unidade) || 'kg',
    quantity: toFieldText(amount(item.qt ?? item.quantidade)),
    price: toFieldText(amount(item.pr ?? item.preco)),
    ident: text(item.ident),
    weighing: text(item.pesagem),
  }));
  const extras = Array.isArray(sale.acrescimos)
    ? sale.acrescimos.filter(isRaw).reduce((sum, row) => sum + amount(row.v), 0)
    : amount(sale.acrescimo);
  const linked = receivablesOf(data, sale);
  const locked: LockedReceipt[] = [];
  const installments: OrderInstallment[] = [];
  for (const row of linked) {
    if (text(row.status) === RECEIVED)
      locked.push({
        id: text(row.id),
        date: toISODate(row.dataReceb) || toISODate(row.data) || date,
        method: text(row.forma) || 'Recebido',
        bank: text(row.banco).replace(/^[—-]$/, ''),
        amount: amount(row.valor),
        notes: text(row.obs),
      });
    else installments.push(installmentOf(row, date));
  }
  const status = text(sale.status);
  if (!linked.length && amount(sale.total) > 0) {
    if (status === 'Pago' || status === 'Permuta')
      locked.push({
        id: '',
        date,
        method: status === 'Permuta' ? 'Permuta' : 'Recebido no lançamento',
        bank: '',
        amount: amount(sale.total),
        notes: 'Venda marcada como paga antes do controle por parcelas',
      });
    else
      installments.push({
        key: nextKey('parcela'),
        receivableId: '',
        dueDate: toISODate(sale.venc) || date,
        amount: toFieldText(amount(sale.total)),
        method: '',
        bank: '',
        received: false,
        notes: '',
      });
  }
  const applied = Array.isArray(sale.abatimentos) && sale.abatimentos.length > 0;
  return {
    saleId: id,
    client: text(sale.cliente),
    number: text(sale.nf),
    customerOrder: text(sale.ordemCompra),
    date,
    items: items.length ? items : [blankItem()],
    notes: text(sale.obs),
    discount: amount(sale.desconto) > 0 ? toFieldText(amount(sale.desconto)) : '',
    freight: extras > 0 ? toFieldText(extras) : '',
    credits: [],
    condition: '',
    installments,
    weighings: Array.isArray(sale.pesagens) ? sale.pesagens.map(text).filter(Boolean) : [],
    locked,
    lockedClient: locked.length > 0 || applied,
  };
}

export function weighingOrderItems(ticket: Raw, key: string): OrderItem[] {
  return weighingItems(ticket).map((item) => ({
    ...blankItem(),
    material: item.material,
    quantity: toFieldText(item.kg),
    weighing: key,
  }));
}

export function addWeighing(order: SaleOrder, data: SalesData, key: string): SaleOrder {
  const ticket = data.tickets[key];
  if (!ticket || order.weighings.includes(key)) return order;
  const kept = order.items.filter((item) => item.material || numberOf(item.quantity) > 0);
  return {
    ...order,
    client: order.client || text(ticket.cliente) || text(ticket.fornecedor),
    weighings: [...order.weighings, key],
    items: [...kept, ...weighingOrderItems(ticket, key)],
  };
}

export function priceItems(
  order: SaleOrder,
  priceOf: (client: string, material: string) => number,
): SaleOrder {
  const client = order.client.trim();
  if (!client) return order;
  let changed = false;
  const items = order.items.map((item) => {
    if (!item.material.trim() || numberOf(item.price) > 0) return item;
    const price = priceOf(client, item.material.trim());
    if (!(price > 0)) return item;
    changed = true;
    return { ...item, price: toFieldText(price) };
  });
  return changed ? { ...order, items } : order;
}

export function removeWeighing(order: SaleOrder, key: string): SaleOrder {
  const items = order.items.filter((item) => item.weighing !== key);
  return {
    ...order,
    weighings: order.weighings.filter((item) => item !== key),
    items: items.length ? items : [blankItem()],
  };
}

export interface OrderTotals {
  itemCount: number;
  quantity: number;
  products: number;
  discount: number;
  freight: number;
  total: number;
}

export const lineTotal = (item: OrderItem): number =>
  fromCents(toCents(numberOf(item.quantity) * numberOf(item.price)));

export function orderTotals(order: SaleOrder): OrderTotals {
  const lines = order.items.filter((item) => numberOf(item.quantity) > 0);
  const productsCents = lines.reduce((sum, item) => sum + toCents(lineTotal(item)), 0);
  const discountCents = Math.max(0, toCents(numberOf(order.discount)));
  const freightCents = Math.max(0, toCents(numberOf(order.freight)));
  return {
    itemCount: lines.length,
    quantity: lines.reduce((sum, item) => sum + numberOf(item.quantity), 0),
    products: fromCents(productsCents),
    discount: fromCents(discountCents),
    freight: fromCents(freightCents),
    total: fromCents(Math.max(0, productsCents - discountCents + freightCents)),
  };
}

export interface OrderBalance {
  totals: OrderTotals;
  settledCents: number;
  dueCents: number;
  uses: CreditUse[];
  creditCents: number;
  balanceCents: number;
  creditError: string;
}

export function selectedCredits(order: SaleOrder, available: readonly ClientCredit[]): ClientCredit[] {
  const chosen = new Set(order.credits);
  return available.filter((credit) => chosen.has(creditKey(credit)));
}

export function orderBalance(order: SaleOrder, available: readonly ClientCredit[]): OrderBalance {
  const totals = orderTotals(order);
  const settledCents = order.locked.reduce((sum, row) => sum + toCents(row.amount), 0);
  const dueCents = toCents(totals.total) - settledCents;
  const plan = planCredits(Math.max(0, dueCents), selectedCredits(order, available));
  const creditCents = plan.error ? 0 : plan.uses.reduce((sum, use) => sum + use.cents, 0);
  return {
    totals,
    settledCents,
    dueCents,
    uses: plan.error ? [] : plan.uses,
    creditCents,
    balanceCents: Math.max(0, dueCents - creditCents),
    creditError: plan.error ?? '',
  };
}

export function balanceInstallments(order: SaleOrder, available: readonly ClientCredit[]): SaleOrder {
  const { balanceCents } = orderBalance(order, available);
  if (balanceCents <= 0) return order.installments.length ? { ...order, installments: [] } : order;
  const rows = order.installments.length
    ? order.installments
    : [
        {
          key: nextKey('parcela'),
          receivableId: '',
          dueDate: order.date,
          amount: '',
          method: '',
          bank: '',
          received: false,
          notes: '',
        },
      ];
  const others = rows.slice(0, -1).reduce((sum, row) => sum + toCents(numberOf(row.amount)), 0);
  const last = rows[rows.length - 1];
  if (!last) return order;
  const lastAmount = toFieldText(fromCents(balanceCents - others));
  if (last.amount === lastAmount && rows === order.installments) return order;
  return { ...order, installments: [...rows.slice(0, -1), { ...last, amount: lastAmount }] };
}

export function generateInstallments(
  order: SaleOrder,
  available: readonly ClientCredit[],
): { order: SaleOrder; error?: string } {
  const { balanceCents } = orderBalance(order, available);
  if (balanceCents <= 0) return { order, error: 'Não há saldo a receber para dividir em parcelas.' };
  const plan = parseCondition(order.condition);
  if (!plan)
    return {
      order,
      error:
        'Condição inválida. Informe a quantidade de parcelas (ex.: 3x, todas no mesmo dia) ou os dias separados por espaço (ex.: 0 30 60).',
    };
  if (balanceCents < planSize(plan))
    return { order, error: 'O saldo é pequeno demais para essa quantidade de parcelas.' };
  const reusable = order.installments.filter((row) => !row.received);
  const first = order.installments[0];
  const rows = splitPlan(plan, balanceCents, order.date, first?.dueDate || order.date).map<OrderInstallment>(
    (row, index) => ({
      key: nextKey('parcela'),
      receivableId: reusable[index]?.receivableId ?? '',
      dueDate: row.dueDate,
      amount: toFieldText(fromCents(row.cents)),
      method: first?.method ?? '',
      bank: first?.bank ?? '',
      received: false,
      notes: '',
    }),
  );
  return { order: { ...order, installments: rows } };
}

export function addInstallment(order: SaleOrder): { order: SaleOrder; error?: string } {
  if (order.installments.length >= MAX_INSTALLMENTS)
    return { order, error: `Máximo de ${MAX_INSTALLMENTS} parcelas.` };
  const last = order.installments[order.installments.length - 1];
  if (!last) return { order };
  const half = Math.floor(toCents(numberOf(last.amount)) / 2);
  return {
    order: {
      ...order,
      installments: [
        ...order.installments.slice(0, -1),
        { ...last, amount: toFieldText(fromCents(half)) },
        {
          key: nextKey('parcela'),
          receivableId: '',
          dueDate: last.dueDate || order.date,
          amount: '',
          method: last.method,
          bank: last.bank,
          received: false,
          notes: '',
        },
      ],
    },
  };
}

export function nextSaleNumber(sales: readonly Raw[]): string {
  const max = sales.reduce((top, sale) => {
    const match = /^V(\d{1,8})$/i.exec(text(sale?.nf));
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return 'V' + String(max + 1).padStart(4, '0');
}

export function stockIssues(
  order: SaleOrder,
  available: (material: string) => number | null,
): Array<{ material: string; requested: number; available: number }> {
  const requested = new Map<string, { material: string; kg: number }>();
  for (const item of order.items) {
    const kg = numberOf(item.quantity);
    if (!item.material.trim() || kg <= 0) continue;
    const key = nameKey(item.material);
    const current = requested.get(key);
    requested.set(key, { material: current?.material ?? item.material.trim(), kg: (current?.kg ?? 0) + kg });
  }
  const issues: Array<{ material: string; requested: number; available: number }> = [];
  for (const { material, kg } of requested.values()) {
    const stock = available(material);
    if (stock != null && kg > stock + 0.0001) issues.push({ material, requested: kg, available: stock });
  }
  return issues;
}

export function validateOrder(order: SaleOrder, available: readonly ClientCredit[]): string {
  if (!order.client.trim()) return 'Informe o cliente.';
  if (!isISODate(order.date)) return 'Informe a data da venda.';
  const filled = order.items.filter((item) => numberOf(item.quantity) > 0);
  const missing = order.items.findIndex((item) => numberOf(item.quantity) > 0 && !item.material.trim());
  if (missing >= 0) return `Escolha o material da linha ${missing + 1}.`;
  if (!filled.length) return 'Adicione pelo menos um item com quantidade.';
  if (
    order.items.some((item) => (parseDecimal(item.quantity) ?? 0) < 0 || (parseDecimal(item.price) ?? 0) < 0)
  )
    return 'Quantidade e preço não podem ser negativos.';
  const unpriced = order.items.findIndex((item) => numberOf(item.quantity) > 0 && numberOf(item.price) <= 0);
  if (unpriced >= 0)
    return `Informe o preço da linha ${unpriced + 1} (${order.items[unpriced]?.material.trim() || 'material'}).`;
  const balance = orderBalance(order, available);
  if (balance.creditError) return balance.creditError;
  if (balance.dueCents < 0)
    return `O total da venda ficou menor do que já foi recebido (R$ ${formatAmount(fromCents(balance.settledCents))}). Estorne o recebimento em Contas a Receber antes de reduzir a venda.`;
  if (balance.balanceCents <= 0) return '';
  const rows = order.installments;
  if (!rows.length) return 'Informe como o saldo será recebido (parcelas).';
  if (rows.length > MAX_INSTALLMENTS) return `Máximo de ${MAX_INSTALLMENTS} parcelas.`;
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    if (!isISODate(row.dueDate)) return `Informe a data de vencimento da parcela ${line}.`;
    if (toCents(numberOf(row.amount)) <= 0)
      return index === rows.length - 1 && rows.length > 1
        ? 'A soma das parcelas passa do saldo a receber. Ajuste os valores.'
        : `Informe o valor da parcela ${line}.`;
    if (row.received && !row.method) return `Informe a forma de recebimento da parcela ${line}.`;
    if (row.received && row.method === 'A prazo')
      return `A parcela ${line} está como "A prazo": desmarque "Recebido" ou escolha outra forma.`;
  }
  const sum = rows.reduce((total, row) => total + toCents(numberOf(row.amount)), 0);
  if (sum !== balance.balanceCents)
    return `A soma das parcelas (R$ ${formatAmount(fromCents(sum))}) precisa ser igual ao saldo a receber (R$ ${formatAmount(fromCents(balance.balanceCents))}).`;
  return '';
}

export interface BankOption {
  cod: string;
  banco: string;
  label?: string;
}

export interface CommitContext {
  data: SalesData;
  credits: readonly ClientCredit[];
  banks: readonly BankOption[];
  today: string;
  now: number;
  user: string;
  newId(prefix: string): string;
}

export interface SaleCommit {
  sale: Raw;
  upsertReceivables: Raw[];
  removeReceivables: string[];
  creditUses: Array<{ kind: 'advance' | 'cheque'; ref: string; amount: number }>;
  bankMovements: Array<{
    bank: string;
    date: string;
    description: string;
    amount: number;
    receivableId: string;
  }>;
  linkWeighings: string[];
  unlinkWeighings: string[];
}

export const methodNeedsBank = (method: string): boolean => Boolean(method) && !NO_BANK.has(method);

function saleStatus(order: SaleOrder, rows: readonly OrderInstallment[], usesPermuta: boolean): string {
  const open = rows.filter((row) => !row.received);
  if (!open.length) return usesPermuta ? 'Permuta' : 'Pago';
  return open.every((row) => row.dueDate > order.date) ? 'A prazo' : 'Pendente';
}

export function buildCommit(order: SaleOrder, context: CommitContext): SaleCommit {
  const { data, banks, today, now } = context;
  const previous = order.saleId ? (data.sales.find((sale) => text(sale?.id) === order.saleId) ?? null) : null;
  const id = order.saleId || context.newId('VD-');
  const client = order.client.trim();
  const number = order.number.trim() || (previous ? text(previous.nf) : nextSaleNumber(data.sales));
  const saleDate = toBRDate(order.date);
  const balance = orderBalance(order, context.credits);
  const totals = balance.totals;
  const bankName = (cod: string): string => banks.find((bank) => bank.cod === cod)?.banco ?? cod;
  const reference = number ? ' — ' + number : '';

  const items = order.items
    .filter((item) => numberOf(item.quantity) > 0)
    .map((item) => {
      const record: Raw = {
        mat: item.material.trim(),
        matBase: item.material.trim(),
        ident: item.ident,
        qt: numberOf(item.quantity),
        pr: numberOf(item.price),
        total: lineTotal(item),
        unidade: item.unit || 'kg',
      };
      if (item.description.trim()) record.descricao = item.description.trim();
      if (item.weighing) record.pesagem = item.weighing;
      return record;
    });

  const linked = previous ? receivablesOf(data, previous) : [];
  const upsert: Raw[] = [];
  const keep = new Set<string>();
  const creditUses = balance.uses.map((use) => ({
    kind: use.kind,
    ref: use.ref,
    amount: fromCents(use.cents),
  }));
  for (const use of balance.uses)
    upsert.push({
      id: context.newId('CR'),
      data: saleDate,
      cli: client,
      nf: number,
      valor: fromCents(use.cents),
      forma: use.kind === 'cheque' ? 'Cheque' : 'Adiantamento',
      banco: use.bank,
      venc: saleDate,
      status: RECEIVED,
      dataReceb: saleDate,
      obs: (use.kind === 'cheque' ? 'Cheque nº ' : 'Adiantamento ') + use.ref + reference,
      vendaId: id,
    });

  const rows = balance.balanceCents > 0 ? order.installments : [];
  const receiptDate = previous ? today : order.date;
  const bankMovements: SaleCommit['bankMovements'] = [];
  for (const row of rows) {
    const old = row.receivableId ? linked.find((item) => text(item.id) === row.receivableId) : undefined;
    const value = fromCents(toCents(numberOf(row.amount)));
    const bank = methodNeedsBank(row.method) ? row.bank : '';
    const receivableId = old ? text(old.id) : context.newId('CR');
    const record: Raw = {
      ...(old ?? {}),
      id: receivableId,
      data: saleDate,
      cli: client,
      nf: number,
      valor: value,
      forma: row.method || '—',
      banco: bank ? bankName(bank) : '—',
      bancoCod: bank,
      venc: toBRDate(row.dueDate),
      status: row.received ? RECEIVED : 'Pendente',
      dataReceb: row.received ? toBRDate(receiptDate) : '',
      obs: row.notes.trim() || 'Venda' + (number ? ' – ' + number : ''),
      vendaId: id,
    };
    if (old) keep.add(text(old.id));
    upsert.push(record);
    if (row.received && bank)
      bankMovements.push({
        bank,
        date: receiptDate,
        description: 'Recebto Venda: ' + client + (number ? ' NF ' + number : ''),
        amount: value,
        receivableId,
      });
  }
  for (const old of linked) {
    if (text(old.status) === RECEIVED && (text(old.nf) !== number || text(old.vendaId) !== id))
      upsert.push({ ...old, nf: number, vendaId: id });
  }
  const removeReceivables = linked
    .filter((old) => text(old.status) !== RECEIVED && !keep.has(text(old.id)))
    .map((old) => text(old.id));

  const usesPermuta =
    [
      ...order.locked.map((row) => row.method),
      ...rows.filter((row) => row.received).map((row) => row.method),
    ].some((method) => PERMUTA.test(method)) &&
    [
      ...order.locked.map((row) => row.method),
      ...rows.filter((row) => row.received).map((row) => row.method),
    ].every((method) => PERMUTA.test(method)) &&
    balance.uses.length === 0;
  const open = rows.filter((row) => !row.received);
  const due = open.map((row) => row.dueDate).sort()[0] ?? rows[rows.length - 1]?.dueDate ?? order.date;

  const previousExtras =
    previous && Array.isArray(previous.acrescimos) ? previous.acrescimos.filter(isRaw) : [];
  const previousExtraCents = previousExtras.reduce((sum, row) => sum + toCents(row.v), 0);
  const acrescimos =
    previousExtras.length && previousExtraCents === toCents(totals.freight)
      ? previousExtras
      : totals.freight > 0
        ? [{ v: totals.freight, obs: 'Frete / acréscimos', quando: today }]
        : [];
  const previousCredits =
    previous && Array.isArray(previous.abatimentos) ? previous.abatimentos.filter(isRaw) : [];

  const sale: Raw = {
    ...(previous ?? {}),
    id,
    nf: number,
    data: saleDate,
    cliente: client,
    itens: items,
    subtotal: totals.products,
    desconto: totals.discount,
    descontoTipo: 'R$',
    descontoInput: totals.discount,
    acrescimo: totals.freight,
    acrescimos,
    total: totals.total,
    venc: toBRDate(due),
    status: saleStatus(order, rows, usesPermuta),
    obs: order.notes.trim(),
    ordemCompra: order.customerOrder.trim(),
    pesagens: order.weighings,
    parcelas: rows.map((row) => ({
      vencimento: row.dueDate,
      valor: fromCents(toCents(numberOf(row.amount))),
      forma: row.method,
      obs: row.notes.trim(),
      recebido: row.received,
    })),
    pagamentos: [
      ...upsert
        .filter((row) => text(row.vendaId) === id)
        .map((row) => ({
          forma: text(row.forma),
          banco: text(row.banco),
          valor: amount(row.valor),
          obs: text(row.obs),
        })),
      ...order.locked
        .filter((row) => !upsert.some((item) => text(item.id) === row.id))
        .map((row) => ({ forma: row.method, banco: row.bank, valor: row.amount, obs: row.notes })),
    ],
    abatimentos: [
      ...previousCredits,
      ...balance.uses.map((use) =>
        use.kind === 'cheque'
          ? { tipo: 'cheque', num: use.ref, valor: fromCents(use.cents) }
          : { tipo: 'adiantamento', cod: use.ref, valor: fromCents(use.cents) },
      ),
    ],
    criadoEm: previous?.criadoEm ?? now,
    atualizadoEm: now,
    atualizadoPor: context.user,
  };
  if (!(sale.abatimentos as unknown[]).length) delete sale.abatimentos;
  if (!sale.ordemCompra) delete sale.ordemCompra;

  const before = previous && Array.isArray(previous.pesagens) ? previous.pesagens.map(text) : [];
  return {
    sale,
    upsertReceivables: upsert,
    removeReceivables,
    creditUses,
    bankMovements,
    linkWeighings: order.weighings.filter((key) => !before.includes(key)),
    unlinkWeighings: before.filter((key) => !order.weighings.includes(key)),
  };
}
