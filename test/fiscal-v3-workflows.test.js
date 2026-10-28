import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('public/modules/phase1/phase1-fiscal-admin.js');
const css=read('public/modules/phase1/phase1-fiscal-admin.css');
const rules=read('storage.rules');
const extension=js.slice(js.indexOf("(function(global){\n'use strict';\n// Extensões do Fiscal."));

test('cinco áreas fiscais acessíveis e interface responsiva',()=>{
  for(const t of ['Importar XML','Estoque inicial','NF de devolução','Documentos fiscais','Custos por funcionário'])
    assert.ok(extension.includes(t),t);
  for(const v of ['xml','estoque-inicial','devolucoes','documentos','custos-rh'])
    assert.ok(js.includes(`'${v}'`));
  assert.match(js,/if\(mounted\)\{init\(mounted\)/);
  assert.match(css,/\.fis-v3-fields\{display:grid/);
  assert.match(css,/@media\(max-width:600px\)/);
});

test('XML exige revisão humana e não grava lançamentos diretamente',()=>{
  for(const token of ['DOMParser','DOCTYPE','ENTITY','2500000','fiscalNovaEntrada','fiscalNovaSaida','Rascunho preenchido'])
    assert.ok(extension.includes(token),token);
  assert.match(extension,/global\.fiscalCalcTotal\?\.\(prefix\)/);
  assert.doesNotMatch(extension,/imported.*\.push\(/);
});

test('estoque inicial é um valor monetário da apuração por empresa e ano',()=>{
  assert.match(extension,/erp\/fiscalApur\/.*estIni0/);
  assert.match(extension,/Estoque inicial é um valor financeiro/);
  assert.match(extension,/await allowWrite\(\)/);
  assert.match(extension,/global\.fiscalRenderApuracao/);
});

test('devoluções não emitem NF-e nem alteram estoque automaticamente',()=>{
  assert.match(extension,/erp\/fiscal\/.*devolucoes/);
  assert.match(extension,/erp\/fiscalApur\/.*devol/);
  assert.match(extension,/Seja|Não houve baixa de estoque|não emite uma NF-e/);
  assert.match(extension,/confirm\('Substituir o campo Devoluções/);
});

test('documentos com permissão fiscal e tipos limitados no Firebase Storage',()=>{
  assert.match(rules,/match \/erp-files\/fiscalDocs\/\{company\}\/\{owner\}\/\{fileName\}/);
  assert.match(rules,/request\.auth\.token\.canFiscalRead == true/);
  assert.match(rules,/request\.auth\.token\.canFiscalWrite == true/);
  assert.match(rules,/request\.resource\.size <= 10 \* 1024 \* 1024/);
  assert.match(extension,/await ref\.put\(f,\{contentType:f\.type\}\)/);
  assert.match(extension,/await db\(\)\.ref\('erp\/fiscal\/__documentsV3/);
  assert.match(extension,/await allowWrite\(\)/);
});

test('custos mensais e anuais só são acessíveis com canPayroll',()=>{
  assert.match(extension,/!c\.canPayroll/);
  assert.match(extension,/calcPayrollMonth/);
  assert.match(extension,/employerCostRate/);
  const sandbox={window:{ERP_BUSINESS_CONFIG:{payrollDefaults:{employerCostRate:0.28}}},FOLHA_DB:{'2026-10-F003':{adicional:100}},PONTO_DB:[],VIAGEM_DB:[{motorista:'TESTE 3',data:'2026-10-20',totalDiarias:200}],document:{getElementById:()=>null},Date};
  vm.runInNewContext(extension,sandbox);
  const out=sandbox.window.FiscalExtensions.calcPayrollMonth({nome:'TESTE 3',mat:'F003',sal:1000},2026,'10');
  assert.equal(out.bruto,1300);
  assert.equal(out.diarias,200);
  assert.equal(out.encargos,364);
  assert.equal(out.cost,1664);
});
