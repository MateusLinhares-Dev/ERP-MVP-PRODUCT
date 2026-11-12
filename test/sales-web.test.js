import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCondition, splitPlan } from '../server/modules/sales/domain/installments.ts';
import {
  clientCredits,
  filterSales,
  pendingWeighings,
  planCredits,
  saleRows,
  salesKpis,
  EMPTY_FILTER,
  splitWeighings,
} from '../server/modules/sales/domain/sales.ts';
import {
  addInstallment,
  addWeighing,
  balanceInstallments,
  blankOrder,
  buildCommit,
  creditKey,
  generateInstallments,
  nextSaleNumber,
  orderBalance,
  orderFromSale,
  orderTotals,
  removeWeighing,
  stockIssues,
  validateOrder,
} from '../server/modules/sales/domain/sale-order.ts';

const TODAY = '2026-11-12';
let counter = 0;
const context = (data, credits = [], extra = {}) => ({
  data,
  credits,
  banks: [{ cod: 'B1', banco: 'Sicredi' }],
  today: TODAY,
  now: 1000,
  user: 'elaine',
  newId: (prefix) => prefix + ++counter,
  ...extra,
});
const emptyData = () => ({ sales: [], receivables: [], clientAdvances: {}, clientCheques: {}, tickets: {} });
const withItems = (order, items) => ({
  ...order,
  items: items.map(([material, quantity, price], index) => ({ ...order.items[0], key: 'k' + index, material, quantity, price })),
});

test('condição de pagamento: à vista, 3x e dias; divide em centavos com o resto na última', () => {
  assert.deepEqual(parseCondition('à vista'), { kind: 'days', days: [0] });
  assert.deepEqual(parseCondition('3x'), { kind: 'count', count: 3 });
  assert.deepEqual(parseCondition('0 30 60 dias'), { kind: 'days', days: [0, 30, 60] });
  assert.equal(parseCondition('trinta'), null);
  assert.deepEqual(splitPlan({ kind: 'days', days: [0, 30] }, 10001, '2026-11-12', '2026-11-12'), [
    { dueDate: '2026-11-12', cents: 5000 },
    { dueDate: '2026-12-12', cents: 5001 },
  ]);
});

test('totais: soma das linhas em centavos, desconto e frete; parcela única acompanha o saldo', () => {
  let order = withItems(blankOrder(TODAY, 'GERDAU'), [['COBRE MEL', '100,5', '45,33'], ['FERRO', '1.000', '1,1'], ['', '', '']]);
  order = { ...order, discount: '10', freight: '25,5' };
  const totals = orderTotals(order);
  assert.equal(totals.itemCount, 2);
  assert.equal(totals.products, 4555.67 + 1100);
  assert.equal(totals.total, 5671.17);
  order = balanceInstallments(order, []);
  assert.equal(order.installments.length, 1);
  assert.equal(order.installments[0].amount, '5671,17');
  assert.equal(order.installments[0].dueDate, TODAY);
  assert.equal(validateOrder(order, []), '');
});

test('parcelas: gerar 0 30 60, adicionar parcela divide a última e a soma precisa bater', () => {
  let order = balanceInstallments(withItems(blankOrder(TODAY, 'X'), [['FERRO', '1000', '1']]), []);
  order = generateInstallments({ ...order, condition: '0 30 60' }, []).order;
  assert.deepEqual(order.installments.map((row) => [row.dueDate, row.amount]), [
    ['2026-11-12', '333,33'],
    ['2026-12-12', '333,33'],
    ['2027-01-11', '333,34'],
  ]);
  order = addInstallment(order).order;
  assert.equal(order.installments.length, 4);
  order = balanceInstallments(order, []);
  assert.equal(order.installments[3].amount, '166,67');
  const broken = { ...order, installments: order.installments.map((row, i) => (i === 0 ? { ...row, amount: '900' } : row)) };
  assert.match(validateOrder(balanceInstallments(broken, []), []), /passa do saldo/);
  assert.match(generateInstallments({ ...order, condition: 'xyz' }, []).error, /Condição inválida/);
});

test('validação: cliente, material na linha com peso, recebido sem forma e "A prazo" recebido', () => {
  const base = withItems(blankOrder(TODAY, ''), [['FERRO', '10', '2']]);
  assert.equal(validateOrder(base, []), 'Informe o cliente.');
  const noMaterial = withItems(blankOrder(TODAY, 'X'), [['', '10', '2']]);
  assert.equal(validateOrder(noMaterial, []), 'Escolha o material da linha 1.');
  assert.equal(validateOrder(withItems(blankOrder(TODAY, 'X'), [['FERRO', '', '']]), []), 'Adicione pelo menos um item com quantidade.');
  assert.equal(validateOrder(withItems(blankOrder(TODAY, 'X'), [['FERRO', '10', '2'], ['COBRE', '5', '']]), []), 'Informe o preço da linha 2 (COBRE).');
  let order = balanceInstallments({ ...base, client: 'X' }, []);
  order = { ...order, installments: [{ ...order.installments[0], received: true }] };
  assert.match(validateOrder(order, []), /forma de recebimento da parcela 1/);
  order = { ...order, installments: [{ ...order.installments[0], method: 'A prazo' }] };
  assert.match(validateOrder(order, []), /A prazo/);
});

test('abatimentos: cheques antes e inteiros, adiantamento usa só o que falta', () => {
  const data = {
    ...emptyData(),
    clientAdvances: { GERDAU: [{ cod: 'ADTC1', data: '01/11/2026', valor: 10000, status: 'Pendente' }, { cod: 'ADTC2', valor: 50, status: 'Quitado' }] },
    clientCheques: { GERDAU: [{ num: '850', valor: 2000, status: 'Pendente', bomPara: '20/11/2026' }, { num: '900', valor: 5, status: 'Compensado' }] },
  };
  const credits = clientCredits(data, 'GERDAU');
  assert.deepEqual(credits.map(creditKey), ['cheque:850', 'advance:ADTC1']);
  assert.deepEqual(planCredits(300000, credits).uses.map((use) => [use.kind, use.cents]), [['cheque', 200000], ['advance', 100000]]);
  assert.match(planCredits(100000, credits).error, /cheque nº 850 .* não pode ser usado em parte/);
  let order = withItems(blankOrder(TODAY, 'GERDAU'), [['COBRE', '100', '30']]);
  order = balanceInstallments({ ...order, credits: ['cheque:850', 'advance:ADTC1'] }, credits);
  const balance = orderBalance(order, credits);
  assert.equal(balance.creditCents, 300000);
  assert.equal(balance.balanceCents, 0);
  assert.equal(order.installments.length, 0);
  assert.equal(validateOrder(order, credits), '');
});

test('salvar venda nova: conta a receber por parcela, abatimento recebido, banco só quando recebido', () => {
  counter = 0;
  const data = { ...emptyData(), clientAdvances: { TUPY: [{ cod: 'ADTC9', valor: 100, status: 'Pendente', bancoNome: 'Itaú' }] } };
  const credits = clientCredits(data, 'TUPY');
  let order = withItems(blankOrder('2026-11-10', 'TUPY'), [['FERRO', '1000', '1']]);
  order = { ...order, number: '', notes: ' carga 1 ', credits: ['advance:ADTC9'], condition: '0 30' };
  order = generateInstallments(balanceInstallments(order, credits), credits).order;
  order = { ...order, installments: order.installments.map((row, i) => (i === 0 ? { ...row, method: 'PIX', bank: 'B1', received: true } : { ...row, method: 'Boleto' })) };
  assert.equal(validateOrder(order, credits), '');
  const commit = buildCommit(order, context(data, credits));
  assert.equal(commit.sale.id, 'VD-1');
  assert.equal(commit.sale.nf, 'V0001');
  assert.equal(commit.sale.data, '10/11/2026');
  assert.equal(commit.sale.total, 1000);
  assert.equal(commit.sale.status, 'A prazo');
  assert.equal(commit.sale.venc, '10/12/2026');
  assert.equal(commit.sale.obs, 'carga 1');
  assert.deepEqual(commit.sale.abatimentos, [{ tipo: 'adiantamento', cod: 'ADTC9', valor: 100 }]);
  assert.deepEqual(commit.upsertReceivables.map((row) => [row.forma, row.valor, row.status, row.venc, row.banco]), [
    ['Adiantamento', 100, 'Recebido', '10/11/2026', 'Itaú'],
    ['PIX', 450, 'Recebido', '10/11/2026', 'Sicredi'],
    ['Boleto', 450, 'Pendente', '10/12/2026', '—'],
  ]);
  assert.ok(commit.upsertReceivables.every((row) => row.vendaId === 'VD-1' && row.cli === 'TUPY'));
  assert.deepEqual(commit.creditUses, [{ kind: 'advance', ref: 'ADTC9', amount: 100 }]);
  assert.deepEqual(commit.bankMovements, [{ bank: 'B1', date: '2026-11-10', description: 'Recebto Venda: TUPY NF V0001', amount: 450, receivableId: 'CR3' }]);
  assert.equal(nextSaleNumber([{ nf: 'V0009' }, { nf: 'NF12' }, { nf: 'v0011' }]), 'V0012');
});

test('editar venda: recebidos ficam travados, pendentes viram parcelas, sobra vira remoção', () => {
  counter = 100;
  const data = {
    ...emptyData(),
    sales: [{ id: 'VD-5', nf: '77', data: '01/11/2026', cliente: 'TUPY', itens: [{ mat: 'FERRO', qt: 1000, pr: 1, total: 1000 }], total: 1000, status: 'Pendente', acrescimos: [], extraCampo: 'mantém' }],
    receivables: [
      { id: 'CR1', vendaId: 'VD-5', valor: 400, status: 'Recebido', forma: 'PIX', dataReceb: '02/11/2026', nf: '77' },
      { id: 'CR2', vendaId: 'VD-5', valor: 300, status: 'Pendente', forma: 'Boleto', venc: '01/12/2026' },
      { id: 'CR3', vendaId: 'VD-5', valor: 300, status: 'Pendente', forma: 'Boleto', venc: '01/01/2027' },
      { id: 'OUTRA', vendaId: 'VD-6', valor: 1, status: 'Pendente' },
    ],
  };
  let order = orderFromSale(data, data.sales[0], TODAY);
  assert.equal(order.lockedClient, true);
  assert.deepEqual(order.locked.map((row) => [row.id, row.amount]), [['CR1', 400]]);
  assert.deepEqual(order.installments.map((row) => [row.receivableId, row.amount, row.dueDate]), [
    ['CR2', '300', '2026-12-01'],
    ['CR3', '300', '2027-01-01'],
  ]);
  order = withItems(order, [['FERRO', '1200', '1']]);
  order = { ...order, installments: [order.installments[0]] };
  order = balanceInstallments(order, []);
  assert.equal(order.installments[0].amount, '800');
  const commit = buildCommit(order, context(data, []));
  assert.equal(commit.sale.id, 'VD-5');
  assert.equal(commit.sale.extraCampo, 'mantém');
  assert.equal(commit.sale.total, 1200);
  assert.deepEqual(commit.removeReceivables, ['CR3']);
  assert.deepEqual(commit.upsertReceivables.map((row) => [row.id, row.valor, row.status]), [['CR2', 800, 'Pendente']]);
  assert.equal(commit.bankMovements.length, 0);
  const shrink = balanceInstallments(withItems(order, [['FERRO', '300', '1']]), []);
  assert.match(validateOrder(shrink, []), /menor do que já foi recebido/);
});

test('venda antiga marcada como paga sem contas a receber conta como recebida', () => {
  const data = { ...emptyData(), sales: [{ id: 'VD-1', cliente: 'A', data: '01/10/2026', total: 500, status: 'Pago', itens: [{ mat: 'FERRO', qt: 10, pr: 50 }] }] };
  const order = orderFromSale(data, data.sales[0], TODAY);
  assert.equal(order.locked[0].amount, 500);
  assert.equal(orderBalance(order, []).balanceCents, 0);
  const [row] = saleRows(data, TODAY);
  assert.equal(row.settled, true);
  assert.equal(row.received, 500);
});

test('histórico e indicadores: situação pelas contas a receber, atraso e filtros', () => {
  const data = {
    ...emptyData(),
    sales: [
      { id: 'VD-1', nf: 'V0001', data: '05/11/2026', cliente: 'JOÃO SUCATAS', itens: [{ mat: 'COBRE', qt: 10 }], total: 100, status: 'Pendente' },
      { id: 'VD-2', nf: 'V0002', data: '20/10/2026', cliente: 'GERDAU', itens: [{ mat: 'FERRO', qt: 1000 }], total: 900, status: 'Pendente' },
      { id: 'VD-3', data: '2026-11-11', cliente: 'TUPY', itens: [], total: 50, status: 'Pago' },
    ],
    receivables: [
      { id: 'a', vendaId: 'VD-1', valor: 100, status: 'Recebido' },
      { id: 'b', vendaId: 'VD-2', valor: 900, status: 'Pendente', venc: '30/10/2026' },
    ],
  };
  const rows = saleRows(data, TODAY);
  assert.deepEqual(rows.map((row) => [row.id, row.status, row.overdue]), [
    ['VD-3', 'Pago', false],
    ['VD-1', 'Pago', false],
    ['VD-2', 'Pendente', true],
  ]);
  const kpis = salesKpis(rows, TODAY);
  assert.equal(kpis.total, 1050);
  assert.equal(kpis.month, 150);
  assert.equal(kpis.pending, 900);
  assert.equal(kpis.overdue, 900);
  assert.deepEqual(filterSales(rows, { ...EMPTY_FILTER, client: 'joao' }).map((row) => row.id), ['VD-1']);
  assert.deepEqual(filterSales(rows, { ...EMPTY_FILTER, status: 'pendente' }).map((row) => row.id), ['VD-2']);
  assert.deepEqual(filterSales(rows, { ...EMPTY_FILTER, from: '2026-11-01' }).map((row) => row.id), ['VD-3', 'VD-1']);
  assert.deepEqual(filterSales(rows, { ...EMPTY_FILTER, query: 'ferro' }).map((row) => row.id), ['VD-2']);
});

test('pesagens de saída: fila só com vendas finalizadas sem pedido; juntar e tirar pesagem do pedido', () => {
  const data = {
    ...emptyData(),
    tickets: {
      T10: { ticket: 'T10', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: true, status: 'Aguard. Preço', data: '2026-11-11', pesagens: [{ material: 'FERRO', pesoLiquido: 8000 }, { material: 'COBRE', pesoLiquido: 120.5 }] },
      T11: { ticket: 'T11', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: true, status: 'Aguard. Preço', vendaId: 'VD-1', pesagens: [] },
      T12: { ticket: 'T12', tipo: 'compra', _balFinalizado: true, status: 'Aguard. Preço' },
      T13: { ticket: 'T13', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: false, status: 'Pesando Materiais' },
      T14: { ticket: 'T14', tipo: 'venda', cliente: 'TUPY', _balFinalizado: true, status: 'Aguard. Preço', vendaArquivada: true, pesagens: [{ material: 'FERRO', pesoLiquido: 1 }] },
      T15: { ticket: 'T15', tipo: 'venda', cliente: 'TUPY', _balFinalizado: true, status: 'Aguard. Preço', data: '2026-09-01', pesagens: [{ material: 'FERRO', pesoLiquido: 10 }] },
    },
  };
  const all = pendingWeighings(data);
  assert.deepEqual(all.map((row) => row.key), ['T10', 'T15']);
  const split = splitWeighings(all, TODAY);
  assert.deepEqual([split.recent.map((row) => row.key), split.old.map((row) => row.key)], [['T10'], ['T15']]);
  const queue = split.recent;
  assert.deepEqual(queue.map((row) => [row.key, row.kg]), [['T10', 8120.5]]);
  let order = addWeighing(blankOrder(TODAY), data, 'T10');
  assert.equal(order.client, 'GERDAU');
  assert.deepEqual(order.items.map((item) => [item.material, item.quantity, item.weighing]), [
    ['FERRO', '8000', 'T10'],
    ['COBRE', '120,5', 'T10'],
  ]);
  const commit = buildCommit(balanceInstallments(withItems(order, [['FERRO', '8000', '1']]), []), context(data));
  assert.deepEqual(commit.linkWeighings, ['T10']);
  order = removeWeighing(order, 'T10');
  assert.deepEqual(order.weighings, []);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].material, '');
});

test('estoque: soma o mesmo material em linhas diferentes e avisa quando passa do disponível', () => {
  const order = withItems(blankOrder(TODAY, 'X'), [['Ferro', '600', '1'], ['FERRO', '500', '1'], ['COBRE', '5', '1']]);
  const stock = { FERRO: 1000, COBRE: 10 };
  assert.deepEqual(stockIssues(order, (mat) => stock[mat.toUpperCase()] ?? null), [
    { material: 'Ferro', requested: 1100, available: 1000 },
  ]);
});

test('venda antiga sem vínculo nas contas a receber: acha pelo cliente, data e valor e liga ao salvar (sem duplicar)', () => {
  counter = 500;
  const data = {
    ...emptyData(),
    sales: [{ id: 'VD-ANTIGA', nf: '12', data: '01/09/2026', cliente: 'TUPY', itens: [{ mat: 'FERRO', qt: 100, pr: 3, total: 300 }], total: 300, status: 'Pendente' }],
    receivables: [
      { id: 'CRA', cli: 'TUPY', data: '01/09/2026', valor: 300, status: 'Pendente', forma: '—', venc: '01/10/2026' },
      { id: 'CRB', cli: 'TUPY', data: '01/09/2026', valor: 999, status: 'Pendente' },
    ],
  };
  let order = orderFromSale(data, data.sales[0], TODAY);
  assert.deepEqual(order.installments.map((row) => [row.receivableId, row.amount]), [['CRA', '300']]);
  assert.equal(saleRows(data, TODAY)[0].overdue, true);
  order = balanceInstallments(order, []);
  const commit = buildCommit(order, context(data, []));
  assert.deepEqual(commit.upsertReceivables.map((row) => [row.id, row.vendaId, row.valor]), [['CRA', 'VD-ANTIGA', 300]]);
  assert.deepEqual(commit.removeReceivables, []);
});

test('recebimento com banco leva o código da conta a receber para ligar o lançamento do banco', () => {
  counter = 700;
  let order = balanceInstallments(withItems(blankOrder(TODAY, 'X'), [['FERRO', '10', '10']]), []);
  order = { ...order, installments: [{ ...order.installments[0], method: 'PIX', bank: 'B1', received: true }] };
  const commit = buildCommit(order, context(emptyData()));
  const receivable = commit.upsertReceivables[0];
  assert.equal(commit.bankMovements.length, 1);
  assert.equal(commit.bankMovements[0].receivableId, receivable.id);
  assert.equal(receivable.bancoCod, 'B1');
  assert.equal(receivable.banco, 'Sicredi');
});
