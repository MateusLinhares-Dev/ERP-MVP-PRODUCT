import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p, import.meta.url),'utf8');
const js=read('public/modules/phase3/phase3-homologation.js');
const css=read('public/modules/phase3/bank-editor-polish.css');
const bootstrap=read('public/app/bootstrap.js');
const core=read('public/legacy/app-core.js');
test('cadastro de bancos tem layout dedicado e rodapé independente da rolagem',()=>{
 for(const name of ['phase3-bank-header','phase3-bank-row-head','phase3-bank-fields','phase3-bank-remove','phase3-bank-footer','phase3-bank-add','phase3-bank-cancel','phase3-bank-save']){
  assert.match(js,new RegExp(name));assert.match(css,new RegExp(name));
 }
 assert.match(js,/aria-modal="true"/);
 assert.match(js,/global\.phase3BankRemove=function/);
 assert.match(css,/#phase3-bank-ov \.phase3-bank-footer/);
 assert.match(css,/#phase3-bank-ov \.phase3-bank-rows\{[^}]*overflow-y:auto/);
});
test('salvamento e exclusão de contas exigem confirmação, sem limpar fornecedor antecipadamente',()=>{
 assert.match(js,/await store\.save\('partyBanks',bankKey\(kind,key\),rows\)/);
 assert.match(js,/if\(!rows\.length && !window\.confirm/);
 assert.match(js,/if\(!r\.holderName\)/);
 assert.match(js,/phase3BankRenumber\(\)/);
});
test('restauração mantém RH iD e paginação do app-core e carrega engenharia na ordem certa',()=>{
 for(const value of ['_rhidAssinaturaFuncionarios','freeDown<270&&freeUp>freeDown','_erpPaginarDados(','_RHID_PREVIA_POR_PAGINA = 6'])assert.ok(core.includes(value),value);
 for(const name of ['rhid-card-reader.js','list-pagination.js','help-center.js','final-ops.js','engineering.js'])assert.ok(bootstrap.includes(name),name);
 assert.ok(bootstrap.indexOf('rhid-card-reader.js')<bootstrap.indexOf('/legacy/app-core.js'));
 assert.ok(bootstrap.indexOf('help-center.js')<bootstrap.indexOf('final-ops.js'));
 assert.ok(bootstrap.indexOf('final-ops.js')<bootstrap.indexOf('engineering.js'));
 const occ=(bootstrap.match(/loadClassic\('\/modules\/phase1\/phase1-searchable-select\.js'\)/g)||[]).length;
 assert.equal(occ,1);
});
