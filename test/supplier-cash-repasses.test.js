import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {changeSupplierCashRepasse,listSupplierCashRepasses,summarizeSupplierCashRepasses} from '../server/application/supplier-cash-repasses.js';

const identity={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPayables:true,canBanking:false};
const input={action:'receive',operationId:'aaaaaaa0-aaaa-4aaa-aaaa-aaaaaaaaaaaa',fornCod:'F-001',data:'2026-11-05',valor:11000,obs:'Dinheiro para devolver por PIX'};
function fakeDb(){
  const state={erp:{bancos:{b1:{cod:'BC-007',banco:'Conta operacional',conta:'1234',pix:'sensitive'}},fornecedores:{f1:{cod:'F-001',nome:'Fornecedor Um'}}}};
  let writes=0,failed=false;
  const get=path=>path.split('/').filter(Boolean).reduce((node,k)=>node?.[k],state);
  function set(path,value){const keys=path.split('/').filter(Boolean),last=keys.pop();let node=state;for(const k of keys)node=node[k]??={};if(value===null)delete node[last];else node[last]=structuredClone(value);}
  return {state,get updates(){return writes;},failNext(){failed=true;},ref(path=''){return {
    async get(){return {val:()=>structuredClone(get(path)??null)};},
    async update(values){if(failed){failed=false;throw new Error('Firebase failed');}writes++;for(const [k,v] of Object.entries(values))set(path+'/'+k,v);},
    async transaction(fn){const old=get(path)??null,news=fn(structuredClone(old));if(news===undefined)return {committed:false};set(path,news);return {committed:true};}
  };}};
}
test('recebimento cria obrigação e entrada em espécie sem movimentar conta bancária',async()=>{
  const db=fakeDb();
  const result=await changeSupplierCashRepasse(identity,input,{db});
  assert.equal(result.record.valor,11000);
  assert.equal(result.record.saldo,11000);
  assert.equal(db.state.erp.lancBanco,undefined);
  assert.equal(db.state.erp.fornecedorRepassesCaixa[result.record.id].tipo,'Entrada');
  assert.equal(db.updates,1);
  const again=await changeSupplierCashRepasse(identity,input,{db});
  assert.equal(again.alreadyCommitted,true);
  assert.equal(db.updates,1);
});
test('PIX parcial e quitação diminuem saldo uma única vez e geram uma saída por operação',async()=>{
  const db=fakeDb();const created=await changeSupplierCashRepasse(identity,input,{db});
  const payment={action:'pay',operationId:'bbbbbbb0-bbbb-4bbb-bbbb-bbbbbbbbbbbb',fornCod:'F-001',receiptId:created.record.id,
    expectedVersion:1,data:'2026-11-05',valor:6000,bancoCod:'BC-007'};
  const partial=await changeSupplierCashRepasse(identity,payment,{db});
  assert.equal(partial.record.saldo,5000);
  assert.equal(partial.record.status,'Parcial');
  assert.equal(db.state.erp.lancBanco[partial.movement.id].tipo,'Saida');
  assert.equal(db.updates,2);
  await assert.rejects(()=>changeSupplierCashRepasse(identity,{...payment,operationId:'ccccccc0-cccc-4ccc-cccc-cccccccccccc'},{db}),{code:'RECEIPT_CHANGED'});
  await assert.rejects(()=>changeSupplierCashRepasse(identity,{...payment,operationId:'ddddddd0-dddd-4ddd-dddd-dddddddddddd',expectedVersion:2,valor:7000},{db}),{code:'OVERPAYMENT'});
  const rest=await changeSupplierCashRepasse(identity,{...payment,operationId:'eeeeeee0-eeee-4eee-eeee-eeeeeeeeeeee',expectedVersion:2,valor:5000},{db});
  assert.equal(rest.record.status,'Quitado');
  assert.equal(rest.record.saldo,0);
  assert.equal(rest.record.valorPago,11000);
  assert.equal(db.updates,3);
  const list=await listSupplierCashRepasses(identity,'F-001',{db});
  assert.equal(list.totalEmAberto,0);
  assert.deepEqual(list.banks,[{cod:'BC-007',banco:'Conta operacional'}]);
  assert.equal(list.records[0].pagamentos.length,2);
});
test('falha de escrita não cria crédito nem saída bancária; usuário sem permissão não acessa',async()=>{
  const db=fakeDb();db.failNext();
  await assert.rejects(()=>changeSupplierCashRepasse(identity,input,{db}),/Firebase failed/);
  assert.equal(db.state.erp.fornecedorRepasses,undefined);
  assert.equal(db.state.erp.fornecedorRepassesCaixa,undefined);
  assert.equal(db.updates,0);
  await assert.rejects(()=>changeSupplierCashRepasse({...identity,canPayables:false},input,{db}),{status:403});
  await assert.rejects(()=>listSupplierCashRepasses({...identity,canPayables:false},'F-001',{db}),{status:403});
});
test('operações de repasse não liberam leitura ou escrita direta pelo navegador nas regras RTDB',()=>{
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8'));
  for(const node of ['fornecedorRepasses','fornecedorRepassesCaixa','fornecedorRepasseOperations']){
    assert.deepEqual(rules.rules.erp[node],{'.read':false,'.write':false});
  }
  assert.deepEqual(rules.rules.erpSupplierRepasseLocks,{'.read':false,'.write':false});
});


test('fluxo de caixa e contas a pagar enxergam entradas e repasses sem duplicidade',async()=>{
  const db=fakeDb();
  const created=await changeSupplierCashRepasse(identity,input,{db});
  await changeSupplierCashRepasse(identity,{action:'pay',operationId:'ccccccc0-cccc-4ccc-cccc-cccccccccccc',
    fornCod:'F-001',receiptId:created.record.id,expectedVersion:1,data:'2026-11-05',valor:4000,bancoCod:'BC-007'},{db});
  const snapshot=await summarizeSupplierCashRepasses(identity,{db});
  assert.equal(snapshot.totalEmAberto,7000);
  assert.equal(snapshot.rows.length,1);
  assert.equal(snapshot.rows[0].nome,'Fornecedor Um');
  assert.deepEqual(snapshot.months['2026-11'],{entradas:11000,saidas:4000});
  assert.equal(db.updates,2);
});

test('idempotência não permite reutilizar identificador com valor ou fornecedor diferentes',async()=>{
  const db=fakeDb();
  const first=await changeSupplierCashRepasse(identity,input,{db});
  await assert.rejects(()=>changeSupplierCashRepasse(identity,{...input,valor:12000},{db}),{code:'OPERATION_ID_REUSED'});
  await assert.rejects(()=>changeSupplierCashRepasse(identity,{...input,fornCod:'F-002'},{db}),{code:'OPERATION_ID_REUSED'});
  assert.equal(db.state.erp.fornecedorRepasses['F-001'][first.record.id].valor,11000);
  assert.equal(db.updates,1);
});
