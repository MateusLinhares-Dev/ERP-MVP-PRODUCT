import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('api/admin/employee-companies.js');
const core=read('public/legacy/app-core.js');
const sync=read('public/legacy/firebase-sync.js');
const store=read('public/modules/phase1/phase1-store.js');
const branding=read('server/modules/company/application/get-public-branding.js');

function backend(){
  const start=api.indexOf('function companyKey(value)');
  const end=api.indexOf('export default async function handler',start);
  const ctx={};
  runInNewContext(api.slice(start,end).replaceAll('export function','function')+'\nthis.changeCompanyConfig=changeCompanyConfig;',ctx);
  return ctx.changeCompanyConfig;
}
function frontend(){
  const start=core.indexOf('function _cfgPublicBusiness(){');
  const end=core.indexOf('function gerenciarEmpresasFuncionarios(){',start);
  const ctx={
    ERP_BUSINESS_CONFIG:{employeeCompanies:['Manuela Metais','Mabor'],primaryCompanyKey:'Manuela Metais'},
    EMPRESAS_INFO:{},
    window:{__PUBLIC_BUSINESS_CONFIG__:{employeeCompanies:['Manuela Metais','Mabor']}},
    document:{getElementById:()=>null},
    esc:String,
    _erpRefreshCompanySources(){},
    _popularEmpresasDespesa(){}
  };
  runInNewContext(core.slice(start,end),ctx);
  return ctx;
}
function companySnapshot(config){
  return {employeeCompanies:config.employeeCompanies||[],inactiveCompanies:config.inactiveCompanies||[],deletedCompanies:config.deletedCompanies||[],companyDirectoryRevision:config.companyDirectoryRevision||0};
}

test('operações sequenciais não substituem listas: inclusão + exclusão preservam as outras empresas',()=>{
  const change=backend();
  const original={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Rafael','Elaine']};
  const created=change(original,'create','Física');
  const deleted=change(created,'delete','Rafael');
  assert.equal(created.companyDirectoryRevision,1);
  assert.equal(deleted.companyDirectoryRevision,2);
  assert.ok(deleted.employeeCompanies.includes('Física'));
  assert.ok(deleted.employeeCompanies.includes('Elaine'));
  assert.ok(!deleted.employeeCompanies.includes('Rafael'));
  assert.ok(deleted.deletedCompanies.includes('Rafael'));
  assert.equal(original.companyDirectoryRevision,undefined);
  assert.ok(original.employeeCompanies.includes('Rafael'));
});

test('evento Firebase ou resposta antiga não restaura uma empresa excluída',()=>{
  const change=backend();
  const ctx=frontend();
  const original={employeeCompanies:['Manuela Metais','Mabor'],primaryCompanyKey:'Manuela Metais'};
  const added=change(original,'create','Rafael');
  const removed=change(added,'delete','Rafael');
  assert.equal(ctx._erpApplyCompanyDirectory(companySnapshot(removed)),true);
  assert.equal(ctx._erpApplyCompanyDirectory(companySnapshot(added)),false);
  assert.ok(!Array.from(ctx._cfgRegisteredCompanies()).includes('Rafael'));
  assert.equal(ctx.window.__ERP_COMPANY_DIRECTORY_REVISION__,2);
  assert.ok(Array.from(ctx.window.__PUBLIC_BUSINESS_CONFIG__.deletedCompanies).includes('Rafael'));
});

test('configuração antiga não sobrescreve nova revisão durante sincronização geral',()=>{
  assert.match(sync,/const currentDirectory=window\.__ERP_COMPANY_DIRECTORY_STATE__/);
  assert.match(sync,/deletedCompanies:\(source\.deletedCompanies\|\|\[\]\)\.slice\(\)/);
  assert.match(core,/revision<\(Number\(window\.__ERP_COMPANY_DIRECTORY_REVISION__\)\|\|0\)/);
  assert.match(api,/companyDirectoryRevision=/);
  assert.match(branding,/companyDirectoryRevision:/);
  assert.match(api,/companyDirectoryResponse\(await getCompanyDirectory\(db\)\)/);
});

test('UI não aceita confirmação de inclusão ou exclusão sem resposta consistente do servidor',()=>{
  const start=core.indexOf('let _erpEmpresaAlteracaoEmCurso=false;');
  const end=core.indexOf('function _empresaPrincipalContatosInline(){',start);
  const section=core.slice(start,end);
  assert.match(section,/_erpEmpresaAlteracaoEmCurso=true/);
  assert.match(section,/_erpEmpresaEstadoDesejado\(result,action,name\)/);
  assert.match(section,/_erpConsultarEmpresasServidor\(token\)/);
  assert.match(section,/_erpEmpresaAlteracaoEmCurso=false/);
});

test('consulta de coleções restritas é evitada antes do RTDB negar; cache não cruza sessões',async()=>{
  let user={uid:'u1',getIdTokenResult:async()=>({claims:{erpAccess:true,canHR:true}})};
  const reads=[];
  const ctx={
    window:{firebase:{auth:()=>({currentUser:user})},__businessRepository:{read:async(collection)=>{reads.push(collection);return {ok:true};}}},
    Map,Set,Object,Array,Error,console
  };
  runInNewContext(store,ctx);
  const api=ctx.window.Phase1Store;
  assert.equal(JSON.stringify(await api.load('partyBanks',{})),'{}');
  assert.equal(JSON.stringify(await api.load('documentCategories',{})),'{}');
  assert.equal(JSON.stringify(await api.load('fiscalLinks',{})),'{}');
  assert.equal(JSON.stringify(await api.load('ownerBills',{})),'{}');
  assert.equal(reads.length,0);
  user={uid:'u2',getIdTokenResult:async()=>({claims:{erpAccess:true,admin:true,canPartyBanks:true,canBusinessDocs:true,canOwnerBills:true,canFiscalRead:true}})};
  for(const collection of ['partyBanks','documentCategories','fiscalLinks','ownerBills'])await api.load(collection,{});
  assert.equal(reads.length,4);
  user={uid:'u3',getIdTokenResult:async()=>({claims:{erpAccess:true,canHR:true}})};
  await api.load('partyBanks',{});
  assert.equal(reads.length,4);
  user={uid:'u4',getIdTokenResult:async()=>({claims:{erpAccess:true,canPartyBanks:true}})};
  ctx.window.__businessRepository.read=async()=>{throw new Error('PERMISSION_DENIED');};
  await assert.rejects(api.load('partyBanks',{}),/PERMISSION_DENIED/);
});
