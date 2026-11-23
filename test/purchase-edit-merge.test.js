import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/modules/purchase-order/purchase-order.js', import.meta.url), 'utf8');
const piece = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const ctx = {};
runInNewContext(piece('function purchaseStableSnapshot(', 'function purchaseRememberServerAck(') + ';this.merge=purchaseMergeEdit;', ctx);
const merge = (...args) => JSON.parse(JSON.stringify(ctx.merge(...args)));

const base = {
  ticket: 'T787', fornecedorCod: 'F1', totalGeral: 45993.05, saldoPagar: 45993.05, status: 'Pendente', adiantamento: 0,
  itens: [{ mat: 'COBRE', quantidade: 100, preco: 459.9305, total: 45993.05 }],
  observacoesPedido: '', pedidoCompra: { observacoes: '', totalPedido: 45993.05 },
};

test('T787: observação digitada depois de uma compensação feita em outra tela é gravada sem desfazer a compensação', () => {
  const payload = { ...structuredClone(base), observacoesPedido: 'descontado adiantamento de 15.000,04\ndescontado adiantamento de 10.000,00',
    pedidoCompra: { observacoes: 'descontado adiantamento de 15.000,04\ndescontado adiantamento de 10.000,00', totalPedido: 45993.05 } };
  const current = { ...structuredClone(base), saldoPagar: 20993.01, status: 'Parcial' };
  const merged = merge(base, payload, current);
  assert.equal(merged.saldoPagar, 20993.01);
  assert.equal(merged.status, 'Parcial');
  assert.match(merged.observacoesPedido, /15\.000,04/);
  assert.match(merged.pedidoCompra.observacoes, /10\.000,00/);
});

test('edição que muda valor, ou campo que a outra tela também mudou, não é juntada (recusa e reabre)', () => {
  const current = { ...structuredClone(base), saldoPagar: 20993.01, status: 'Parcial' };
  assert.equal(ctx.merge(base, { ...structuredClone(base), totalGeral: 46000, saldoPagar: 46000 }, current), null);
  assert.equal(ctx.merge(base, { ...structuredClone(base), status: 'Pago' }, current), null);
  const other = { ...structuredClone(current), observacoesPedido: 'outra pessoa escreveu' };
  assert.equal(ctx.merge(base, { ...structuredClone(base), observacoesPedido: 'eu escrevi' }, other), null);
});

test('diferença de arredondamento no saldo não conta como mudança de valor', () => {
  const current = { ...structuredClone(base), saldoPagar: 20993.01, status: 'Parcial' };
  const merged = merge(base, { ...structuredClone(base), saldoPagar: 45993.049999, observacoesPedido: 'ok' }, current);
  assert.equal(merged.saldoPagar, 20993.01);
  assert.equal(merged.observacoesPedido, 'ok');
});
