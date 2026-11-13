import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receivableRows } from '../web/modules/receivables/domain/receivables.ts';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');

test('Contas a Receber ordena e marca atraso pela data (dd/mm/aaaa vira aaaa-mm-dd), sem quebrar sem vencimento', () => {
  const rows = receivableRows(
    [
      { id: 'A', cli: 'B', valor: 1, status: 'Pendente', venc: '05/12/2026' },
      { id: 'B', cli: 'A', valor: 1, status: 'Pendente', venc: '10/11/2026' },
      { id: 'C', cli: 'C', valor: 1, status: 'Pendente' },
      { id: 'D', cli: 'D', valor: 1, status: 'Recebido', venc: '01/11/2026' },
    ],
    '2026-11-13',
  );
  assert.deepEqual(rows.map((row) => row.id), ['D', 'B', 'A', 'C']);
  assert.deepEqual(rows.map((row) => row.overdue), [false, true, false, false]);
});

test('pagamento avulso da Ficha e vendas (Pago, Reabrir, Excluir) passam pelo servidor', () => {
  for (const [name, action] of [['fcSalvarPagamento', 'create']]) {
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
