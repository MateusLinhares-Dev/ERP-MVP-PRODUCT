// Transações do NAVEGADOR exercitadas com o SDK compat real (@firebase/database-compat,
// o mesmo código do firebase-database-compat.js carregado no browser) contra o
// servidor RTDB simulado. Reproduz o "editar vale sempre falha" causado pelo
// cache frio e prova a correção (window.__erpRunTransaction).
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {startFakeRtdb} from './support/fake-rtdb-server.mjs';

const require=createRequire(import.meta.url);
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
let srv,app,db;

function slice(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'trecho não encontrado: '+start);
  return source.slice(a,b);
}
function browserHelpers(){
  const window={};
  runInNewContext(slice(sync,'  window.__erpServerNow = function(){','  const _APP_BUILD')+'',{window,setTimeout,clearTimeout,Date,Math,Number,String,Promise,Error});
  return window;
}

before(async()=>{
  srv=await startFakeRtdb({namespace:'demo-client-test'});
  process.env.FIREBASE_DATABASE_EMULATOR_HOST=srv.host;
  const {initializeApp}=require('firebase-admin/app');
  const {getDatabase}=require('firebase-admin/database');
  app=initializeApp({projectId:'demo-client-test',databaseURL:srv.databaseURL},'client-sdk-test');
  db=getDatabase(app);
});
after(async()=>{try{await app?.delete();}catch{}await srv?.close();});

test('cliente: helper de transação parte do valor real (cache frio não aborta edição condicional)',async()=>{
  srv.reset({erp:{vales:{V1:{id:'V1',valor:10}}}});
  const ref=db.ref('erp/vales/V1');
  const legacy=await ref.transaction(current=>current&&current.valor===10?{...current,valor:20}:undefined,undefined,false);
  assert.equal(legacy.committed,false,'padrão antigo aborta com cache frio');
  const {__erpRunTransaction}=browserHelpers();
  const fixed=await __erpRunTransaction(ref,current=>current&&current.valor===10?{...current,valor:20}:undefined);
  assert.equal(fixed.committed,true);
  assert.equal((await ref.get()).val().valor,20);
});

test('cliente: editar e excluir vale funcionam com cache frio (antes: "modificado em outra sessão")',async()=>{
  srv.reset({erp:{vales:{VL1:{id:'VL1',mat:'F7',valor:50,data:'01/11/2026'}}}});
  const window=browserHelpers();
  window._fbDB=db;
  const VALES_DB=[{id:'VL1',mat:'F7',valor:50,data:'01/11/2026'}];
  const removed=[];
  const ctx={window,firebase:{auth:()=>({currentUser:{uid:'erp:rh'}})},VALES_DB,
    _syncVales:{remover:id=>{removed.push(id);const i=VALES_DB.findIndex(v=>v.id===id);if(i>=0)VALES_DB.splice(i,1);},marcarConfirmado(){}},
    localStorage:{setItem(){}},JSON,Object,Array,String,Error,Promise};
  runInNewContext(slice(core,'function _valeConfirmadoLocal(item,excluir=false){','async function salvarValeFunc(){')+
    ';this.edit=_valeAtualizarSeguro;this.del=_valeExcluirSeguro;',ctx);
  const previous=structuredClone(VALES_DB[0]);
  const next={...previous,valor:75};
  await ctx.edit(previous,next);
  assert.equal((await db.ref('erp/vales/VL1').get()).val().valor,75);
  await ctx.del(next);
  assert.equal((await db.ref('erp/vales/VL1').get()).val(),null,'o registro é removido, não só marcado');
  assert.equal((await db.ref('erp/valesDeleted/VL1').get()).val(),true);
  assert.deepEqual(removed,['VL1']);
});

test('cliente: vale alterado em outra sessão continua protegido',async()=>{
  srv.reset({erp:{vales:{VL2:{id:'VL2',mat:'F7',valor:99}}}});
  const window=browserHelpers();window._fbDB=db;
  const ctx={window,firebase:{auth:()=>({currentUser:{uid:'erp:rh'}})},VALES_DB:[],_syncVales:{remover(){},marcarConfirmado(){}},localStorage:{setItem(){}}};
  runInNewContext(slice(core,'function _valeConfirmadoLocal(item,excluir=false){','async function salvarValeFunc(){')+';this.edit=_valeAtualizarSeguro;',ctx);
  await assert.rejects(ctx.edit({id:'VL2',mat:'F7',valor:10},{id:'VL2',mat:'F7',valor:11}),/outra sessão/);
  assert.equal((await db.ref('erp/vales/VL2').get()).val().valor,99);
});

test('cliente: horário do servidor usado em _ts (PC com relógio errado não bloqueia salvamentos)',()=>{
  const window=browserHelpers();
  window.__ERP_SERVER_TIME_OFFSET__=-3600000;
  const now=Date.now();
  assert.ok(Math.abs(window.__erpServerNow()-(now-3600000))<1000);
  assert.match(sync,/_ts: \(typeof window\.__erpServerNow === 'function' \? window\.__erpServerNow\(\) : Date\.now\(\)\)/);
  assert.match(sync,/\.info\/serverTimeOffset/);
});

test('cliente: mapas são gravados por registro, nunca como nó inteiro',()=>{
  const start=sync.indexOf('      const _valoresDelArrAtual = _deletedArrPularSeIgual(dados);');
  const end=sync.indexOf('      const _ticketsParaSalvar = {};',start);
  assert.ok(start>0&&end>start);
  const code=sync.slice(start,end);
  const dados={precosForn:{F1:{COBRE:10}},precosCli:{C1:{ALU:5}},saldoDevedor:{F1:{valor:1}},custosCasa:{'2026-11':[1]},
    fiscal:{'2026-11':{entradas:[]}},fiscalApur:{x:{}},fornVeiculos:{F1:['ABC']},metais:['COBRE']};
  const ctx={dados,_deletedArrPularSeIgual:()=>({}),PRECOS_FORN_DATA:dados.precosForn,PRECOS_CLI_DATA:dados.precosCli,
    SALDO_DEVEDOR_FORN:{F1:{valor:1}},CUSTO_CASA:dados.custosCasa,FISCAL_DB:dados.fiscal,FISCAL_APUR:dados.fiscalApur,
    _DEL_SETS:{saldoDevedor:new Set(['F9'])},
    _patchIncremental:(target,path,obj,del)=>{Object.keys(obj||{}).forEach(k=>{target[path+'/'+k]=obj[k];});if(del)del.forEach(k=>{if(!(k in obj))target[path+'/'+k]=null;});}};
  runInNewContext(code,ctx);
  for(const root of ['precosForn','precosCli','saldoDevedor','custosCasa','fiscal','fiscalApur','fornVeiculos'])
    assert.equal(root in dados,false,root+' não pode ser gravado inteiro');
  assert.deepEqual(dados['precosForn/F1'],{COBRE:10});
  assert.deepEqual(dados['saldoDevedor/F1'],{valor:1});
  assert.equal(dados['saldoDevedor/F9'],null,'exclusão local vira remoção do registro');
  assert.deepEqual(dados['fiscal/2026-11'],{entradas:[]});
  assert.deepEqual(dados.metais,['COBRE'],'listas continuam como antes');
});

test('cliente: fiscalSalvar envia somente meses alterados com update (sem set do nó inteiro)',async()=>{
  const start=core.indexOf('function fiscalSalvar(){'),end=core.indexOf('function _fiscalNorm(',start);
  const calls=[];
  const _fbEnviadoOk={'fiscal/2026-10':JSON.stringify({entradas:[1]})};
  const ctx={FISCAL_DB:{'2026-10':{entradas:[1]},'2026-11':{entradas:[2]}},_fbEnviadoOk,localStorage:{setItem(){}},console,
    window:{_fbDB:{ref:path=>({update:async patch=>{calls.push([path,patch]);},set:async()=>{throw new Error('set proibido');}})}},showToast(){}};
  runInNewContext(core.slice(start,end)+';fiscalSalvar();',ctx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(calls),JSON.stringify([['erp/fiscal',{'2026-11':{entradas:[2]}}]]));
  assert.equal(_fbEnviadoOk['fiscal/2026-11'],JSON.stringify({entradas:[2]}));
});

test('bancos: conta com lançamentos ou adiantamento pendente não pode ser excluída',()=>{
  const start=core.indexOf('function excluirBanco(idx){'),end=core.indexOf('function zerarSaldosBancos(',start);
  const alerts=[];let removed=0;
  const make=(lanc,adts)=>{
    const ctx={BANCOS_DB:[{cod:'B1',banco:'Conta'}],LANC_BANCO_DB:lanc,ADT_POR_FORN:adts,
      alert:m=>alerts.push(m),confirm:()=>true,_syncBancos:{remover(){removed++;}},saveBancos(){},renderBancos(){},cm(){}};
    runInNewContext(core.slice(start,end)+';excluirBanco(0);',ctx);
  };
  make([{bancoCod:'B1',valor:10}],{});
  make([],{F1:[{cod:'A',bancoCod:'B1',status:'Pendente'}]});
  assert.equal(removed,0);assert.equal(alerts.length,2);
  make([{bancoCod:'B2'}],{F1:[{cod:'A',bancoCod:'B1',status:'Quitado'}]});
  assert.equal(removed,1);
});

test('compra: criação repete com o MESMO operationId em instabilidade (503) e conclui',async()=>{
  const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
  const start=purchase.indexOf('async function purchaseCreateAtomic(');
  const end=purchase.indexOf('function sourceSignature(',start);
  const bodies=[];let call=0;
  const ticket={ticket:'T500',totalGeral:10,_purchaseOperationId:'op'};
  const ctx={
    global:{firebase:{auth:()=>({currentUser:{getIdToken:async()=>'tok'}})}},
    document:{getElementById:()=>null},
    fetch:async(url,options)=>{bodies.push(JSON.parse(options.body));call++;
      if(call===1)return {ok:false,status:503,json:async()=>({code:'DATABASE_UNAVAILABLE',message:'oscilou',retryAfterSeconds:1})};
      return {ok:true,status:200,json:async()=>({ticket,advances:[],cheques:[],saldo:null,payable:null})};},
    setTimeout:(fn)=>fn(),showToast(){},
    TICKETS_DB:{},ADT_POR_FORN:{},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{},CONTAS_PAGAR:[],localStorage:{setItem(){}},
    purchaseRememberServerAck(){},JSON,Promise,Object,Array,String,Number,Math,Error};
  runInNewContext(purchase.slice(start,end)+';this.create=purchaseCreateAtomic;',ctx);
  const saved=await ctx.create('T500',ticket,{adts:[],cheques:[],supplierCode:'F1',sourceTicketKeys:[]},{dataset:{purchaseOperationId:'11111111-1111-4111-8111-111111111111'}});
  assert.equal(saved.ticket,'T500');
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].operationId,bodies[1].operationId,'mesma operação: servidor idempotente');
});
