import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeReconciliation} from '../server/application/reconciliation-service.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const user={uid:'test',erpUser:'elaine',erpAccess:true,canBanking:true,canFinance:true};
function fakeDatabase(){
  const raw={erp:{bancos:{b1:{cod:'BC-001',banco:'Banco'}},bankReconciliationImports:{'BC-001':{IMP1:{id:'IMP1',amountCents:'-150000',date:'2026-10-26',description:'Fornecedor ABC'}}},bankReconciliationEvents:{'BC-001':{old:{importId:'IMP1',status:'reconciled',createdAt:1,targetKind:'payable',targetId:'T-OLD'}}},bankReconciliationState:{'BC-001':{decisions:{IMP1:{importId:'IMP1',status:'reversed',allocations:[],createdAt:2}},audit:{},revision:1}},lancBanco:{},contasPagar:{},contasReceber:{}}};
  const get=path=>path.split('/').reduce((o,k)=>o?.[k],raw);
  const set=(path,value)=>{const seg=path.split('/');const last=seg.pop();let out=raw;for(const key of seg)out=out[key]??={};out[last]=value;};
  return {raw,ref:path=>({async get(){return {val:()=>get(path)??null};},async transaction(fn){const previous=get(path)??null;const after=fn(previous);if(after===undefined)return {committed:false,snapshot:{val:()=>previous}};set(path,after);return {committed:true,snapshot:{val:()=>after}};}})};
}
test('More menu lives outside bank table and retains actions',()=>{
  const source=read('public/legacy/app-core.js');
  assert.match(source, /data-bank-more=/);
  assert.match(source,/document\.body\.appendChild\(popover\)/);
  assert.match(source,/\['_?Editar conta','editBanco'\]/);
  assert.match(source,/\['Compartilhar','compartilharBanco'\]/);
  assert.match(source,/\['Excluir conta','excluirBanco'\]/);
  assert.doesNotMatch(source, /<details class="erp-bank-row-more">/);
  const css=read('public/modules/banking/bank-integrations.css');
  assert.match(css,/\.erp-bank-more-popover\{position:fixed/);
});
test('reconciliação não disfarça conflito de arquivamento como sucesso',()=>{
  const ui=read('public/modules/banking/reconciliation-ui.js');
  assert.match(ui,/body\.action==='undo'&&current==='reversed'/);
  assert.match(ui,/Arquivar sem conciliar/);
  assert.match(ui,/due\(\)===0n\?'disabled'/);
  assert.match(read('public/modules/banking/reconciliation.css'),/\.erp-rec-more-actions\[open\]>/);
});
test('movimento reaberto pode ser arquivado com evento legado ainda conciliado',async()=>{
  const db=fakeDatabase();
  const original=await executeReconciliation(user,{bankCode:'BC-001',action:'snapshot'},{db});
  assert.equal(original.effectiveDecisions.IMP1.status,'reversed');
  const result=await executeReconciliation(user,{bankCode:'BC-001',importId:'IMP1',action:'archive'},{db});
  assert.equal(result.records[0].status,'archived');
  const newState=await executeReconciliation(user,{bankCode:'BC-001',action:'snapshot'},{db});
  assert.equal(newState.effectiveDecisions.IMP1.status,'archived');
  await assert.rejects(()=>executeReconciliation(user,{bankCode:'BC-001',importId:'IMP1',action:'archive'},{db}),{status:409});
  await executeReconciliation(user,{bankCode:'BC-001',importId:'IMP1',action:'undo'},{db});
  const reopened=await executeReconciliation(user,{bankCode:'BC-001',action:'snapshot'},{db});
  assert.equal(reopened.effectiveDecisions.IMP1.status,'reversed');
  assert.equal(Object.keys(db.raw.erp.lancBanco).length,0);
});
