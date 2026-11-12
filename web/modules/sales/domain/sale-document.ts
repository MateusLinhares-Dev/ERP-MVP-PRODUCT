import { daysBetween, toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { formatAmount, formatQuantity } from '../../../shared/domain/money.js';
import type { OrderCompany, OrderDocument } from '../../../shared/print/order-print.js';
import { RECEIVED, amount, isRaw, itemQuantity, receivablesOf, saleRow, text } from './sales.js';
import type { Raw, SalesData } from './sales.js';

export function clientLines(client: Raw | null): string[] {
  if (!client) return [];
  const document = text(client.cnpj)
    ? 'CNPJ: ' + text(client.cnpj)
    : text(client.cpf)
      ? 'CPF: ' + text(client.cpf)
      : '';
  const address = [
    client.rua ?? client.logradouro,
    client.num ?? client.numero,
    client.bairro,
    client.cidade,
    client.uf,
  ]
    .map(text)
    .filter(Boolean)
    .join(', ');
  const contacts = [text(client.tel) || text(client.telefone) || text(client.wpp), text(client.email)].filter(
    Boolean,
  );
  return [document, address, ...contacts].filter(Boolean);
}

export function saleDocument(
  data: SalesData,
  sale: Raw,
  client: Raw | null,
  company: OrderCompany,
  today: string,
  issuedAt: string,
): OrderDocument {
  const row = saleRow(data, sale, today);
  const items = (Array.isArray(sale.itens) ? sale.itens.filter(isRaw) : []).map((item) => {
    const quantity = itemQuantity(item);
    const price = amount(item.pr ?? item.preco);
    return {
      name: text(item.mat) || text(item.matBase),
      description: text(item.descricao),
      quantity,
      price,
      total: item.total != null ? amount(item.total) : quantity * price,
    };
  });
  const products = amount(sale.subtotal) || items.reduce((sum, item) => sum + item.total, 0);
  const discount = amount(sale.desconto);
  const extras = amount(sale.acrescimo);
  const number = text(sale.nf) || row.id;
  const date = row.date;
  const linked = receivablesOf(data, row.id);
  const credits = linked.filter(
    (cr) => text(cr.status) === RECEIVED && /^(Adiantamento|Cheque)$/.test(text(cr.forma)),
  );
  const creditTotal = credits.reduce((sum, cr) => sum + amount(cr.valor), 0);
  const pending = linked.filter((cr) => text(cr.status) !== RECEIVED);
  const plan = (pending.length ? pending : []).map((cr) => {
    const due = toISODate(cr.venc) || date;
    return {
      days: String(Math.max(0, daysBetween(date, due))),
      date: toBRDate(due),
      value: amount(cr.valor),
      method: text(cr.forma).replace(/^[—-]$/, ''),
      notes: text(cr.obs),
    };
  });
  return {
    kind: 'Pedido de Venda',
    title: 'Pedido de venda Nº ' + number,
    company,
    party: { label: 'Cliente', name: text(sale.cliente), lines: clientLines(client) },
    meta: [
      ['Número do pedido', number],
      ...(text(sale.ordemCompra)
        ? ([['Ordem de compra do cliente', text(sale.ordemCompra)]] as Array<[string, string]>)
        : []),
      ['Data', toBRDate(date)],
      ['Situação', row.status],
      ...(Array.isArray(sale.pesagens) && sale.pesagens.length
        ? ([['Pesagens', sale.pesagens.map(text).join(', ')]] as Array<[string, string]>)
        : []),
    ],
    itemsTitle: 'Itens do pedido de venda',
    items,
    totals: [
      { label: 'Nº de itens', value: String(items.length) },
      { label: 'Soma das Qtdes', value: formatQuantity(items.reduce((sum, item) => sum + item.quantity, 0)) },
      { label: 'Total de produtos', value: 'R$ ' + formatAmount(products) },
      ...(discount > 0 ? [{ label: 'Desconto', value: '- R$ ' + formatAmount(discount) }] : []),
      ...(extras > 0 ? [{ label: 'Frete / acréscimos', value: 'R$ ' + formatAmount(extras) }] : []),
      { label: 'Total do pedido', value: 'R$ ' + formatAmount(row.total), grand: true },
    ],
    finance: {
      title: 'Situação financeira do pedido',
      rows: [
        { label: 'Total do pedido', value: 'R$ ' + formatAmount(row.total) },
        { label: 'Adiantamentos / cheques abatidos', value: 'R$ ' + formatAmount(creditTotal) },
        { label: 'Total recebido / abatido', value: 'R$ ' + formatAmount(row.received), tone: 'paid' },
        { label: 'Saldo a receber', value: 'R$ ' + formatAmount(row.pending), tone: 'due' },
      ],
    },
    installments: plan,
    notes: text(sale.obs),
    issuedAt,
  };
}
