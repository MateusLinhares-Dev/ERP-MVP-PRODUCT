import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeReconciliation} from '../server/application/reconciliation-service.js';

const identity={uid:'UID',erpUser:'elaine',erpAccess:true,canBanking:true,canFinance:true};
const imported={I1:{id:'I1',date:'2026-10-22',amountCents:'-150000',description:'Fornecedor ABC'}};
function fakeDb(legacyStatus,currentStatus){
  const data={erp:{
    bancos:{item:{cod:'BC-001',banco:'Teste'}},lancBanco:{},
    contasPagar:{P1:{id:'P1',valor:1500,desc:'Fornecedor ABC',venc:'22/10/2026'}},
    contasReceber:{},bankReconciliationImports:{'BC-001':imported},
    bankReconciliationEvents:{'BC-001':{event:{id:'event',importId:'I1',status:legacyStatus,createdAt:1000,targetId:'P1',targetKind:'payable'}}},
    bankReconciliationState:{'BC-001':{decisions:{I1:{id:'active',importId:'I1',status:currentStatus,createdAt:2000,allocations:currentStatus==='reconciled'?[{kind:'payable',id:'P1',amountCents:'150000'}]:[]}},audit:{},revision:1}}
  }};
  const get=p=>p.split('/').reduce((obj,key)=>obj?.[key],data);
  const set=(p,value)=>{const keys=p.split('/');let obj=data;for(const key of keys.slice(0,-1))obj=obj[key]??={};obj[keys.at(-1)]=value;};
  return {data,ref:p=>({async get(){return {val:()=>get(p)??null};},async transaction(fn){const old=get(p)??null;const value=fn(old);if(value===undefined)return {committed:false,snapshot:{val:()=>old}};set(p,value);return {committed:true,snapshot:{val:()=>value}};}})};
}
const code='BC-001';
const newPlan={bankCode:code,importId:'I1',action:'reconcile',allocations:[{kind:'payable',id:'P1',amountCents:'150000'}]};

test('snapshot do servidor prevalece sobre evento legado reaberto quando vínculo transacional segue ativo',async()=>{
  const db=fakeDb('reversed','reconciled');
  const snapshot=await executeReconciliation(identity,{action:'snapshot',bankCode:code},{db});
  assert.equal(snapshot.legacyDecisions.I1.status,'reversed');
  assert.equal(snapshot.effectiveDecisions.I1.status,'reconciled');
  await assert.rejects(()=>executeReconciliation(identity,newPlan,{db}),{status:409});
  const undo=await executeReconciliation(identity,{action:'undo',bankCode:code,importId:'I1'},{db});
  assert.equal(undo.records[0].status,'reversed');
  const after=await executeReconciliation(identity,{action:'snapshot',bankCode:code},{db});
  assert.equal(after.effectiveDecisions.I1.status,'reversed');
  const again=await executeReconciliation(identity,newPlan,{db});
  assert.equal(again.records[0].status,'reconciled');
});

test('snapshot não reativa conciliação legada quando a transação já foi revertida',async()=>{
  const db=fakeDb('reconciled','reversed');
  const snapshot=await executeReconciliation(identity,{action:'snapshot',bankCode:code},{db});
  assert.equal(snapshot.effectiveDecisions.I1.status,'reversed');
  const again=await executeReconciliation(identity,newPlan,{db});
  assert.equal(again.records[0].status,'reconciled');
});

test('interface não permite que listener Firebase sobrescreva decisão autorizada pela API',()=>{
  const ui=readFileSync(new URL('../public/modules/banking/reconciliation-ui.js',import.meta.url),'utf8');
  assert.match(ui,/effectiveDecisions=result\.effectiveDecisions/);
  assert.match(ui,/return new Map\(Object\.entries\(workspace\?\.effectiveDecisions\|\|\{\}\)\)/);
  assert.match(ui,/if\(key!=='state'\)/);
  assert.match(ui,/scheduleSnapshotRefresh\(\)/);
  assert.match(ui,/notify\(''\);state\.selected=open\.dataset\.open/);
  assert.match(ui,/data-undo-partial/);
});
