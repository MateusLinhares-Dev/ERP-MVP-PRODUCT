import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('public/legacy/app-core.js');
const api=read('api/admin/employee-companies.js');
const sync=read('public/legacy/firebase-sync.js');

function companyClient(fetcher){
  const start=core.indexOf('let _erpEmpresaAlteracaoEmCurso=false;');
  const end=core.indexOf('\nasync function _erpMudarSituacaoEmpresa(',start);
  assert.ok(start>=0&&end>start);
  const applied=[];
  const ctx={
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token-test'}})},
    fetch:fetcher,
    _companyKey:value=>String(value||'').toLowerCase(),
    _erpAplicarCadastroEmpresas:result=>{applied.push(result);return true;},
    _erpRenderEmpresasAdministracao:()=>{},
    window:{__ERP_COMPANY_DIRECTORY_REVISION__:0}
  };
  runInNewContext(core.slice(start,end)+'\nthis.run=_erpEnviarEmpresa;',ctx);
  return {run:ctx.run,applied};
}
const respond=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('POST atualizado usa GET antes de gravar e confirma revisao',async()=>{
  const calls=[];
  const client=companyClient(async(url,options)=>{
    calls.push(options.method);
    if(options.method==='GET')return respond(200,{ok:true,companies:['Manuela Metais'],inactiveCompanies:[],deletedCompanies:[],revision:2,apiVersion:2});
    assert.equal(JSON.parse(options.body).expectedRevision,2);
    return respond(200,{ok:true,companies:['Manuela Metais','Rafael'],inactiveCompanies:[],deletedCompanies:[],revision:3,apiVersion:2});
  });
  const result=await client.run('create','Rafael');
  assert.equal(result.revision,3);
  assert.deepEqual(calls,['GET','POST']);
  assert.equal(client.applied.length,2);
});

test('POST sem revisão pode ser confirmado por GET sem reenviar escrita',async()=>{
  const calls=[];
  let created=false;
  const client=companyClient(async(url,options)=>{
    calls.push(options.method);
    if(options.method==='POST'){
      created=true;
      return respond(200,{ok:true,companies:['Manuela Metais','Rafael'],deletedCompanies:[]});
    }
    return respond(200,{ok:true,companies:created?['Manuela Metais','Rafael']:['Manuela Metais'],inactiveCompanies:[],deletedCompanies:[],revision:8,apiVersion:2});
  });
  const result=await client.run('create','Rafael');
  assert.equal(result.revision,8);
  assert.deepEqual(calls,['GET','POST','GET']);
});

test('API legada é bloqueada ANTES do POST e não provoca gravação ambígua',async()=>{
  const calls=[];
  const client=companyClient(async(url,options)=>{
    calls.push(options.method);
    return respond(405,{message:'Method Not Allowed'});
  });
  await assert.rejects(client.run('create','Rafael'),/API de empresas desatualizada na Vercel/);
  assert.deepEqual(calls,['GET']);
  assert.equal(client.applied.length,0);
});

test('servidor que recusa POST não tem segundo envio',async()=>{
  const calls=[];
  const client=companyClient(async(url,options)=>{
    calls.push(options.method);
    if(options.method==='GET')return respond(200,{ok:true,companies:['Manuela Metais','Rafael'],inactiveCompanies:[],deletedCompanies:[],revision:2,apiVersion:2});
    return respond(403,{message:'Permissao negada'});
  });
  await assert.rejects(client.run('delete','Rafael'),/Permissao negada/);
  assert.deepEqual(calls,['GET','POST']);
});

test('GET administrativo permite leitura de confirmacao com revisao e nao expõe dados sem identidade',()=>{
  assert.match(api,/if\(req\.method==='GET'\)/);
  assert.match(api,/await requireIdentity\(req,\{admin:true\}\)/);
  assert.match(api,/Cache-Control','no-store'/);
  assert.match(api,/revision:Number\(cfg\.companyDirectoryRevision\)\|\|0,apiVersion:2/);
});

test('salvamento global aguarda todos os grupos e identifica a colecao rejeitada',async()=>{
  const start=sync.indexOf('async function _enviarMapaErp(dados){');
  const end=sync.indexOf('\n  async function _enviarDadosEmLotes(',start);
  assert.ok(start>=0&&end>start);
  let successful=false;
  const ctx={
    Promise,
    _agruparAtualizacoesErp:()=>({vales:{temValor:false,patch:{a:1}},tickets:{temValor:false,patch:{b:2}}}),
    _comTimeoutFirebase:promise=>promise,
    window:{_fbDB:{ref:path=>({update:async()=>{
      if(path==='erp/vales')throw new Error('permission_denied');
      await new Promise(resolve=>setTimeout(resolve,5));
      successful=true;
    }})}}
  };
  runInNewContext(sync.slice(start,end)+'\nthis.run=_enviarMapaErp;',ctx);
  await assert.rejects(ctx.run({}),/erp\/vales.*permission_denied/);
  assert.equal(successful,true);
});
