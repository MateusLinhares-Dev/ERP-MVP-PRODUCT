import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const helpers = core.slice(core.indexOf('function _vendaR2('), core.indexOf('function _vendaGravarPedido(cmd){'));

function context(state = {}) {
  const ctx = { ADT_CLI: {}, CHEQUES_CLI: {}, CONTAS_RECEBER: [], ...state };
  runInNewContext(helpers, ctx);
  return ctx;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('adiantamento maior que a venda: usa só o saldo e o resto continua disponível', () => {
  const advance = { cod: 'ADTC000001', data: '01/11/2026', valor: 10000, status: 'Pendente' };
  const ctx = context({ ADT_CLI: { GERDAU: [advance] } });
  const plan = ctx._vendaPlanejarAbatimentos(3000, [advance], []);
  assert.equal(plan.erro, undefined);
  assert.deepEqual(plain(plan.usos.map((u) => [u.tipo, u.valor])), [['adiantamento', 3000]]);
  ctx._vendaAplicarAbatimentos(plan.usos, 'NF-1');
  assert.equal(advance.status, 'Pendente');
  assert.equal(advance.valor, 7000);
  assert.equal(advance.valorOriginal, 10000);
  assert.deepEqual(plain(advance.usos), [{ venda: 'NF-1', valor: 3000 }]);
});

test('cheque não pode ser usado em parte; cheques entram antes dos adiantamentos', () => {
  const ctx = context();
  const cheque = { num: '850220', valor: 5000 };
  assert.match(ctx._vendaPlanejarAbatimentos(3000, [], [cheque]).erro, /cheque nº 850220 .* maior que o saldo .* não pode ser usado em parte/i);
  const small = { num: '3126', valor: 2000 };
  const advance = { cod: 'ADTC000002', valor: 10000, status: 'Pendente' };
  const plan = ctx._vendaPlanejarAbatimentos(3000, [advance], [small]);
  assert.deepEqual(plain(plan.usos.map((u) => [u.tipo, u.valor])), [['cheque', 2000], ['adiantamento', 1000]]);
  assert.equal(plan.resta, 0);
  assert.match(ctx._vendaPlanejarAbatimentos(2000, [advance], [small]).erro, /já está coberto/);
});

test('uso integral quita o adiantamento sem perder o valor usado', () => {
  const advance = { cod: 'ADTC000003', valor: 3000, status: 'Pendente' };
  const ctx = context();
  const plan = ctx._vendaPlanejarAbatimentos(5000, [advance], []);
  ctx._vendaAplicarAbatimentos(plan.usos, 'VD-1');
  assert.equal(advance.status, 'Quitado');
  assert.equal(advance.valor, 3000);
  assert.deepEqual(plain(ctx._vendaRegistroAbatimentos(plan.usos)), [{ tipo: 'adiantamento', cod: 'ADTC000003', valor: 3000 }]);
});

test('excluir venda devolve o adiantamento usado em parte e o cheque', () => {
  const advance = { cod: 'ADTC000004', valor: 7000, valorOriginal: 10000, status: 'Pendente', usos: [{ venda: 'NF-9', valor: 3000 }], vinculo: 'NF-9' };
  const cheque = { num: '3126', valor: 2000, status: 'Quitado', vinculo: 'NF-9' };
  const ctx = context({ ADT_CLI: { GERDAU: [advance] }, CHEQUES_CLI: { GERDAU: [cheque] } });
  const sale = { id: 'VD-9', nf: 'NF-9', cliente: 'GERDAU', abatimentos: [{ tipo: 'cheque', num: '3126', valor: 2000 }, { tipo: 'adiantamento', cod: 'ADTC000004', valor: 3000 }] };
  assert.equal(ctx._vendaRestaurarAbatimentos(sale), 2);
  assert.equal(advance.valor, 10000);
  assert.equal(advance.status, 'Pendente');
  assert.deepEqual(plain(advance.usos), []);
  assert.equal(advance.vinculo, '');
  assert.equal(cheque.status, 'Pendente');
});

test('venda antiga (sem registro de abatimentos) devolve pelo que ficou em Contas a Receber', () => {
  const advance = { cod: 'ADTC123456', valor: 4000, status: 'Quitado' };
  const cheque = { num: '777', valor: 900, status: 'Quitado' };
  const otherSaleCheque = { num: '888', valor: 100, status: 'Quitado' };
  const ctx = context({
    ADT_CLI: { TUPY: [advance] },
    CHEQUES_CLI: { TUPY: [cheque, otherSaleCheque] },
    CONTAS_RECEBER: [
      { vendaId: 'VD-OLD', forma: 'Adiantamento', valor: 4000, obs: 'Adiantamento ADTC123456 — 99' },
      { vendaId: 'VD-OLD', forma: 'Cheque', valor: 900, obs: 'Abatido na venda 99 — cheque 777' },
      { vendaId: 'VD-OUTRA', forma: 'Cheque', valor: 100, obs: 'Cheque nº 888' },
    ],
  });
  assert.equal(ctx._vendaRestaurarAbatimentos({ id: 'VD-OLD', nf: '99', cliente: 'TUPY' }), 2);
  assert.equal(advance.status, 'Pendente');
  assert.equal(advance.valor, 4000);
  assert.equal(cheque.status, 'Pendente');
  assert.equal(otherSaleCheque.status, 'Quitado', 'cheque de outra venda não é mexido');
});

test('pedido de venda (tela React) grava pela regra única de abatimentos e exclui pelo código', () => {
  const save = core.slice(core.indexOf('function _vendaGravarPedido(cmd){'), core.indexOf('function _vendaExcluirPorId('));
  assert.match(save, /const usos=_vendaUsosDoPedido\(/);
  assert.match(save, /_vendaAplicarAbatimentos\(usos, venda\.nf\|\|venda\.id\)/);
  assert.ok(save.indexOf('_vendaUsosDoPedido(') < save.indexOf('VENDAS_DB.push(venda)'), 'confere os abatimentos antes de mudar qualquer dado');
  const remove = core.slice(core.indexOf('function excluirVenda(btnOrIdx){'), core.indexOf("window['excluirVenda']=excluirVenda;"));
  assert.match(remove, /_vendaRestaurarAbatimentos\(v\)/);
  assert.match(remove, /VENDAS_DB\.findIndex\(function\(x\)\{ return x&&x\.id===vid; \}\)/, 'exclui pelo código da venda, não pela posição');
  assert.match(remove, /var matchByData=!cr\.vendaId&&/, 'não apaga contas a receber de outra venda');
  assert.doesNotMatch(core, /function salvarVenda\(|function salvarEditVenda\(|function buildVendaForm\(/, 'formulário antigo saiu');
});

test('abatimento que mudou desde que a tela abriu não é usado (cheque quitado, adiantamento menor)', () => {
  const ctx = context({
    ADT_CLI: { GERDAU: [{ cod: 'ADTC1', valor: 500, status: 'Pendente' }] },
    CHEQUES_CLI: { GERDAU: [{ num: '10', valor: 300, status: 'Quitado' }, { num: '11', valor: 200, status: 'Pendente' }] },
  });
  runInNewContext(core.slice(core.indexOf('function _vendaUsosDoPedido('), core.indexOf('function _vendaGravarPedido(cmd){')), ctx);
  assert.throws(() => ctx._vendaUsosDoPedido('GERDAU', [{ kind: 'cheque', ref: '10', amount: 300 }]), /cheque nº 10 não está mais disponível/);
  assert.throws(() => ctx._vendaUsosDoPedido('GERDAU', [{ kind: 'advance', ref: 'ADTC1', amount: 600 }]), /adiantamento ADTC1 mudou/);
  const usos = ctx._vendaUsosDoPedido('GERDAU', [{ kind: 'cheque', ref: '11', amount: 200 }, { kind: 'advance', ref: 'ADTC1', amount: 120.005 }]);
  assert.deepEqual(plain(usos.map((u) => [u.tipo, u.valor])), [['cheque', 200], ['adiantamento', 120.01]]);
});
