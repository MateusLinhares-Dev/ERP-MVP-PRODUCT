import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const html=fs.readFileSync('public/index.template.html','utf8');

test('v10 camera configuration reuses the real legacy modal container',()=>{
  assert.match(html,/id="modal-ov"/);
  assert.doesNotMatch(core,/getElementById\('modal-overlay'\)/);
  assert.match(core,/getElementById\('modal-ov'\)/);
  assert.match(core,/modal\.classList\.add\('open'\)/);
});

test('v10 camera preview explicitly starts selected stream and exposes its wrapper',()=>{
  assert.match(core,/videoEl\.srcObject=stream/);
  assert.match(core,/await videoEl\.play\(\)/);
  assert.match(core,/wrapEl\.style\.display='flex'/);
  assert.match(core,/permissaoStream\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
});

test('v10 road weighings persist the existing TICKETS_DB immediately without changing its domain model',()=>{
  assert.match(core,/function _rodPersistirTicketCritico\(tid\)/);
  assert.match(core,/__businessRepository\.upsert\('tickets',tid,TICKETS_DB\[tid\]\)/);
  assert.match(core,/typeof fbSalvarImediato==='function'/);

  const registrar=core.slice(core.indexOf('function rodRegistrarEntrada()'), core.indexOf('function rodSelecionarParaSaida('));
  assert.match(registrar,/TICKETS_DB\[tid\]=\{/);
  assert.match(registrar,/_rodPersistirTicketCritico\(tid\)/);

  const add=core.slice(core.indexOf('function rodAdicionarMaterialCompra()'), core.indexOf('function rodRemoverMaterialCompra('));
  assert.match(add,/_rodPersistirTicketCritico\(tid\)/);

  const finalizar=core.slice(core.indexOf('function rodFinalizarCompraMateriais()'), core.indexOf('function rodExcluirTicketCompra('));
  assert.match(finalizar,/_rodPersistirTicketCritico\(tid\)/);
});

test('v10/v11 keeps legacy road queue status/type guards',()=>{
  const render=core.slice(core.indexOf('function renderRodBalanca()'), core.indexOf('// ══════════════════════════════════════════\n//  BALANCEIRO'));
  assert.match(render,/t\.status!=='Aguard\. Preço'/);
  assert.match(render,/t\.tipo!=='venda'/);
  assert.match(render,/t\._rodEntrada/);
});
