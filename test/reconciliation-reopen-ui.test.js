import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeReconciliation} from '../server/application/reconciliation-service.js';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const identity={uid:'U1',erpUser:'elaine',erpAccess:true,canBanking:true,canFinance:true};
const imp={I1:{id:'I1',amountCents:'-150000',date:'2026-10-22',description:'Fornecedor ABC'}};
function testDb({legacyStatus,currentStatus}={}){
  const data={erp:{
    bancos:{b:{cod:'BC-001',banco:'Banco'}},lancBanco:{},
    contasPagar:{P1:{id:'P1',valor:1500,desc:'Fornecedor ABC',venc:'22/10/2026'}},contasReceber:{},
    bankReconciliationImports:{'BC-001':imp},
    bankReconciliationEvents:{'BC-001':legacyStatus?{OLD:{id:'OLD',importId:'I1',status:legacyStatus,createdAt:100000,actor:'outro',targetId:'P1',targetKind:'payable'}}:{}},
    bankReconciliationState:{'BC-001':currentStatus?{decisions:{I1:{id:'NEW',importId:'I1',status:currentStatus,createdAt:50000,allocations:currentStatus==='reconciled'?[{id:'P1',kind:'payable',amountCents:'150000'}]:[]}},audit:{},revision:2}:undefined}
  }};
  const val=path=>path.split('/').reduce((v,k)=>v?.[k],data);
  const save=(path,newValue)=>{const keys=path.split('/');let v=data;for(const k of keys.slice(0,-1))v=v[k]??={};v[keys.at(-1)]=newValue;};
  return {data,ref(path){return {async get(){return {val:()=>val(path)??null}},async transaction(fn){const previous=val(path)??null,next=fn(previous);if(next===undefined)return {committed:false,snapshot:{val:()=>previous}};save(path,next);return {committed:true,snapshot:{val:()=>next}};}}}};
}

test('snapshot expõe a decisão transacional que prevalece sobre evento legado revertido',async()=>{
  const db=testDb({legacyStatus:'reversed',currentStatus:'reconciled'});
  const snap=await executeReconciliation(identity,{action:'snapshot',bankCode:'BC-001'},{db});
  assert.equal(snap.legacyDecisions.I1.status,'reversed');
  assert.equal(snap.state.decisions.I1.status,'reconciled');
  await assert.rejects(()=>executeReconciliation(identity,{action:'reconcile',bankCode:'BC-001',importId:'I1',allocations:[{kind:'payable',id:'P1',amountCents:'150000'}]},{db}),/já conciliada/);
  const undo=await executeReconciliation(identity,{action:'undo',bankCode:'BC-001',importId:'I1'},{db});
  assert.equal(undo.records[0].status,'reversed');
});

test('reabertura confirmada pelo servidor permite uma nova conciliação sem duplicidade',async()=>{
  const db=testDb({legacyStatus:'reconciled',currentStatus:'reversed'});
  const snap=await executeReconciliation(identity,{action:'snapshot',bankCode:'BC-001'},{db});
  assert.equal(snap.state.decisions.I1.status,'reversed');
  const result=await executeReconciliation(identity,{action:'reconcile',bankCode:'BC-001',importId:'I1',allocations:[{kind:'payable',id:'P1',amountCents:'150000'}]},{db});
  assert.equal(result.records[0].status,'reconciled');
  assert.equal(db.data.erp.bankReconciliationState['BC-001'].decisions.I1.status,'reconciled');
});

test('interface disponibiliza desfazer/reabrir, snapshot e estado de arquivados separado',()=>{
  const ui=read('public/modules/banking/reconciliation-ui.js');
  assert.match(ui,/data-quick-undo/);
  assert.match(ui,/Reabrir movimentação/);
  assert.match(ui,/Desfazer conciliação/);
  assert.match(ui,/legacyDecisions=result\.legacyDecisions/);
  assert.match(ui,/await refreshTargets\(\);/);
  assert.match(ui,/\['reconciled','classified','partial','archived'\]/);
  assert.match(ui,/data-stat="archived"/);
  assert.match(read('public/modules/banking/reconciliation.css'),/erp-rec-quick-undo/);
});
