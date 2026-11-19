import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { emptyFilter, hiddenByStatus } from '../web/modules/payables/domain/payables.ts';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../public/modules/finance/advance-actions.js', import.meta.url), 'utf8');
const slice = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};

test('acha as compensações de um adiantamento (pelo código ou pela parte usada) e de uma compra; desfaz do último para o primeiro', async () => {
  const code = slice(core, 'function _pgtoLinhas(filtro){', 'window.erpPayablesOnlyPurchases=function(){');
  const calls = [];
  const window = { erpPayablesReverse: async (id, index) => { calls.push(id + '#' + index); return ''; } };
  const ctx = { window, CONTAS_PAGAR: [
    { id: 'CPPO_T449', ticket: 'T449', pagamentos: [
      { data: '2026-11-19', valor: 0, adt: 9915.45, adtUsos: [{ cod: 'ADT-A', valor: 9915.45, parcial: 'ADT-SPLIT' }] },
      { data: '2026-11-20', valor: 100, adt: 0 },
    ] },
    { id: 'CP-X', ticket: '', desc: 'Frete', pagamentos: [{ valor: 0, adt: 50, adtUsos: [{ cod: 'ADT-B', valor: 50 }] }] },
  ] };
  runInNewContext(code, ctx);
  const plain = (rows) => JSON.parse(JSON.stringify(rows));
  assert.deepEqual(plain(window.erpPaymentsOfAdvance('ADT-SPLIT')).map((r) => [r.payableId, r.index, r.share, r.amount]), [['CPPO_T449', 0, 9915.45, 9915.45]]);
  assert.deepEqual(plain(window.erpPaymentsOfAdvance('ADT-A')).map((r) => r.ticket), ['T449']);
  assert.equal(window.erpPaymentsOfAdvance('ADT-Z').length, 0);
  const purchase = window.erpPaymentsOfPurchase('T449');
  assert.deepEqual(plain(purchase).map((r) => [r.index, r.cash, r.advance]), [[0, 0, 9915.45], [1, 100, 0]]);
  assert.match(window.erpPaymentsSummary(purchase), /Pedido T449: compensação de adiantamento de R\$ 9\.915,45 em 19\/11\/2026\n• Pedido T449: pagamento de R\$ 100,00 em 20\/11\/2026/);
  assert.equal(await window.erpUndoPayments(purchase), '');
  assert.deepEqual(calls, ['CPPO_T449#1', 'CPPO_T449#0'], 'o índice dos pagamentos muda ao excluir: desfaz do último para o primeiro');
});

test('excluir adiantamento usado em conta oferece desfazer a compensação; excluir compra paga oferece desfazer e excluir', () => {
  assert.match(actions, /else if\(paid\.length\) undoPayments=paid;/);
  assert.match(actions, /if\(undoPayments\) return undoCompensationThenDelete\(supplierCode, advanceCode, button, undoPayments, record\);/);
  assert.match(actions, /Para excluí-lo, primeiro essa compensação precisa ser desfeita/);
  assert.match(actions, /troque o filtro "Em aberto" para "Todas"/);
  const remove = slice(core, 'async function excluirEntradaCompra(ticket,jaConfirmado){', 'function abrirBaixaCompraNoFinanceiro(');
  assert.match(remove, /window\.erpPaymentsOfPurchase\(String\(tk\.ticket\|\|id\)\)/);
  assert.match(remove, /return await excluirEntradaCompra\(id,true\);/);
  assert.match(remove, /if\(!jaConfirmado&&!confirm\('Excluir a compra '/);
});

test('Contas a Pagar: busca mostra quantas contas o filtro de situação escondeu', () => {
  const row = (id, paid, supplier) => ({ id, paid, overdue: false, kind: 'compra', due: '2026-11-19', company: '', category: '', bankName: '', amount: 10, supplier, description: '' });
  const rows = [row('A', false, 'ISMAEL'), row('B', true, 'ISMAEL'), row('C', true, 'OUTRO')];
  const filter = { ...emptyFilter('2026-11-19'), query: 'isma' };
  assert.deepEqual(hiddenByStatus(rows, filter).map((r) => r.id), ['B']);
  assert.deepEqual(hiddenByStatus(rows, { ...filter, query: '' }), [], 'sem busca não avisa');
  assert.deepEqual(hiddenByStatus(rows, { ...filter, status: 'todas' }), []);
});
