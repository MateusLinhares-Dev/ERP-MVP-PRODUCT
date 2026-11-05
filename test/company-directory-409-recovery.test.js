import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {changeCompanyDirectory,companyDirectoryResponse} from '../server/domain/company-directory.js';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const start=core.indexOf('let _erpEmpresaAlteracaoEmCurso=false;');
const end=core.indexOf('\nasync function _erpMudarSituacaoEmpresa(',start);
const key=value=>String(value||'').trim().toLowerCase();
const copy=value=>JSON.parse(JSON.stringify(value));
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>copy(data)});

function setup(initial,{interleave}={}){
  let state=copy(initial),overlapped=false;
  const calls=[];
  const ctx={
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token-test'}})},
    window:{__ERP_COMPANY_DIRECTORY_REVISION__:0},
    _companyKey:key,
    _erpAplicarCadastroEmpresas:result=>{ctx.window.__ERP_COMPANY_DIRECTORY_REVISION__=result.revision;ctx.window.__ERP_COMPANY_DIRECTORY_STATE__=copy(result);return true;},
    _erpRenderEmpresasAdministracao:()=>{},
    fetch:async(_,options)=>{
      calls.push(options.method);
      if(options.method==='GET')return response(200,companyDirectoryResponse(state));
      const body=JSON.parse(options.body);
      if(interleave&&!overlapped){overlapped=true;state=changeCompanyDirectory(state,'create','Outra Empresa',state.revision);}
      const result=changeCompanyDirectory(state,body.action,body.name,body.expectedRevision);
      if(!result)return response(409,{message:'O cadastro foi atualizado em outra sessão.'});
      state=copy(result);
      return response(200,companyDirectoryResponse(state));
    }
  };
  runInNewContext(core.slice(start,end)+'\nthis.run=_erpEnviarEmpresa;',ctx);
  return {run:ctx.run,calls,read:()=>copy(state)};
}

test('empresa excluída pode ser recadastrada explicitamente sem ressuscitar os demais nomes',async()=>{
  const seed={schemaVersion:3,revision:12,primaryCompanyKey:'Manuela Metais',companies:['Manuela Metais','Mabor','Gratus'],deletedCompanies:['RAFAEL','Teste']};
  const client=setup(seed);
  await client.run('create','rafael');
  assert.deepEqual(client.read().companies,['Manuela Metais','Mabor','Gratus','rafael']);
  assert.deepEqual(client.read().deletedCompanies,['Teste']);
  await client.run('delete','rafael');
  assert.deepEqual(client.read().companies,['Manuela Metais','Mabor','Gratus']);
  assert.deepEqual(client.read().deletedCompanies,['Teste','rafael']);
  await client.run('create','Rafael');
  assert.deepEqual(client.read().companies,['Manuela Metais','Mabor','Gratus','Rafael']);
  assert.deepEqual(client.read().deletedCompanies,['Teste']);
  assert.equal(client.read().revision,15);
  assert.deepEqual(client.calls,['GET','POST','GET','POST','GET','POST']);
});

test('conflito de revisão atualiza o estado e tenta uma vez sem substituir empresas concorrentes',async()=>{
  const seed={schemaVersion:3,revision:4,primaryCompanyKey:'Manuela Metais',companies:['Manuela Metais','Mabor']};
  const client=setup(seed,{interleave:true});
  await client.run('create','Rafael');
  assert.deepEqual(client.read().companies,['Manuela Metais','Mabor','Outra Empresa','Rafael']);
  assert.equal(client.read().revision,6);
  assert.deepEqual(client.calls,['GET','POST','GET','POST']);
});

test('lista de administração apresenta somente empresas do cadastro confirmado pelo servidor',()=>{
  const a=core.indexOf('function _erpRenderEmpresasAdministracao(){');
  const b=core.indexOf('\nlet _erpEmpresaAlteracaoEmCurso=false;',a);
  assert.ok(a>=0&&b>a);
  const host={innerHTML:'',querySelectorAll:()=>[]};
  const ctx={
    document:{getElementById:id=>id==='rh-empresas-atuais'?host:null},
    window:{__ERP_COMPANY_DIRECTORY_STATE__:{companies:['Manuela Metais','Mabor'],inactiveCompanies:[],deletedCompanies:['RAFAEL'],revision:11}},
    ERP_BUSINESS_CONFIG:{primaryCompanyKey:'Manuela Metais',expenseGroups:['Empresa Fantasma'],chequeCompanies:['RAFAEL']},
    _cfgPublicBusiness:()=>({}),_companyKey:key,esc:value=>String(value)
  };
  runInNewContext(core.slice(a,b)+'\nthis.render=_erpRenderEmpresasAdministracao;',ctx);
  ctx.render();
  assert.match(host.innerHTML,/Mabor/);
  assert.match(host.innerHTML,/Manuela Metais/);
  assert.doesNotMatch(host.innerHTML,/Empresa Fantasma|RAFAEL/);
});
