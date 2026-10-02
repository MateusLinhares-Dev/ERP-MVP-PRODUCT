import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');

test('Rodoviaria +Novo abre Cliente em venda e Fornecedor em compra', () => {
  assert.match(core, /function rodAbrirCadastroRapido\(\)[\s\S]*?_rodTipoAtual[\s\S]*?==='venda'[\s\S]*?\? 'cliente' : 'fornecedor'/);
});

test('select generico de fornecedores nao sobrescreve o select da Rodoviaria', () => {
  const start = core.indexOf('function populateFornSelects()');
  const end = core.indexOf('function _fornBuscaResolverCod', start);
  assert.ok(start >= 0 && end > start);
  const block = core.slice(start, end);
  assert.doesNotMatch(block, /'rod-forn-sel'/);
});

test('Rodoviaria usa CLIENTES somente no modo venda e fornecedores no modo compra', () => {
  const start = core.indexOf('function rodPopularPessoaSelect()');
  const end = core.indexOf('let _rodClientesLoadPromise', start);
  assert.ok(start >= 0 && end > start);
  const block = core.slice(start, end);
  assert.match(block, /==='venda'[\s\S]*?CLIENTES/);
  assert.match(block, /else[\s\S]*?getFornAtivos\(\)/);
});

test('cadastro de cliente persiste no repositorio clientes', () => {
  assert.match(core, /function saveClientes\(\)[\s\S]*?upsertMany\('clientes'/);
  assert.match(core, /function salvarNovoCliente\(\)[\s\S]*?CLIENTES\.push[\s\S]*?saveClientes\(\)/);
});
