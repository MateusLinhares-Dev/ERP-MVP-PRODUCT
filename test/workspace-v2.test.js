import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const bootstrap=read('app/bootstrap.js');
const nav=read('legacy/workspace-navigation.js');
const css=read('legacy/design-system-v2.css');
const core=read('legacy/app-core.js');

test('navegador de módulos respeita lista previamente gerada pela ACL e não modifica regras',()=>{
  assert.match(nav,/#nav-bar \.nav-tab\[data-tab\]/);
  assert.match(nav,/nav\.click\(\)/);
  assert.doesNotMatch(nav,/firebase|fbSalvar|CONTAS_PAGAR|\.ref\(/);
  assert.match(nav,/aria-modal/);
  assert.match(nav,/ctrlKey\|\|event\.metaKey/);
});

test('extrato utiliza domínio puro e separa filtros dos saldos',()=>{
  assert.match(bootstrap,/loadClassic\('\/modules\/banking\/bank-ledger\.js'\)/);
  assert.match(core,/ledger\.statement\(/);
  assert.match(core,/function verExtratoBanco\(cod\)/);
  assert.match(core,/#erp-bank-result-count/);
  assert.match(core,/data-bank-action/);
  assert.match(css,/\.erp-statement-table-wrap\{overflow-x:auto/);
});

test('CSS do design system carrega após camadas existentes',()=>{
  assert.match(bootstrap,/loadStyle\('\/legacy\/operations-polish\.css'\)[\s\S]*loadStyle\('\/legacy\/design-system-v2\.css'\)/);
  assert.match(bootstrap,/loadClassic\('\/legacy\/workspace-navigation\.js'\)/);
  for(const path of ['legacy/workspace-navigation.js','legacy/design-system-v2.css','modules/banking/bank-ledger.js']){
    assert.ok(existsSync(new URL('../public/'+path,import.meta.url)));
  }
});
