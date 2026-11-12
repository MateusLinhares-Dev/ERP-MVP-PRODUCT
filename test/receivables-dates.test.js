import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const start = core.indexOf('function renderContasReceber(){');
const render = core.slice(start, core.indexOf('\nfunction ', start + 10));

test('Contas a Receber ordena e marca atraso pela data (dd/mm/aaaa vira aaaa-mm-dd), sem quebrar sem vencimento', () => {
  assert.match(render, /sort\(\(a,b\)=>_toISOcr\(a\.venc\)\.localeCompare\(_toISOcr\(b\.venc\)\)\)/);
  assert.match(render, /const atrasado=c\.status==='Pendente'&&Boolean\(_vencISO\)&&_vencISO<hoje;/);
  assert.doesNotMatch(render, /a\.venc\.localeCompare|c\.venc<hoje/);
});

test('recebimento com banco guarda o lançamento do banco; Pago, Reabrir e Excluir venda passam pelo servidor', () => {
  assert.match(core, /const mov=registrarMovBanco\(banco, data, 'Recebto: '[\s\S]{0,140}c\.movBancoId=mov\.id/);
  for (const [name, action] of [['marcarVendaPaga', 'mark-paid'], ['reabrirVenda', 'reopen'], ['excluirVenda', 'delete']]) {
    const start = core.indexOf('async function ' + name + '(');
    assert.ok(start > 0, name);
    assert.match(core.slice(start, core.indexOf("window['" + name + "']", start)), new RegExp("_vendaApi\\(\\{action:'" + action + "'"), name);
  }
  assert.doesNotMatch(core, /function _vendaGravarPedido|function _vendaRestaurarAbatimentos|_syncVendas\.paraObjeto\(\)/);
});
