import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,changeAdvance} from '../server/modules/advances/application/advances.js';

const clone=x=>x===undefined?undefined:structuredClone(x);
function dbFixture(){
  const state={erp:{bancos:{b1:{cod:'B1',banco:'Conta de teste'}},fornecedores:{f1:{cod:'F1',nome:'Fornecedor de teste'}},adiantamentos:{F1:[]}}};
  const get=p=>p.split('/').filter(Boolean).reduce((o,k)=>o?.[k],state);
  const put=(p,v)=>{const parts=p.split('/').filter(Boolean),key=parts.pop();let parent=state;for(const k of parts)parent=parent[k]??={};if(v===null)delete parent[key];else parent[key]=clone(v);};
  return {state,get,ref(path=''){return {
    async get(){return {val:()=>clone(get(path)??null)};},
    async transaction(fn){const old=clone(get(path)??null),next=fn(old);if(next===undefined)return {committed:false};put(path,next);return {committed:true};},
    async update(values){for(const [key,value] of Object.entries(values))put([path,key].filter(Boolean).join('/'),value);}
  };}};
}
const who={uid:'operator',erpUser:'Operador',erpAccess:true,canAdvances:true};
const op=n=>'acafe000-'+String(n).padStart(4,'0')+'-4000-8000-'+String(n).padStart(12,'0');
const values={fornCod:'F1',data:'2026-11-06',forma:'PIX',bancoCod:'B1',empresa:'Teste',ticket:'',obs:'Homologacao'};
const make=async(db,n,valor)=>createAdvance(who,{...values,valor,operationId:op(n)},{db});
const remove=async(db,advance,n)=>changeAdvance(who,{action:'delete',fornCod:'F1',adtCod:advance.cod,expected:advance,operationId:op(n)},{db});

test('movimento adulterado é rejeitado ANTES do lock; próximo adiantamento íntegro continua excluível',async()=>{
  const db=dbFixture();
  const a=await make(db,1,124),b=await make(db,2,12);
  const reference=db.state.erp.lancBanco[a.bankMovement.id];
  reference.valor=1000;
  await assert.rejects(()=>remove(db,a.advance,3),{code:'BANK_LEDGER_CHANGED',status:409});
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined,'erro de integridade não deve reservar o fornecedor');
  assert.equal(db.get('erp/adiantamentos/F1').length,2,'não pode excluir o registro divergente');
  const next=await remove(db,b.advance,4);
  assert.equal(next.action,'delete');
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined);
  assert.equal(db.get('erp/lancBanco/'+b.bankMovement.id),undefined);
  assert.equal(db.get('erp/adiantamentos/F1').length,1);
  reference.valor=124;
  await remove(db,a.advance,5);
  assert.equal(db.get('erp/adiantamentos/F1').length,0);
});

test('movimento faltante ou com identificador errado nunca é excluído por aproximação de valor',async()=>{
  const db=dbFixture();
  const a=await make(db,6,124);
  db.state.erp.lancBanco[a.bankMovement.id].advanceCode='OUTRO';
  await assert.rejects(()=>remove(db,a.advance,7),{code:'BANK_LEDGER_CHANGED'});
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined);
  delete db.state.erp.lancBanco[a.bankMovement.id];
  await assert.rejects(()=>remove(db,a.advance,8),{code:'BANK_LEDGER_CHANGED'});
  assert.equal(db.get('erp/adiantamentos/F1').length,1);
});

test('extrato bancário bloqueia a edição/exclusão direta de movimentos de adiantamentos',async()=>{
  const { isAutomatic } = await import('../web/modules/banking/domain/statement-view.ts');
  const links={advanceMovementIds:new Set(['LB-OLD']),chequeMovementIds:new Set()};
  assert.equal(isAutomatic({id:'LB-1',descricao:'Adiantamento: Fornecedor de teste'},links),true);
  assert.equal(isAutomatic({id:'LB-OLD',descricao:'Descricao alterada'},links),true);
  assert.equal(isAutomatic({id:'LB-OTHER',descricao:'Compra independente'},links),false);
  const { lockedMovement } = await import('../server/modules/banking/domain/bank-ledger-rules.ts');
  assert.match(lockedMovement({id:'LB-OLD'},links).message,/Financeiro → Adiantamentos/);
});

test('sincronização geral não envia extrato nem contas bancárias: só o servidor grava',()=>{
  const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
  assert.doesNotMatch(sync,/_patchIncremental\(dados,\s*'lancBanco'/);
  assert.doesNotMatch(sync,/_patchIncremental\(dados,\s*'bancos'/);
  assert.doesNotMatch(sync,/lancBancoDeleted: \[/);
  assert.doesNotMatch(sync,/bancosDeleted: \[/);
});

