import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js=read('public/modules/phase1/phase1-fiscal-admin.js');
const css=read('public/modules/phase1/phase1-fiscal-admin.css');
const bootstrap=read('public/app/bootstrap.js');
const template=read('public/index.template.html');

test('fiscal workspace carrega após os módulos fiscais e mantém a interface antiga funcionando',()=>{
  assert.ok(bootstrap.includes("loadClassic('/modules/phase1/phase1-fiscal-admin.js')"));
  assert.ok(bootstrap.includes("loadStyle('/modules/phase1/phase1-fiscal-admin.css')"));
  assert.ok(js.includes("global.fiscalSubTab(name)"));
  assert.ok(js.includes("['mensal', 'anual', 'impostos', 'apuracao']"));
  assert.ok(js.includes("originalCompanyBar"));
  assert.ok(js.includes("originalPeriodBar"));
});

test('cada ação fiscal usa o botão legado sem criar cópia do formulário ou persistência paralela',()=>{
  for(const id of ['fiscal-panel-mensal','fiscal-panel-anual','fiscal-panel-impostos','fiscal-panel-apuracao','phase1-fiscal-parties','fiscal-btn-fechar','fiscal-btn-reabrir','fmtab-btn-importar','fmtab-btn-estoque'])
    assert.ok(js.includes(id) || js.includes(id.replace('fiscal-panel-','')) || js.includes(id.replace('fmtab-btn-','')) || js.includes(id.replace('fiscal-btn-','')),`${id} precisa ser preservado`);
  for (const pattern of ['fiscalCarregarMes()', 'fiscalNovaEntrada()', 'fiscalNovaSaida()', 'fiscalExportarPDF()', 'fiscalExportarXML()'])
    assert.ok(template.includes(pattern),`contrato legado: ${pattern}`);
  assert.doesNotMatch(js,/firebase\.database\(|fetch\(['"]https?:/);
});

test('fiscal tem apresentação independente com paneis recolhidos e largura contida',()=>{
  assert.ok(js.includes('data-fiscal-view'));
  assert.ok(js.includes('relocateRegistry()'));
  assert.ok(css.includes('.fis-work-view[hidden]'));
  assert.ok(css.includes('min-width:0'));
  assert.ok(css.includes('@media(max-width:500px)'));
  assert.ok(!css.includes('#tab-fiscal .fis-workspace .tbl { display:none'));
});
