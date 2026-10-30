import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ABS,decimalCents,validatePlan,remainingForTarget,suggestions,suggestCombinations,batchSuggestions} from '../public/modules/banking/reconciliation-engine.mjs';
import {executeReconciliation} from '../server/application/reconciliation-service.js';
const identity={uid:'uid-A',erpUser:'Elaine',erpAccess:true,canBanking:true,canFinance:true,canReceivables:true};
const imp=(id,n)=>({id,date:'2026-10-26',amountCents:String(n),description:'Compra fornecedores'});
const targets=[{id:'p1',kind:'payable',date:'2026-10-26',description:'Compra fornecedor',amount:60},{id:'p2',kind:'payable',date:'2026-10-26',description:'Compra fornecedor',amount:40},
  {id:'p3',kind:'payable',date:'2026-10-26',description:'Compra fornecedor',amount:100}];
const allocation=(id,n)=>({kind:'payable',id,amountCents:String(n)});
function mockDb(){
  const store={erp:{bancos:{b:{cod:'B1',banco:'Banco'},c:{cod:'B2',banco:'Banco 2'}},lancBanco:{},contasPagar:{p1:{id:'p1',valor:60,desc:'Compra fornecedor',venc:'26/10/2026'},p2:{id:'p2',valor:40,desc:'Compra fornecedor',venc:'26/10/2026'},p3:{id:'p3',valor:100,desc:'Compra fornecedor',venc:'26/10/2026'}},contasReceber:{},bankReconciliationImports:{B1:{i1:imp('i1','-10000'),i2:imp('i2','-5000'),i3:imp('i3','-6000')},B2:{i4:imp('i4','-6000')}},bankReconciliationEvents:{},bankReconciliationState:{}}};
  const get=path=>String(path).split('/').reduce((o,k)=>o?.[k],store);
  const set=(path,val)=>{const keys=String(path).split('/');let obj=store;for(const k of keys.slice(0,-1))obj=obj[k]??={};obj[keys.at(-1)]=val;};
  return {store,ref(path){return {async get(){return {val:()=>get(path)||null}},async transaction(fn){const prev=get(path)??null,next=fn(prev);if(next===undefined)return {committed:false,snapshot:{val:()=>prev}};set(path,next);return {committed:true,snapshot:{val:()=>next}}}}}};
}
test('centavos exatos sem floats, rejeita plano incompatível e excesso',()=>{
  assert.equal(decimalCents('R$ 1.234,56'),123456n);
  assert.equal(decimalCents('0,01'),1n);
  assert.throws(()=>decimalCents('1e999'));
  const plan=validatePlan({imported:imp('i1','-10000'),targets,allocations:[allocation('p1',6000),allocation('p2',4000)]});
  assert.equal(plan.remainderCents,'0');
  assert.throws(()=>validatePlan({imported:imp('i1','-10000'),targets,allocations:[allocation('p1',6001)]}),/excede/);
  assert.throws(()=>validatePlan({imported:imp('i1','-10000'),targets,allocations:[{kind:'receivable',id:'p1',amountCents:'10000'}]}),/incompatível/);
});
test('tarifas, desconto e parciais respeitam a diferença',()=>{
  const withFee=validatePlan({imported:imp('i1','-10000'),targets,allocations:[allocation('p3',9900)],adjustmentCents:'100',category:'Tarifa bancária'});
  assert.equal(withFee.remainderCents,'0');
  const partial=validatePlan({imported:imp('i1','-10000'),targets,allocations:[allocation('p1',2000)],status:'partial'});
  assert.equal(partial.remainderCents,'8000');
  assert.throws(()=>validatePlan({imported:imp('i1','-10000'),targets,allocations:[allocation('p3',9900)],adjustmentCents:'100'}),/categoria/);
  const discount=validatePlan({imported:imp('i1','-10000'),targets:[{...targets[2],amount:101}],allocations:[allocation('p3',10100)],adjustmentCents:'-100',category:'Desconto'});
  assert.equal(discount.remainderCents,'0');
});
test('uma conta pode ser conciliada por múltiplos depósitos até esgotar seu valor',()=>{
  const seen=new Map([['i1',{importId:'i1',status:'reconciled',allocations:[allocation('p3',5000)]}]]);
  assert.equal(remainingForTarget(targets[2],seen),5000n);
  assert.equal(validatePlan({imported:imp('i2','-5000'),targets,allocations:[allocation('p3',5000)],decisions:seen}).remainderCents,'0');
  assert.throws(()=>validatePlan({imported:imp('i3','-6000'),targets,allocations:[allocation('p3',6000)],decisions:seen}),/excede/);
});
test('sugestões N:1, combinação 1:N e lote nunca repetem título',()=>{
  const import100=imp('i1','-10000');
  assert.ok(suggestCombinations(import100,targets,new Map()).some(c=>c.length===2&&c.some(x=>x.id==='p1')));
  const bulk=batchSuggestions([import100,imp('i2','-10000')],targets,new Map());
  assert.ok(bulk.length<=2);
  const keys=bulk.flatMap(p=>p.allocations.map(a=>a.kind+':'+a.id));
  assert.equal(new Set(keys).size,keys.length);
});
test('API transacional faz N títulos, bloqueia reuso, registra auditoria e permite reabrir',async()=>{
  const db=mockDb();const code={bankCode:'B1',importId:'i1'};
  const out=await executeReconciliation(identity,{...code,action:'reconcile',status:'reconciled',allocations:[allocation('p1',6000),allocation('p2',4000)]},{db});
  assert.equal(out.records[0].allocations.length,2);
  assert.equal(Object.keys(db.store.erp.bankReconciliationState.B1.audit).length,1);
  await assert.rejects(()=>executeReconciliation(identity,{...code,action:'reconcile',allocations:[allocation('p3',10000)]},{db}),/já conciliada/);
  await assert.rejects(()=>executeReconciliation(identity,{bankCode:'B1',importId:'i3',action:'reconcile',status:'reconciled',allocations:[allocation('p1',6000)]},{db}),/excede/);
  const reset=await executeReconciliation(identity,{...code,action:'undo'},{db});
  assert.equal(reset.records[0].status,'reversed');
  assert.equal(Object.keys(db.store.erp.bankReconciliationState.B1.audit).length,2);
  const again=await executeReconciliation(identity,{...code,action:'reconcile',allocations:[allocation('p3',10000)]},{db});
  assert.equal(again.records[0].status,'reconciled');
});
test('N:1 em transações distintas, contabiliza saldo reservado e rejeita duplicação',async()=>{
  const db=mockDb();
  await executeReconciliation(identity,{bankCode:'B1',importId:'i2',action:'reconcile',allocations:[allocation('p3',5000)]},{db});
  await executeReconciliation(identity,{bankCode:'B1',importId:'i1',action:'partial-do-not-use',allocations:[]},{db}).then(()=>{throw Error('não rejeitou');},()=>{});
  await assert.rejects(()=>executeReconciliation(identity,{bankCode:'B1',importId:'i3',action:'reconcile',status:'reconciled',allocations:[allocation('p3',6000)]},{db}),/excede/);
});
test('criação de lançamento bancário é idempotente e faz apenas uma entrada em lancBanco',async()=>{
  const db=mockDb();
  const data={bankCode:'B1',action:'create-bank-entry',importId:'i1',confirm:true};
  const first=await executeReconciliation(identity,data,{db});
  const twice=await executeReconciliation(identity,data,{db});
  assert.equal(first.created,true);assert.equal(twice.created,false);
  assert.equal(Object.keys(db.store.erp.lancBanco).length,1);
  assert.equal(db.store.erp.lancBanco[first.id].valor,100);
  await assert.rejects(()=>executeReconciliation({...identity,canBanking:false},data,{db}),/não autorizado/);
});
test('estado bancário não é gravável pelo browser e endpoint exige identidade',()=>{
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules.erp;
  assert.equal(rules.bankReconciliationState['.write'],false);
  assert.match(rules.bankReconciliationState['.read'],/canBanking/);
  const endpoint=readFileSync(new URL('../api/banking/reconcile.js',import.meta.url),'utf8');
  assert.match(endpoint,/requireIdentity/);
  assert.match(endpoint,/assertSameOrigin/);
});

test('transação global impede usar mesmo título em contas bancárias diferentes',async()=>{
  const db=mockDb();
  await executeReconciliation(identity,{bankCode:'B1',importId:'i3',action:'reconcile',status:'reconciled',allocations:[allocation('p1',6000)]},{db});
  await assert.rejects(()=>executeReconciliation(identity,{bankCode:'B2',importId:'i4',action:'reconcile',status:'reconciled',allocations:[allocation('p1',6000)]},{db}),/excede/);
});

test('classificação, arquivo e desfazer não geram saldo nem bloqueiam títulos',async()=>{
  const db=mockDb();const base={bankCode:'B1',importId:'i1'};
  await executeReconciliation(identity,{...base,action:'archive'},{db});
  assert.equal(db.store.erp.bankReconciliationState.B1.decisions.i1.status,'archived');
  await assert.rejects(()=>executeReconciliation(identity,{...base,action:'reconcile',allocations:[allocation('p3',10000)]},{db}),/já conciliada/);
  await executeReconciliation(identity,{...base,action:'undo'},{db});
  await executeReconciliation(identity,{...base,action:'classify',category:'Tarifas'},{db});
  assert.equal(db.store.erp.bankReconciliationState.B1.decisions.i1.status,'classified');
  assert.equal(Object.keys(db.store.erp.lancBanco).length,0);
});
test('lote exige soma e todos os itens passam juntos pela mesma transação',async()=>{
  const db=mockDb();
  const input={bankCode:'B1',action:'batch',items:[
    {importId:'i1',allocations:[allocation('p3',10000)]},
    {importId:'i2',allocations:[allocation('p1',6000)]}
  ]};
  await assert.rejects(()=>executeReconciliation(identity,input,{db}),/excede|valor|superam/);
  assert.equal(db.store.erp.bankReconciliationState.B1,undefined);
  const okay=await executeReconciliation(identity,{...input,items:[
    {importId:'i1',allocations:[allocation('p3',10000)]},
    {importId:'i2',allocations:[allocation('p1',5000)]}
  ]},{db});
  assert.equal(okay.records.length,2);
  assert.equal(Object.keys(db.store.erp.bankReconciliationState.B1.audit).length,2);
});
test('criação de título é explícita, idempotente e não baixa o financeiro',async()=>{
  const db=mockDb();
  const input={bankCode:'B1',importId:'i1',action:'create-title',party:'Fornecedor ABC',category:'Compras',company:'Empresa Teste',confirm:true};
  const once=await executeReconciliation(identity,input,{db});
  const twice=await executeReconciliation(identity,input,{db});
  assert.equal(once.created,true);assert.equal(twice.created,false);
  assert.equal(once.kind,'payable');
  assert.equal(db.store.erp.contasPagar[once.id].status,'Pendente');
  assert.equal(db.store.erp.contasPagar[once.id].reconciliationImportId,'i1');
  assert.equal(db.store.erp.lancBanco&&Object.keys(db.store.erp.lancBanco).length,0);
  await assert.rejects(()=>executeReconciliation({...identity,canFinance:false},input,{db}),/Sem permissão/);
});

test('validação de plano inválido retorna 400 e não grava estado financeiro',async()=>{
  const db=mockDb();
  await assert.rejects(
    ()=>executeReconciliation(identity,{bankCode:'B1',action:'reconcile',importId:'i1',status:'reconciled',allocations:[]},{db}),
    err=>err.status===400&&err.code==='INVALID_RECONCILIATION'&&/vínculo financeiro/.test(err.message)
  );
  assert.deepEqual(db.store.erp.bankReconciliationState,{});
});

test('saldo já comprometido retorna 409 e não confirma uma segunda reserva',async()=>{
  const db=mockDb();
  await executeReconciliation(identity,{bankCode:'B1',action:'reconcile',importId:'i2',allocations:[allocation('p1',5000)]},{db});
  await assert.rejects(
    ()=>executeReconciliation(identity,{bankCode:'B1',action:'reconcile',importId:'i1',allocations:[allocation('p1',6000)]},{db}),
    err=>err.status===409&&err.code==='RECONCILIATION_CONFLICT'
  );
  assert.equal(Object.keys(db.store.erp.bankReconciliationState.B1.audit).length,1);
});

test('dados monetários inválidos retornam 400 sem criar títulos ou movimentações',async()=>{
  const db=mockDb();
  await assert.rejects(
    ()=>executeReconciliation(identity,{bankCode:'B1',action:'create-title',importId:'i1',amountCents:'1e999',confirm:true},{db}),
    err=>err.status===400
  );
  db.store.erp.bankReconciliationImports.B1.i1.amountCents='1e999';
  await assert.rejects(
    ()=>executeReconciliation(identity,{bankCode:'B1',action:'create-bank-entry',importId:'i1',confirm:true},{db}),
    err=>err.status===400
  );
  assert.equal(Object.keys(db.store.erp.contasPagar).length,3);
  assert.equal(Object.keys(db.store.erp.lancBanco).length,0);
});

test('cliente identifica status e ID da requisição sem expor erros internos',()=>{
  const ui=readFileSync(new URL('../public/modules/banking/reconciliation-ui.js',import.meta.url),'utf8');
  assert.match(ui,/X-Request-Id/);
  assert.match(ui,/e\.status===409/);
  assert.match(ui,/Confira o histórico antes de tentar novamente/);
});
