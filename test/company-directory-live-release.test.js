import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('public/legacy/app-core.js');
const sync=read('public/legacy/firebase-sync.js');
const api=read('api/admin/employee-companies.js');
const bootstrap=read('public/app/bootstrap.js');
const template=read('public/index.template.html');
const print=read('public/modules/purchase-order/purchase-order.js');

function backend(){
  const start=api.indexOf('function companyKey(value)');
  const end=api.indexOf('export default async function handler',start);
  const ctx={};
  runInNewContext(api.slice(start,end).replaceAll('export function','function')+'\nthis.changeCompanyConfig=changeCompanyConfig;this.normalizeEmployeeCompanies=normalizeEmployeeCompanies;',ctx);
  return ctx;
}
function frontend(){
  const start=core.indexOf('function _cfgPublicBusiness(){');
  const end=core.indexOf('function gerenciarEmpresasFuncionarios(){',start);
  const cfg={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Gratus'],financeCompanies:['Gratus Metais'],expenseGroups:['GRATUS','MABOR'],inactiveCompanies:[]};
  const pub={employeeCompanies:['Gratus Metais','Teste'],financeCompanies:['Gratus Metais'],inactiveCompanies:[]};
  const state={refreshCount:0};
  const ctx={ERP_BUSINESS_CONFIG:cfg,EMPRESAS_INFO:{},window:{__PUBLIC_BUSINESS_CONFIG__:pub},document:{getElementById:()=>null},esc:v=>String(v),_erpRefreshCompanySources(){state.refreshCount++;},_popularEmpresasDespesa(){},state};
  runInNewContext(core.slice(start,end),ctx);
  return ctx;
}

test('Gratus e Gratus Metais representam a mesma empresa e exclusão se propaga',()=>{
  const be=backend();
  const current={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Gratus'],financeCompanies:['Gratus Metais']};
  const updated=be.changeCompanyConfig(current,'archive','Gratus');
  assert.ok(updated);
  const ctx=frontend();
  assert.equal(ctx._erpApplyCompanyDirectory(updated),true);
  assert.ok(!Array.from(ctx._cfgRegisteredCompanies()).some(x=>/gratus/i.test(x)));
  assert.ok(!Array.from(ctx._cfgFinanceCompanies()).some(x=>/gratus/i.test(x)));
  assert.ok(!Array.from(ctx._cfgChequeCompanies()).some(x=>/gratus/i.test(x)));
  assert.ok(!Array.from(ctx._cfgTransferCompanies()).some(x=>/gratus/i.test(x)));
  assert.equal(ctx.state.refreshCount,1);
  assert.equal(ctx._erpApplyCompanyDirectory(updated),false);
  assert.equal(ctx.state.refreshCount,1);
});

test('empresa nova aparece em todos os seletores sem reconstrução geral de dados',()=>{
  const be=backend();
  const ctx=frontend();
  const current={employeeCompanies:['Manuela Metais','Mabor','Gratus']};
  const updated=be.changeCompanyConfig(current,'create','Física');
  assert.equal(ctx._erpApplyCompanyDirectory(updated),true);
  for(const fn of ['_cfgEmployeeCompanies','_cfgFinanceCompanies','_cfgChequeCompanies','_cfgTransferCompanies']){
    assert.ok(Array.from(ctx[fn]()).includes('Física'),fn);
  }
  assert.ok(ctx.state.refreshCount===1);
});

test('empresas históricas e apelidos não geram duplicatas em novos lançamentos',()=>{
  const ctx=frontend();
  const list=Array.from(ctx._cfgRegisteredCompanies());
  assert.equal(list.filter(x=>/gratus/i.test(x)).length,1);
  assert.equal(list.filter(x=>/manuela/i.test(x)).length,1);
  const be=backend();
  assert.equal(Array.from(be.normalizeEmployeeCompanies(['Gratus','Gratus Metais','Manuela','Manuela Metais'])).length,2);
});

test('a API não permite remover empresa principal ou mudar configurações fora da transação autenticada',()=>{
  assert.equal(backend().changeCompanyConfig({primaryCompanyKey:'Manuela Metais'},'archive','Manuela'),null);
  assert.match(api,/requireIdentity\(req,\{admin:true\}\)/);
  assert.match(api,/ref\('erp\/companyDirectory'\)/);
  assert.match(sync,/ref\('erp\/companyDirectory'\)\.on\('value'/);
  assert.match(sync,/window\.__erpApplyCompanyDirectory\(\{employeeCompanies:cfg\.companies/);
});

test('inicialização faz leituras de configuração em paralelo e atualiza versão do frontend',()=>{
  assert.match(bootstrap,/Promise\.all\(\[/);
  assert.match(template,/bootstrap\.js\?v=20261107-purchase-atomic-recovery-v3/);
  assert.match(bootstrap,/const assetRevision = '20261107-purchase-atomic-recovery-v3'/);
});

test('pedido de compra tem fonte legível e continua usando página A4',()=>{
  assert.match(print,/@page\{size:A4;margin:14mm\}/);
  assert.match(print,/\.items,\.installments\{[^}]*font-size:14px/);
  assert.match(print,/\.print-totals\{[^}]*font-size:13px/);
  assert.match(print,/@media print\{/);
});
