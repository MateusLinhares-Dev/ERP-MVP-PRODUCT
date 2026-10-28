import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fiscalStaffPublicView} from '../server/domain/fiscal-staff.js';

const code=fs.readFileSync(new URL('../public/modules/phase1/phase1-fiscal-admin.js', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/phase1/phase1-fiscal-admin.css', import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../api/fiscal/staff.js', import.meta.url),'utf8');

test('primeira abertura monta os painéis no DOM antes da extensão e ativa uma única aba',()=>{
  const attach=code.indexOf("title.insertAdjacentElement('afterend', shell)");
  const extension=code.indexOf('global.FiscalExtensions?.install(shell)');
  assert.ok(attach>0&&extension>attach);
  assert.match(code,/e.hidden=true;e.style.display='none'/);
  assert.match(code,/root\.querySelectorAll\('\[data-fiscal-view\]'\)/);
  assert.match(css,/\.fis-v3-panel\[hidden\]/);
  assert.match(code,/fis-work-navrow/);
  assert.match(code,/fis-work-nav-extra/);
});

test('devolução usa cadastro fiscal selecionado, obrigatório e vigente, não nome livre',()=>{
  assert.match(code,/<select id=\\?"fis-v3-ret-party/);
  assert.doesNotMatch(code,/<input id=\\?"fis-v3-ret-party/);
  assert.match(code,/fiscalPartyKind\(p.type\)/);
  assert.match(code,/partyId:party.id/);
  assert.match(code,/await fiscalPartiesLive\(\)/);
});

test('vínculo documental consulta cadastros atuais, não cache inicializado cedo demais',()=>{
  assert.match(code,/const parties=await fiscalPartiesLive\(\)/);
  assert.match(code,/await db\(\)\.ref\('erp\/fiscalParties'\)\.once\('value'\)/);
  assert.match(code,/O cadastro vinculado não está mais ativo/);
});

test('funcionários sem canHR são consultados no backend autenticado somente com canPayroll',()=>{
  assert.match(api,/await requireIdentity\(req\)/);
  assert.match(api,/identity\.canPayroll!==true/);
  assert.match(api,/fiscalStaffPublicView/);
  assert.match(code,/getIdToken\?\.\(\)/);
  assert.match(code,/fetch\('\/api\/fiscal\/staff'/);
});

test('API só expõe matrícula, nome e salário-base, nunca CPF ou dados bancários',()=>{
  const staff=fiscalStaffPublicView([{mat:'F001',nome:'Teste Funcionário',sal:2500,cpf:'12345678901',banco:'999',endereco:'privado',status:'Inativo'}]);
  assert.deepEqual(staff,[{mat:'F001',nome:'Teste Funcionário',sal:2500}]);
  assert.throws(()=>fiscalStaffPublicView(new Array(5001).fill({mat:'F1',nome:'A'})),{status:413});
});
