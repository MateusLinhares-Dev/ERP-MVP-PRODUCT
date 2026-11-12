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

test('Contas a Receber e vendas (Pago, Reabrir, Excluir) passam pelo servidor', () => {
  for (const [name, action] of [['salvarContaReceber', 'create'], ['salvarEditContaReceber', 'update'], ['confirmarReceberCR', 'receive'], ['estornarContaReceber', 'reopen'], ['excluirContaReceber', 'delete'], ['fcSalvarPagamento', 'create']]) {
    const start = core.indexOf('async function ' + name + '(');
    assert.ok(start > 0, name);
    assert.match(core.slice(start, core.indexOf('\nfunction ', start + 10) > 0 ? core.indexOf('\nfunction ', start + 10) : start + 3000), new RegExp("_crApi\\(\\{action:'" + action + "'"), name);
  }
  assert.doesNotMatch(core, /CONTAS_RECEBER\.push\(\{/, 'nenhuma conta a receber é criada direto no navegador');
  for (const [name, action] of [['marcarVendaPaga', 'mark-paid'], ['reabrirVenda', 'reopen'], ['excluirVenda', 'delete']]) {
    const start = core.indexOf('async function ' + name + '(');
    assert.ok(start > 0, name);
    assert.match(core.slice(start, core.indexOf("window['" + name + "']", start)), new RegExp("_vendaApi\\(\\{action:'" + action + "'"), name);
  }
  assert.doesNotMatch(core, /function _vendaGravarPedido|function _vendaRestaurarAbatimentos|_syncVendas\.paraObjeto\(\)/);
});

test('listas de bancos continuam declaradas (um corte de código já as removeu por engano)', () => {
  for (const declaration of [
    /^let BANCOS_DB = \[\];$/m,
    /^const _syncBancos = _criarSincroniaPorChave\('bancos'/m,
    /^let LANC_BANCO_DB = \[\];/m,
    /^const _syncLancBanco = _criarSincroniaPorChave\('lancBanco'/m,
    /^let CONTAS_RECEBER = \[\];$/m,
    /^let VENDAS_DB = \[\];$/m,
  ])
    assert.match(core, declaration);
});
