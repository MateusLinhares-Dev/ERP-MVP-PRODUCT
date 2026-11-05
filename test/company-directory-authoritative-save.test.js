import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('public/legacy/app-core.js');
const api=read('api/admin/employee-companies.js');
const start=core.indexOf('let _erpEmpresaAlteracaoEmCurso=false;');
const end=core.indexOf('async function _erpMudarSituacaoEmpresa(',start);
const first=api.indexOf('function companyKey(value)');
const last=api.indexOf('export default async function handler',first);
const serverContext={};
runInNewContext(api.slice(first,last).replaceAll('export function','function')+'\nthis.changeCompanyConfig=changeCompanyConfig;',serverContext);
const change=serverContext.changeCompanyConfig;
const key=v=>String(v||'').trim().toLowerCase();
const clone=v=>JSON.parse(JSON.stringify(v));
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});

function setup(initial,hook=()=>{}){
  let stored=clone(initial);
  let calls=[];
  const applied=[];
  const runFetch=async(url,options)=>{
    calls.push(options.method);
    if(options.method==='GET')return response(200,{ok:true,apiVersion:2,companies:stored.employeeCompanies||[],deletedCompanies:stored.deletedCompanies||[],inactiveCompanies:stored.inactiveCompanies||[],revision:stored.companyDirectoryRevision||0});
    hook('beforePost',stored);
    const body=JSON.parse(options.body);
    const updated=change(stored,body.action,body.name,body.expectedRevision);
    if(!updated)return response(409,{message:'O cadastro foi alterado em outra sessão'});
    stored=clone(updated);
    if(hook('afterPost',stored)==='lost-response')throw new Error('connection reset');
    return response(200,{ok:true,apiVersion:2,companies:stored.employeeCompanies||[],deletedCompanies:stored.deletedCompanies||[],inactiveCompanies:stored.inactiveCompanies||[],revision:stored.companyDirectoryRevision||0});
  };
  const ctx={firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token-test'}})},fetch:runFetch,window:{__ERP_COMPANY_DIRECTORY_REVISION__:0},_companyKey:key,_erpAplicarCadastroEmpresas:state=>{applied.push(clone(state));ctx.window.__ERP_COMPANY_DIRECTORY_REVISION__=state.revision;},_erpRenderEmpresasAdministracao:()=>{}};
  runInNewContext(core.slice(start,end)+'\nthis.run=_erpEnviarEmpresa;',ctx);
  return {run:ctx.run,read:()=>stored,calls:()=>calls,applied};
}

test('salvar e excluir repetidamente confirma imediatamente sem F5 ou perda de outras empresas',async()=>{
  const client=setup({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Elaine'],companyDirectoryRevision:4});
  await client.run('create','Rafael');
  assert.deepEqual(client.read().employeeCompanies,['Manuela Metais','Mabor','Elaine','Rafael']);
  await client.run('delete','Rafael');
  assert.deepEqual(client.read().employeeCompanies,['Manuela Metais','Mabor','Elaine']);
  assert.deepEqual(client.read().deletedCompanies,['Rafael']);
  assert.equal(client.read().companyDirectoryRevision,6);
  assert.deepEqual(client.calls(),['GET','POST','GET','POST']);
});

test('retorno de POST perdido é confirmado no GET sem criar empresa duas vezes',async()=>{
  let once=true;
  const client=setup({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais'],companyDirectoryRevision:1},phase=>{
    if(phase==='afterPost'&&once){once=false;return 'lost-response';}
  });
  await client.run('create','Física');
  assert.equal(client.read().companyDirectoryRevision,2);
  assert.deepEqual(client.read().employeeCompanies,['Manuela Metais','Física']);
  assert.deepEqual(client.calls(),['GET','POST','GET']);
});

test('versão concorrente não sobrescreve empresas criadas por outra sessão',async()=>{
  let bumped=false;
  const client=setup({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais'],companyDirectoryRevision:2},(phase,cfg)=>{
    if(phase==='beforePost'&&!bumped){
      bumped=true;
      const latest=change(cfg,'create','Elaine');
      Object.keys(cfg).forEach(k=>delete cfg[k]);
      Object.assign(cfg,clone(latest));
    }
  });
  await assert.rejects(client.run('create','Rafael'),/cadastro foi alterado em outra sessão/);
  assert.deepEqual(client.read().employeeCompanies,['Manuela Metais','Elaine']);
  assert.deepEqual(client.calls(),['GET','POST','GET']);
});

test('servidor antigo sem confirmação é impedido antes da escrita',async()=>{
  const calls=[];
  const ctx={firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token-test'}})},fetch:async(url,options)=>{calls.push(options.method);return response(200,{ok:true,companies:['Manuela Metais'],deletedCompanies:[],revision:4});},window:{__ERP_COMPANY_DIRECTORY_REVISION__:0},_companyKey:key,_erpAplicarCadastroEmpresas:()=>{},_erpRenderEmpresasAdministracao:()=>{}};
  runInNewContext(core.slice(start,end)+'\nthis.run=_erpEnviarEmpresa;',ctx);
  await assert.rejects(ctx.run('delete','Mabor'),/API de empresas desatualizada/);
  assert.deepEqual(calls,['GET']);
});

test('contrato da API valida revisão esperada e impede erro de ordem de gravação',()=>{
  const state={employeeCompanies:['Manuela Metais','Elaine'],companyDirectoryRevision:8};
  assert.equal(change(state,'delete','Elaine',7),null);
  const updated=change(state,'delete','Elaine',8);
  assert.equal(updated.companyDirectoryRevision,9);
  assert.ok(updated.deletedCompanies.includes('Elaine'));
  assert.ok(!updated.employeeCompanies.includes('Elaine'));
  assert.ok(state.employeeCompanies.includes('Elaine'));
  assert.match(api,/companyDirectoryRevision/);
  assert.match(api,/const expectedRevision=req\.body/);
});
