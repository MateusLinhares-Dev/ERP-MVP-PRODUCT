import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {payPayable,inspectPayablePayment} from '../server/modules/payables/application/payables.js';
const account='CPPO_T309',ticket='T309';
const user={uid:'elaine',erpUser:'elaine',erpAccess:true,canPayables:true};
const op='7cb6db60-6d56-4d01-a159-3c97b5f1c965';
function scenario({status='Pago',ticketStatus='Pago',ticketBalance=0}={}){
  const ids=['LB-PG-1793999084675-c53e2681','LB-PG-1793999234976-46dd0e59','LB-PG-1794001531014-e2fcaf89','LB-PG-1794001697320-3f127753'];
  const row={id:account,ticket,fornCod:'F675',valor:50,valorPago:200,status,
    pagamentos:ids.map(id=>({valor:50,adt:0,movBancoId:id,banco:'acred gratus'}))};
  const ledger={ [ids[3]]:{id:ids[3],bancoCod:'BC-005',valor:50,payableId:account} };
  return {erp:{contasPagar:{[account]:row},tickets:{[ticket]:{ticket,status:ticketStatus,saldoPagar:ticketBalance,totalGeral:50}},lancBanco:ledger,bancos:{BC:{cod:'BC-005',banco:'acred gratus'}}}};
}
function mock(initial){const state=structuredClone(initial);let updates=0;
  const read=path=>path.split('/').filter(Boolean).reduce((a,k)=>a?.[k],state);
  const put=(path,v)=>{const parts=path.split('/').filter(Boolean),last=parts.pop();let x=state;for(const k of parts)x=x[k]??={};if(v===null)delete x[last];else x[last]=v;};
  return {state,get writes(){return updates;},ref(path=''){return {
    get:async()=>({val:()=>structuredClone(read(path)??null)}),
    transaction:async fn=>{const old=structuredClone(read(path)??null),next=fn(old);if(next===undefined)return {committed:false,snapshot:{val:()=>old}};put(path,next);return {committed:true,snapshot:{val:()=>next}};},
    update:async changes=>{updates++;for(const [k,v]of Object.entries(changes))put(path+'/'+k,v);}
  };}};
}
test('T309: consulta de status não informa confirmado enquanto título possui quatro pagamentos inconsistentes',async()=>{
  const db=mock(scenario());const before=JSON.stringify(db.state);
  const result=await inspectPayablePayment(user,{payableId:account},{db});
  assert.equal(result.state,'needs_review');
  assert.ok(result.reasons.includes('PAYMENTS_EXCEED_PURCHASE'));
  assert.ok(result.reasons.includes('BANK_MOVEMENT_MISSING'));
  assert.equal(JSON.stringify(db.state),before);
});
test('T309: mesmo se algum código legado reverter status e saldo para pendente, API bloqueia nova baixa',async()=>{
  const db=mock(scenario({status:'Pendente',ticketStatus:'Pendente',ticketBalance:50}));
  const input={payableId:account,operationId:op,bankCode:'BC-005',amount:50,advanceAmount:0,date:'2026-11-06',expected:{valor:50,status:'Pendente',paymentsCount:4}};
  await assert.rejects(()=>payPayable(user,input,{db}),{code:'PAYABLE_RECONCILIATION_REQUIRED',status:409});
  assert.equal(db.writes,0);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
});
test('sincronizador não reenvia CPPO, tickets criados pela API e saídas bancárias LB-PG-',()=>{
  const code=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
  assert.match(code,/String\(id\)\.startsWith\('CPPO_'\)/);
  assert.match(code,/TICKETS_DB\[k\]\?\._purchaseOperationId/);
  assert.match(code,/String\(id\)\.startsWith\('LB-PG-'\)/);
});
