import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../public/',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const core=read('legacy/app-core.js');
const ui=read('legacy/operations-polish.js');
const css=read('legacy/operations-polish.css');
const bootstrap=read('app/bootstrap.js');
const template=read('index.template.html');

// Presentation must never copy, mutate or overwrite business records.
test('Busca em vendas e estoque filtra apenas as linhas HTML',()=>{
  assert.match(ui,/tbodyId:'tb-vendas-list'/);
  assert.match(ui,/tbodyId:'tb-estoque'/);
  assert.match(ui,/row\.hidden=!match/);
  assert.doesNotMatch(ui,/\b(?:saveDB|fbSalvar|setFolhaValor|CONTAS_PAGAR\.push|FOLHA_DB\[)\s*\(/);
});
test('Extratos preservam cálculos legados e filtram as linhas sem recalcular saldos',()=>{
  for(const id of ['fc-extrato','fc-tbody','ff-tbody'])assert.match(ui,new RegExp(`tbodyId:'${id}'`));
  assert.match(ui,/new MutationObserver\(update\)\.observe\(tbody,\{childList:true\}\)/);
  assert.match(ui,/tr\.hidden=!ok/);
  assert.match(template,/id="fc-extrato"/);
  assert.match(template,/id="fc-tbody"/);
  assert.match(template,/id="ff-tbody"/);
});
test('Cartão de usuários não expõe senhas no HTML',()=>{
  const snippet=core.split('function populateUsers(){')[1].split('function mudarSenha(un){')[0];
  assert.doesNotMatch(snippet,/u\.password|pwdval-|togglePwd/);
  assert.match(snippet,/erp-user-permissions/);
  assert.match(snippet,/esc\(u\.name\|\|un\)/);
  assert.match(core,/id="eu-pass" type="password" value=""/);
  assert.doesNotMatch(core,/function togglePwd\(/);
});
test('Polimento carrega após outras folhas CSS, sem substituir contratos ou permissões',()=>{
  assert.match(bootstrap,/document\.head\.appendChild\(uiStylesheet\);[\s\S]*loadStyle\('\/legacy\/operations-polish\.css'\)/);
  assert.match(bootstrap,/await loadClassic\('\/legacy\/operations-polish\.js'\)/);
  assert.match(css,/#tab-folha_pagamento \.folha-tbl/);
  assert.match(css,/#modal-ficha-cli/);
  assert.match(css,/#modal-ficha-forn/);
  assert.match(css,/@media\(max-width:540px\)/);
});
test('Complemento de remuneração utiliza o adicional contabilizado pelo cálculo atual',()=>{
  assert.match(template,/Complemento R\$/);
  assert.match(core,/const adicional=Number\(fd\.adicional\|\|0\)/);
  assert.match(core,/function setFolhaValor\(mat,campo,val\)/);
});
