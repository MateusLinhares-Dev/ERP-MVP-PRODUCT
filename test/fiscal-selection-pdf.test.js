import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = path => fs.readFileSync(new URL('../' + path,import.meta.url),'utf8');
const fiscal = read('public/modules/phase1/phase1-fiscal-admin.js');
const chooser = read('public/modules/phase2/phase2-feedback.js');
const css = read('public/modules/phase2/phase2-feedback.css');

test('PDF fiscal vincula cabeçalho à empresa e usa logo somente para Manuela',()=>{
  const start = fiscal.indexOf('  function selectedFiscalCompany()');
  const end = fiscal.indexOf('  const legacyFiscalPdf =',start);
  assert.ok(start>0 && end>start);
  const context={global:{FiscalWorkspaceSelectedCompany:'manuela'},$:()=>null};
  vm.runInNewContext(fiscal.slice(start,end)+'\nglobal.testPrint = fiscalReportMarkup; global.testSelected=selectedFiscalCompany;',context);
  const data={ent:[{data:'27/10/2026',num:'123',fornecedor:'TESTE <Fornecedor>',valorTotal:2,itens:[{produto:'Sucata',kg:3,valor:2}]}],sai:[]};
  const info={label:'Outubro/2026'};
  const manu=context.global.testPrint(info,data,'manuela');
  const gra=context.global.testPrint(info,data,'gratus');
  assert.match(manu,/Manuela Metais/);assert.match(manu,/\/assets\/branding\/manuela-metais-logo\.webp/);
  assert.doesNotMatch(gra,/manuela-metais-logo/);assert.match(gra,/Gratus Metais/);
  assert.match(manu,/TESTE &lt;Fornecedor&gt;/);
  assert.equal(context.global.testSelected(),'manuela');
  context.global.FiscalWorkspaceSelectedCompany='gratus';
  assert.equal(context.global.testSelected(),'gratus');
});

test('exportação usa a chave de dados da empresa selecionada e mantém o formato legado do período',()=>{
  assert.match(fiscal,/global\._fiscalEnsureEmpresa\(\) !== company/);
  assert.match(fiscal,/global\.fiscalSetEmpresa\(company\)/);
  assert.match(fiscal,/global\._fiscalNotasDoMes\(\)/);
  assert.match(fiscal,/popup\.document\.write\(fiscalReportMarkup\(info,data,company\)\)/);
});

test('cadastros fiscais são recarregados do Firebase ao abrir entrada, saída ou edição',()=>{
  for(const action of ['ne-forn','ns-cli','fe-pessoa']) assert.ok(chooser.includes(action));
  assert.match(chooser,/Promise\.resolve\(loadFiscalParties\(\)\)/);
  assert.match(chooser,/fiscalPartyList\(fiscalPickerType\(/);
  assert.match(chooser,/input\.removeAttribute\('list'\)/);
  assert.match(chooser,/option\.addEventListener\('click'/);
  assert.match(chooser,/x\.active!==false/);
  assert.match(css,/\.phase2-fiscal-picker-menu\[hidden\]/);
  assert.match(css,/#fiscal-edit-ov #fe-pessoa-tipo/);
});
