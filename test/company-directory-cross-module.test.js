import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const path=new URL('../public/legacy/app-core.js',import.meta.url);
const source=readFileSync(path,'utf8');
const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../api/admin/employee-companies.js',import.meta.url),'utf8');
const branding=readFileSync(new URL('../server/application/get-public-branding.js',import.meta.url),'utf8');

function companyApi(){
  const start=api.indexOf('function companyKey(value)');
  const end=api.indexOf('export default async function handler',start);
  const context={};
  runInNewContext(api.slice(start,end).replaceAll('export function','function')+'\nthis.changeCompanyConfig=changeCompanyConfig;this.normalizeEmployeeCompanies=normalizeEmployeeCompanies;',context);
  return context;
}

function companyUi(){
  const start=source.indexOf('function _cfgPublicBusiness(){');
  const end=source.indexOf('function _cfgExpenseGroupCompanyMap(){',start);
  const part=source.slice(start,end);
  const refs={
    ERP_BUSINESS_CONFIG:{
      primaryCompanyKey:'Manuela Metais',
      companies:{'Manuela Metais':{},'Mabor':{}},
      employeeCompanies:['Manuela Metais','Gratus','MEI','Teste'],
      financeCompanies:['Manuela Metais','Mabor'],
      expenseGroups:['MABOR','GRATUS','MANUELA','ELAINE','RAFAEL'],
      expenseGroupCompanyMap:{'Manuela Metais':'MANUELA','Mabor':'MABOR'}
    },
    EMPRESAS_INFO:{},
    esc:v=>String(v),
    window:{__PUBLIC_BUSINESS_CONFIG__:{}},
    EMPRESAS:[],
    _despMescladas:()=>[],
    document:{getElementById:()=>null}
  };
  runInNewContext(part,refs);
  const eStart=source.indexOf('function _popularEmpresasDespesa(){');
  const eEnd=source.indexOf('function _cpParaDespesa(',eStart);
  const expenses=source.slice(eStart,eEnd);
  runInNewContext("function _cfgExpenseGroupForCompany(v){const m=ERP_BUSINESS_CONFIG.expenseGroupCompanyMap||window.__PUBLIC_BUSINESS_CONFIG__.expenseGroupCompanyMap||{};return m[v]||v;}\n"+expenses,refs);
  return refs;
}

test('cadastro comum aceita Física, mantém históricos e não duplica nomes com acento',()=>{
  const {changeCompanyConfig}=companyApi();
  const initial={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor'],expenseGroups:['MABOR','GRATUS']};
  const created=changeCompanyConfig(initial,'create','Física');
  assert.equal(Array.from(created.employeeCompanies).filter(v=>v==='Física').length,1);
  const repeated=changeCompanyConfig(created,'create','Fisica');
  assert.equal(Array.from(repeated.employeeCompanies).length,3);
  const removed=changeCompanyConfig(created,'archive','Física');
  assert.ok(Array.from(removed.employeeCompanies).includes('Física'));
  assert.ok(Array.from(removed.inactiveCompanies).includes('Física'));
  const restored=changeCompanyConfig(removed,'restore','Física');
  assert.equal(Array.from(restored.inactiveCompanies).length,0);
  assert.equal(changeCompanyConfig(initial,'archive','Manuela Metais'),null);
});

test('empresa criada no RH aparece também em Despesas do Grupo e nos seletores financeiros',()=>{
  const ui=companyUi();
  ui._popularEmpresasDespesa();
  assert.ok(Array.from(ui.EMPRESAS).includes('Teste'));
  assert.ok(Array.from(ui.EMPRESAS).includes('MABOR'));
  assert.ok(Array.from(ui._cfgEmployeeCompanies()).includes('Teste'));
  assert.ok(Array.from(ui._cfgFinanceCompanies()).includes('Teste'));
  assert.ok(Array.from(ui._cfgChequeCompanies()).includes('Teste'));
  assert.ok(Array.from(ui._cfgTransferCompanies()).includes('Teste'));
});

test('empresa removida não volta aos novos lançamentos, mas permanece no histórico',()=>{
  const ui=companyUi();
  const select={value:'',innerHTML:''};
  ui.document.getElementById=id=>id==='f-emp'?select:null;
  ui.ERP_BUSINESS_CONFIG.inactiveCompanies=['Teste'];
  ui._despMescladas=()=>[{empresa:'Teste',data:'2026-10-01',valor:5}];
  ui._popularEmpresasDespesa();
  assert.ok(Array.from(ui.EMPRESAS).includes('Teste'));
  assert.doesNotMatch(select.innerHTML,/Teste/);
  assert.ok(!Array.from(ui._cfgEmployeeCompanies()).includes('Teste'));
  assert.ok(!Array.from(ui._cfgFinanceCompanies()).includes('Teste'));
  assert.ok(!Array.from(ui._cfgChequeCompanies()).includes('Teste'));
});

test('cadastro gerenciado tem ações de remover e reativar somente por API autenticada',()=>{
  assert.match(source,/if\(!_usuarioAtualEhAdmin\(\)\)/);
  assert.match(source,/data-company-action/);
  assert.match(source,/restore/);
  assert.match(source,/archive/);
  assert.match(source,/\/api\/admin\/employee-companies/);
  assert.match(api,/requireIdentity\(req,\{admin:true\}\)/);
  assert.match(api,/db\.ref\('erp\/config'\)\.transaction/);
});

test('despesas e funcionários possuem entrada ao mesmo cadastro e a configuração pública mantém estados',()=>{
  assert.match(html,/id="tab-despesas_grupo"[\s\S]*?gerenciarEmpresasFuncionarios\(\)/);
  assert.match(html,/id="tab-funcionarios"[\s\S]*?gerenciarEmpresasFuncionarios\(\)/);
  assert.match(branding,/inactiveCompanies: stringList\(cfg\.inactiveCompanies\)/);
  assert.match(branding,/expenseGroups: stringList\(cfg\.expenseGroups\)/);
  assert.match(source,/_erpRefreshCompanySources\(\)/);
});

test('snapshot recente do Firebase permite reativação mesmo com configuração pública antiga',()=>{
  const ui=companyUi();
  ui.window.__PUBLIC_BUSINESS_CONFIG__.inactiveCompanies=['Teste'];
  ui.ERP_BUSINESS_CONFIG.inactiveCompanies=[];
  assert.ok(Array.from(ui._cfgEmployeeCompanies()).includes('Teste'));
});

test('sem leitura direta da configuração protegida ainda oferece empresas públicas nos módulos',()=>{
  const ui=companyUi();
  ui.ERP_BUSINESS_CONFIG={};
  ui.window.__PUBLIC_BUSINESS_CONFIG__={
    employeeCompanies:['Manuela Metais','Física'],
    expenseGroups:['MANUELA','GRATUS'],
    chequeCompanies:['Elaine'],
    expenseGroupCompanyMap:{'Manuela Metais':'MANUELA'}
  };
  ui._popularEmpresasDespesa();
  assert.ok(Array.from(ui.EMPRESAS).includes('Física'));
  assert.ok(Array.from(ui._cfgChequeCompanies()).includes('Elaine'));
  assert.ok(Array.from(ui._cfgFinanceCompanies()).includes('Física'));
  assert.ok(Array.from(ui._cfgEmployeeCompanies()).includes('Física'));
});

test('formulário de despesas não guarda empresas fixas no HTML e usa cadastro central',()=>{
  const group=html.slice(html.indexOf('id="tab-despesas_grupo"'),html.indexOf('id="desp-lancar"')+3000);
  assert.match(group,/id="fil-emp"/);
  assert.match(group,/id="f-emp"/);
  assert.doesNotMatch(group,/<option>MABOR<\/option>/);
  assert.match(group,/gerenciarEmpresasFuncionarios\(\)/);
});
