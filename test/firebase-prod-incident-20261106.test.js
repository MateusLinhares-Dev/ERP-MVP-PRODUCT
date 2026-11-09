import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,changeAdvance} from '../server/modules/advances/application/advances.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sync=read('public/legacy/firebase-sync.js');
const purchase=read('public/modules/purchase-order/purchase-order.js');
const copy=value=>value===undefined?undefined:structuredClone(value);

test('Firebase: carregar snapshot confirma base sem ReferenceError de _fbConfiavel',()=>{
  const start=sync.indexOf('  function _fbCarregarDaNuvem(callback,preservarLocalPendente) {');
  const end=sync.indexOf('  function _fbAtualizarAbaAtivaSilenciosamente()',start);
  assert.ok(start>=0&&end>start);
  let result=null,confirmed=0,remoteErrors=0;
  const ctx={
    window:{_fbDB:{},__FB_DATA_READY__:false},
    document:{getElementById:()=>({style:{}})},
    setTimeout:()=>12,clearTimeout:()=>{},
    _lerErpSemPesados:cb=>cb({_ts:123,adiantamentos:{}}),
    _verificarReset:()=>false,_normalizarDeletedV2EmD:()=>{},_aplicarConfigNegocio:()=>{},
    ADT_POR_FORN:{},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{},
    _fbRegistrarBaseConfirmada:()=>{confirmed++;},
    _fcRedesenharSeAberta:()=>{},_fbSetStatus:()=>{},
    localStorage:{setItem:()=>{},getItem:()=>null},
    console:{warn:(message)=>{if(String(message).includes('Firebase load error'))remoteErrors++;},log(){}}
  };
  runInNewContext(sync.slice(start,end)+';this.load=_fbCarregarDaNuvem;',ctx);
  ctx.load(ok=>{result=ok;});
  assert.equal(result,true);
  assert.equal(ctx.window.__FB_DATA_READY__,true);
  assert.equal(confirmed,1);
  assert.equal(remoteErrors,0);
});

test('Compra: saldo legado incerto não esconde outros adiantamentos pendentes',()=>{
  const start=purchase.indexOf('function historicalAppliedAdvances(');
  const end=purchase.indexOf('function currentState(',start);
  assert.ok(start>=0&&end>start);
  const clicks={'cssdv':{checked:false},'csadt-0':{checked:true},'csadt-1':{checked:false}};
  const ctx={
    ADT_POR_FORN:{F1:[{cod:'ADT12',valor:12,status:'Pendente',forma:'PIX'},{cod:'ADT124',valor:124,status:'Pendente',forma:'PIX'}]},
    CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{F1:{valor:200,ticket:'T284'}},
    tickets:()=>({T284:{ticket:'T284',fornecedorCod:'F1',status:'Pago',totalGeral:300,adiantamento:500}}),
    jsonDataset:()=>[],document:{getElementById:key=>clicks[key]||null},console
  };
  runInNewContext(purchase.slice(start,end)+';this.financialData=financialData;this.validatePurchaseCredits=validatePurchaseCredits;',ctx);
  const fin=ctx.financialData(null,'F1');
  assert.equal(fin.balance,0,'saldo antigo sem comprovante não é liberado');
  assert.deepEqual(Array.from(fin.adts,a=>a.cod),['ADT12','ADT124']);
  assert.ok(fin.issues.length,'aviso de conciliação permanece visível');
  assert.doesNotThrow(()=>ctx.validatePurchaseCredits({supplierCode:'F1',sourceTicketKeys:[],adts:fin.adts,cheques:fin.cheques,previousCredit:0}));
});

function dbFixture(){
  const state={erp:{bancos:{b:{cod:'B1',banco:'Conta Teste'}},fornecedores:{f:{cod:'F1',nome:'Fornecedor de teste'}},adiantamentos:{F1:[]}}};
  let failNextUpdate=false;
  const get=p=>p.split('/').filter(Boolean).reduce((o,k)=>o?.[k],state);
  const put=(path,value)=>{
    const parts=path.split('/').filter(Boolean);const name=parts.pop();let target=state;
    for(const p of parts)target=target[p]??={};
    if(value===null)delete target[name];else target[name]=copy(value);
  };
  return {state,get,failNext:()=>{failNextUpdate=true;},ref(path=''){
    return {
      async get(){return {val:()=>copy(get(path)??null)};},
      async transaction(fn){const old=copy(get(path)??null),next=fn(old);if(next===undefined)return {committed:false};put(path,next);return {committed:true};},
      async update(entries){if(failNextUpdate){failNextUpdate=false;throw new Error('Falha simulada no RTDB');}for(const [key,value] of Object.entries(entries))put([path,key].filter(Boolean).join('/'),value);}
    };
  }};
}
const who={uid:'user1',erpUser:'Operador',erpAccess:true,canAdvances:true};
const baseInput={fornCod:'F1',data:'2026-11-06',forma:'PIX',bancoCod:'B1',empresa:'Empresa',ticket:'',obs:''};
const op=n=>'a0d00000-'+String(n).padStart(4,'0')+'-4000-8000-'+String(n).padStart(12,'0');

test('Exclusão PIX: três operações sucessivas não deixam trava por fornecedor',async()=>{
  const db=dbFixture(),values=[12,124,15],saved=[];
  for(let i=0;i<values.length;i++){
    const created=await createAdvance(who,{...baseInput,operationId:op(i+1),valor:values[i]},{db});
    saved.push(created.advance);
    assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined,'trava liberada após criação');
  }
  for(let i=0;i<saved.length;i++){
    const result=await changeAdvance(who,{action:'delete',fornCod:'F1',adtCod:saved[i].cod,expected:saved[i],operationId:op(i+10)},{db});
    assert.equal(result.action,'delete');
    assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined,'trava liberada após exclusão');
  }
  assert.equal(db.get('erp/adiantamentos/F1').length,0);
  assert.equal(Object.keys(db.get('erp/lancBanco')||{}).length,0);
});

test('Falha antes de excluir não deixa trava; a operação seguinte pode excluir com segurança',async()=>{
  const db=dbFixture();
  const created=await createAdvance(who,{...baseInput,operationId:op(30),valor:124},{db});
  db.failNext();
  await assert.rejects(changeAdvance(who,{action:'delete',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance,operationId:op(31)},{db}),/Falha simulada/);
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined);
  assert.equal(db.get('erp/adiantamentos/F1').length,1);
  const deleted=await changeAdvance(who,{action:'delete',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance,operationId:op(32)},{db});
  assert.equal(deleted.action,'delete');
  assert.equal(db.get('erp/adiantamentos/F1').length,0);
});

test('Interface: exclusões rápidas do mesmo fornecedor são enviadas em fila, não em paralelo',async()=>{
  const code=read('public/modules/finance/advance-actions.js');
  let releaseFirst;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  const state={F1:[{cod:'A1',valor:12,data:'06/11/2026'},{cod:'A2',valor:124,data:'06/11/2026'}]};
  const calls=[],messages=[];
  const ctx={ADT_POR_FORN:state,FORNECEDORES:[{cod:'F1',nome:'Fornecedor de teste'}],
    confirm:()=>true,showToast:(message)=>messages.push(message),
    _adtCommitTransacional:async payload=>{
      calls.push(payload.adtCod);
      if(payload.adtCod==='A1')await firstGate;
      state.F1=state.F1.filter(row=>row.cod!==payload.adtCod);
      return {action:'delete',fornCod:'F1',entries:state.F1};
    },console};
  ctx.window=ctx;
  runInNewContext(code,ctx);
  const first=ctx.ERPAdvanceActions.deleteAdvance('F1','A1');
  const second=ctx.ERPAdvanceActions.deleteAdvance('F1','A2');
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['A1'],'a segunda exclusão aguarda confirmação da primeira');
  releaseFirst();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.deepEqual(calls,['A1','A2']);
  assert.equal(state.F1.length,0);
  assert.equal(messages.some(message=>message.includes('Não foi possível')),false);
});
