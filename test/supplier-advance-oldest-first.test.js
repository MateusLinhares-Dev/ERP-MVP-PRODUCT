import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/modules/purchase-order/purchase-order.js', import.meta.url), 'utf8');
const piece = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function plan(db) {
  const code = piece('function isoDay(', 'global.erpSupplierAdvancePlan=') + piece('function money(', 'function qty(') + piece('function dateBR(', 'function daysBetween(');
  const ctx = { ...db, tickets: () => db.TICKETS_DB };
  runInNewContext(code + ';this.plan=supplierAdvancePlan;this.older=olderOpenLines;this.message=oldestFirstMessage;', ctx);
  return ctx;
}

const sergio = () => ({
  TICKETS_DB: {
    T715: { ticket: 'T715', fornecedorCod: 'F1', data: '2026-11-19' },
    T259: { ticket: 'T259', fornecedorCod: 'F1', data: '2026-11-17' },
    T900: { ticket: 'T900', fornecedorCod: 'F2', data: '2026-11-01' },
  },
  CONTAS_PAGAR: [
    { id: 'CPPO_T715_1', ticket: 'T715', fornCod: 'F1', valor: 103573.25, status: 'Pendente' },
    { id: 'CPPO_T259_1', ticket: 'T259', fornCod: 'F1', valor: 29963.4, status: 'Pendente' },
    { id: 'CPPO_T900_1', ticket: 'T900', fornCod: 'F2', valor: 50, status: 'Pendente' },
    { id: 'CP-DESP', fornCod: 'F1', valor: 10, status: 'Pendente', origem: 'despesa' },
  ],
  ADT_POR_FORN: { F1: [
    { cod: 'A19', data: '19/11/2026', valor: 32000, status: 'Pendente' },
    { cod: 'A17', data: '17/11/2026', valor: 99990.8, status: 'Pendente' },
    { cod: 'Q', data: '10/11/2026', valor: 500, status: 'Quitado' },
  ] },
});

test('Sergio Spader: compra mais antiga primeiro; T259 quitada e T715 com R$ 1.545,85; conta de despesa e outro fornecedor ficam de fora', () => {
  const ctx = plan(sergio());
  const result = JSON.parse(JSON.stringify(ctx.plan('F1')));
  assert.deepEqual(result.lines.map((l) => [l.label, l.date, l.open, l.use]), [
    ['Pedido T259', '2026-11-17', 29963.4, 29963.4],
    ['Pedido T715', '2026-11-19', 103573.25, 102027.4],
  ]);
  assert.equal(result.free, 131990.8);
  assert.equal(result.used, 131990.8);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.older(ctx.plan('F1'), 'T715'))).map((l) => l.label), ['Pedido T259']);
  assert.equal(ctx.older(ctx.plan('F1'), 'T259').length, 0);
  assert.match(ctx.message('SERGIO', ctx.plan('F1')), /Pedido T715 \(19\/11\/2026\): abate R\$ 102\.027,40 e fica R\$ 1\.545,85 a pagar/);
});

test('adiantamento ligado a um pedido só vale para ele e vai primeiro nele; saldo inicial entra pela data; parcelas aparecem com o vencimento', () => {
  const db = sergio();
  db.ADT_POR_FORN.F1 = [
    { cod: 'LIVRE', data: '01/11/2026', valor: 1000, status: 'Pendente' },
    { cod: 'DO715', data: '18/11/2026', valor: 400, status: 'Pendente', ticket: 'T715' },
  ];
  db.CONTAS_PAGAR = [
    { id: 'SI', fornCod: 'F1', valor: 300, status: 'Pendente', origem: 'compra_antiga', data: '2026-10-01' },
    { id: 'CPPO_T715_2', ticket: 'T715', fornCod: 'F1', valor: 500, status: 'Pendente', venc: '2026-12-19' },
    { id: 'CPPO_T715_1', ticket: 'T715', fornCod: 'F1', valor: 500, status: 'Pendente', venc: '2026-11-19' },
    { id: 'CPPO_T259_1', ticket: 'T259', fornCod: 'F1', valor: 900, status: 'Pago' },
  ];
  const ctx = plan(db);
  const result = JSON.parse(JSON.stringify(ctx.plan('F1')));
  assert.deepEqual(result.lines.map((l) => [l.label, l.use]), [
    ['Saldo inicial', 300],
    ['Pedido T715 (parcela de 19/11/2026)', 500],
    ['Pedido T715 (parcela de 19/12/2026)', 500],
  ]);
  assert.equal(result.used, 1300);
});
