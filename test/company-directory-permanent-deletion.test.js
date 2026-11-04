import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('api/admin/employee-companies.js');
const core=read('public/legacy/app-core.js');
const brand=read('server/application/get-public-branding.js');
const sync=read('public/legacy/firebase-sync.js');

function apiFunctions(){
  const begin=api.indexOf('function companyKey(value)');
  const end=api.indexOf('export default async function handler',begin);
  const ctx={};
  runInNewContext(api.slice(begin,end).replaceAll('export function','function')+'\nthis.changeCompanyConfig=changeCompanyConfig;',ctx);
  return ctx;
}
function browser(config={}){
  const begin=core.indexOf('function _cfgPublicBusiness(){');
  const end=core.indexOf('function gerenciarEmpresasFuncionarios(){',begin);
  const ctx={
    ERP_BUSINESS_CONFIG:{primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Gratus'],chequeCompanies:['Elaine','Rafael'],...config},
    EMPRESAS_INFO:{'Manuela Metais':{},'Gratus Metais':{}},
    window:{__PUBLIC_BUSINESS_CONFIG__:{chequeCompanies:['Elaine','Rafael'],expenseGroups:['GRATUS']}},
    document:{getElementById:()=>null},
    esc:v=>String(v),
    _erpRefreshCompanySources(){},
    _popularEmpresasDespesa(){}
  };
  runInNewContext(core.slice(begin,end),ctx);
  return ctx;
}

test('Elaine e Rafael aparecem em Funcionários, Despesas, Bancos, Cheques e Transferências pelo mesmo diretório',()=>{
  const ui=browser();
  for(const field of ['_cfgRegisteredCompanies','_cfgEmployeeCompanies','_cfgFinanceCompanies','_cfgTransferCompanies','_cfgChequeCompanies']){
    const names=Array.from(ui[field]());
    assert.ok(names.includes('Elaine'),field);
    assert.ok(names.includes('Rafael'),field);
    assert.equal(names.filter(x=>/gratus/i.test(x)).length,1,field);
  }
  assert.match(core,/function _popularEmpresasDespesa\(\)[\s\S]*?_cfgRegisteredCompanies\(\)/);
});

test('exclusão física do catálogo remove empresa de todas as listas legadas e grava tombstone',()=>{
  const cfg={
    primaryCompanyKey:'Manuela Metais',
    employeeCompanies:['Manuela Metais','Rafael','Mabor'],
    expenseGroups:['RAFAEL','MABOR'],
    financeCompanies:['Rafael','Manuela Metais'],
    transferCompanies:['Rafael','Mabor'],
    chequeCompanies:['Elaine','Rafael'],
    expenseGroupCompanyMap:{Rafael:'RAFAEL',Mabor:'MABOR'}
  };
  const changed=apiFunctions().changeCompanyConfig(cfg,'delete','Rafael');
  assert.ok(changed);
  for(const field of ['employeeCompanies','expenseGroups','financeCompanies','transferCompanies','chequeCompanies']){
    assert.ok(!Array.from(changed[field]).some(x=>x.toLowerCase()==='rafael'),field);
  }
  assert.equal(Object.keys(changed.expenseGroupCompanyMap).includes('Rafael'),false);
  assert.ok(Array.from(changed.deletedCompanies).includes('Rafael'));
  assert.equal(apiFunctions().changeCompanyConfig(changed,'create','RAFAEL'),null);
  assert.equal(apiFunctions().changeCompanyConfig(changed,'restore','RAFAEL'),null);
  assert.equal(apiFunctions().changeCompanyConfig(cfg,'delete','Manuela Metais'),null);
});

test('empresa excluída não retorna por configuração pública antiga nem nos novos lançamentos',()=>{
  const ui=browser({deletedCompanies:['Rafael','Gratus Metais'],employeeCompanies:['Manuela Metais','Mabor','Gratus Metais','Rafael']});
  for(const field of ['_cfgRegisteredCompanies','_cfgEmployeeCompanies','_cfgFinanceCompanies','_cfgTransferCompanies','_cfgChequeCompanies']){
    const names=Array.from(ui[field]());
    assert.ok(!names.some(x=>/rafael|gratus/i.test(x)),field);
    assert.ok(names.includes('Elaine'),field);
  }
  assert.ok(!ui._cfgEmployeeCompanyOptionsHtml('Rafael').includes('Rafael'));
});

test('delete chega aos seletores em tempo real e não é ignorado por cache anterior',()=>{
  const ui=browser();
  assert.ok(Array.from(ui._cfgEmployeeCompanies()).includes('Rafael'));
  assert.equal(ui._erpApplyCompanyDirectory({employeeCompanies:['Manuela Metais','Mabor'],deletedCompanies:['Rafael'],inactiveCompanies:[]}),true);
  assert.ok(!Array.from(ui._cfgEmployeeCompanies()).includes('Rafael'));
  assert.equal(ui._erpApplyCompanyDirectory({employeeCompanies:['Manuela Metais','Mabor'],deletedCompanies:['Rafael'],inactiveCompanies:[]}),false);
});

test('interface exclui de verdade sem reativar e API mantém autorização administrativa',()=>{
  const start=core.indexOf('function _erpRenderEmpresasAdministracao(){');
  const end=core.indexOf('async function salvarEmpresaFuncionarios(){',start);
  const section=core.slice(start,end);
  assert.match(section,/data-company-action=\\\"delete|data-company-action=\"delete/);
  assert.match(section,/Excluir/);
  assert.doesNotMatch(section,/Reativar/);
  assert.match(api,/requireIdentity\(req,\{admin:true\}\)/);
  assert.match(api,/ref\('erp\/config'\)\.transaction/);
  assert.match(brand,/deletedCompanies: stringList\(cfg\.deletedCompanies\)/);
  assert.match(sync,/__erpApplyCompanyDirectory\(cfg\)/);
});
