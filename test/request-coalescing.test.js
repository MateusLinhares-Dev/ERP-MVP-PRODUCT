import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');

test('clique duplo: pedidos iguais ao servidor ao mesmo tempo viram um só; diferentes ou depois de terminar seguem normais', async () => {
  const start = core.indexOf('const _pedidosEmAndamento=new Map();');
  const code = core.slice(start, core.indexOf('function _fornApi(payload){', start));
  const ctx = { Map, Promise, JSON, Object };
  runInNewContext(code + ';this.unico=_pedidoUnico;', ctx);
  let sent = 0;
  const send = () => new Promise((resolve) => setTimeout(() => resolve(++sent), 20));
  const [a, b] = await Promise.all([
    ctx.unico('_cpApi', { action: 'create', valor: 1, operationId: 'x' }, send),
    ctx.unico('_cpApi', { action: 'create', valor: 1, operationId: 'y' }, send),
  ]);
  assert.equal(sent, 1);
  assert.equal(a, b);
  await Promise.all([ctx.unico('_cpApi', { valor: 1 }, send), ctx.unico('_cpApi', { valor: 2 }, send), ctx.unico('_vendaApi', { valor: 1 }, send)]);
  assert.equal(sent, 4);
  await ctx.unico('_cpApi', { valor: 1 }, send);
  assert.equal(sent, 5);
  await assert.rejects(ctx.unico('_cpApi', { valor: 9 }, () => Promise.reject(new Error('falhou'))), /falhou/);
  await ctx.unico('_cpApi', { valor: 9 }, send);
  assert.equal(sent, 6, 'depois de um erro o mesmo pedido pode ser tentado de novo');
});
