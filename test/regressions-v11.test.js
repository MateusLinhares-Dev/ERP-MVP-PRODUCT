import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const sync=fs.readFileSync('public/legacy/firebase-sync.js','utf8');

test('v11 road history has one canonical TICKETS_DB provider and separate export adapter',()=>{
  const providers=[...core.matchAll(/function _rodGetHistorico\(\)/g)];
  assert.equal(providers.length,1,'_rodGetHistorico must not be shadowed by a later duplicate');
  assert.match(core,/function _rodGetHistoricoExport\(\)/);
  assert.match(core,/return Object\.entries\(TICKETS_DB\)/);
  assert.match(core,/const todos=_rodGetHistorico\(\)/);
  assert.match(core,/const lista=_rodGetHistoricoExport\(\)/);
});

test('v11 road client/supplier select follows current Compra/Venda mode after F5 and RTDB hydration',()=>{
  assert.match(core,/function rodPopularPessoaSelect\(\)/);
  assert.match(core,/\(_rodTipoAtual\|\|'compra'\)==='venda'/);
  assert.match(core,/const clientes=\(CLIENTES\|\|\[\]\)/);
  assert.match(core,/const fornecedores=getFornAtivos\(\)/);
  assert.match(core,/function renderRodBalanca\(\)[\s\S]*rodPopularPessoaSelect\(\)/);
  assert.match(sync,/_syncClientes\.carregarDeRemoto[\s\S]{0,500}rodPopularPessoaSelect\(\)/);
  assert.match(sync,/renderEpi','renderRodBalanca'/);
});

test('v11 unfinished road purchases can return to Aguardando Saida without changing ticket data',()=>{
  const render=core.slice(core.indexOf('function renderRodBalanca()'), core.indexOf('// ══════════════════════════════════════════\n//  BALANCEIRO'));
  assert.match(render,/const compraEmEdicao=/);
  assert.match(render,/t\._rodEntrada/);
  assert.match(render,/t\.tipo!=='venda' && !compraEmEdicao/);
  const cancel=core.slice(core.indexOf('function rodCancelarModoMateriaisCompra()'), core.indexOf('function rodMatPreviewCompra()'));
  assert.match(cancel,/_rodTicketCompraAtivo=null/);
  assert.match(cancel,/renderRodBalanca\(\)/);
});

test('v11 purchase-in-progress history resumes the same multi-material flow',()=>{
  const hist=core.slice(core.indexOf('function rodRenderHistorico()'), core.indexOf('function rodLimparFiltrosHist()'));
  assert.match(hist,/const isPesandoCompra=/);
  assert.match(hist,/rodEntrarModoMateriaisCompra\('\$\{k\}'\)/);
});

test('v11 camera handling never bypasses browser permission and recovers stale device ids',()=>{
  const cam=core.slice(core.indexOf('async function rodIniciarCameras()'), core.indexOf('function rodCapturarFoto('));
  assert.match(cam,/OverconstrainedError/);
  assert.match(cam,/NotAllowedError/);
  assert.match(cam,/Permissão de câmera bloqueada/);
  assert.match(cam,/_rodStream1\.clone\(\)/);
});
