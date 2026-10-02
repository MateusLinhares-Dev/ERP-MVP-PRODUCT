import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');

test('v12 rodoviaria venda recovers CLIENTES after F5 without creating parallel data',()=>{
  assert.match(core,/function rodGarantirClientesDisponiveis\(\)/);
  assert.match(core,/__businessRepository\.read\('clientes'\)/);
  assert.match(core,/_syncClientes\.carregarDeRemoto\(remoto\|\|\{\}, true\)/);
  assert.match(core,/recarregarClientesDoBanco\(\)/);
  assert.doesNotMatch(core,/ROD_CLIENTES\s*=|CLIENTES_ROD\s*=/);
});

test('v12 switching to Venda triggers client hydration even if general cloud load is still pending',()=>{
  const start=core.indexOf('function rodTipoChange(tipo)');
  const end=core.indexOf('// Dispatcher inteligente para F3',start);
  const fn=core.slice(start,end);
  assert.match(fn,/rodPopularPessoaSelect\(\)/);
  assert.match(fn,/if\(tipo==='venda'\) rodGarantirClientesDisponiveis\(\)/);
});
