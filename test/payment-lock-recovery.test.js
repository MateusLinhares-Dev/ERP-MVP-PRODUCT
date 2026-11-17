import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {payPayable,inspectPayablePayment} from '../server/modules/payables/application/payables.js';
import {createPendingPayments,submitPayment} from '../web/modules/payables/application/payments.ts';

const actor={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPayables:true};
const op='6b3e5d56-51e2-418c-9b09-804142c88d8f';
const payment={payableId:'CP-T275',operationId:op,amount:230,advanceAmount:0,bankCode:'BC-005',date:'2026-11-05',expected:{valor:230,status:'Pendente',paymentsCount:0}};
const owner='e1a4e083-e734-40fd-a7a9-d665643a7ac6';
const operationKey='erp_elaine_'+op;

function fakeDb(){
  const state={erp:{contasPagar:{'CP-T275':{id:'CP-T275',ticket:'T275',fornCod:'FT',cred:'TESTE NAO APAGAR',valor:230,status:'Pendente',pagamentos:[]}},tickets:{T275:{ticket:'T275',saldoPagar:230,status:'Pendente'}},bancos:{a:{cod:'BC-005',banco:'Banco de Teste'}}}};
  let writes=0,fail=false,beforeUpdate=null,afterUpdate=null,lastChanges=null;
  const get=p=>p.split('/').filter(Boolean).reduce((obj,k)=>obj?.[k],state);
  const put=(p,v)=>{const parts=p.split('/').filter(Boolean),last=parts.pop();let curr=state;for(const part of parts)curr=curr[part]??={};if(v===null)delete curr[last];else curr[last]=structuredClone(v);};
  const db={state,get writes(){return writes;},setBeforeUpdate(fn){beforeUpdate=fn;},setAfterUpdate(fn){afterUpdate=fn;},get lastChanges(){return lastChanges;},failOnce(){fail=true;},ref(path){return {
    async get(){return {val:()=>structuredClone(get(path)??null),exists:()=>get(path)!=null};},
    async transaction(fn){const prev=structuredClone(get(path)??null),next=fn(prev);if(next===undefined)return {committed:false,snapshot:{val:()=>prev}};put(path,next);return {committed:true,snapshot:{val:()=>next}};},
    async update(changes){if(beforeUpdate)await beforeUpdate();if(fail){fail=false;throw Error('permission_denied');}lastChanges=structuredClone(changes);for(const [name,value] of Object.entries(changes))put((path?path+'/':'')+name,value);writes++;if(afterUpdate)await afterUpdate();}
  };}};
  return db;
}

test('bloqueio ativo não gera baixa adicional e informa quanto resta',async()=>{
  const db=fakeDb();db.state.erpFinancePayableLocks={'CP-T275':{owner:'other',expiresAt:190000}};
  let waits=0;
  await assert.rejects(()=>payPayable(actor,payment,{db,now:()=>100000,sleep:async()=>{waits++;}}),error=>{
    assert.equal(error.code,'PAYMENT_IN_PROGRESS');assert.equal(error.status,409);
    assert.equal(error.retryAfterSeconds,90);return true;
  });
  assert.equal(waits,0);assert.equal(db.writes,0);assert.equal(db.state.erp.lancBanco,undefined);
});

test('resultado gravado durante bloqueio recupera a operação sem criar outro débito',async()=>{
  const db=fakeDb();db.state.erpFinancePayableLocks={'CP-T275':{owner:'other',operationKey,expiresAt:190000}};
  const result={payable:{id:'CP-T275',status:'Pago',valor:230},bankMovement:{id:'LB-EXISTENTE'}};
  let waits=0;
  const received=await payPayable(actor,payment,{db,now:()=>100000,sleep:async()=>{
    waits++;
    db.state.erp.financePayableOperations={[operationKey]:{result}};
  }});
  assert.equal(received.alreadyCommitted,true);assert.equal(received.bankMovement.id,'LB-EXISTENTE');
  assert.equal(waits,1);assert.equal(db.writes,0);
});

test('bloqueio abandonado e expirado é assumido por transação; grava um pagamento e libera o lock',async()=>{
  const db=fakeDb();db.state.erpFinancePayableLocks={'CP-T275':{owner:'dead-worker',expiresAt:99999}};
  const saved=await payPayable(actor,payment,{db,now:()=>100000,uuid:()=>owner,sleep:async()=>{}});
  assert.equal(db.writes,1);assert.equal(saved.payable.status,'Pago');
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
  assert.equal(db.state.erpFinancePayableLocks['CP-T275'],undefined);
  assert.equal((await payPayable(actor,payment,{db})).alreadyCommitted,true);
  assert.equal(db.writes,1);
});

test('repetição da mesma operação aceita, mas reutilizar UUID com valores alterados é proibido',async()=>{
  const db=fakeDb();await payPayable(actor,payment,{db});
  assert.equal((await payPayable(actor,payment,{db})).alreadyCommitted,true);
  await assert.rejects(()=>payPayable(actor,{...payment,amount:50},{db}),{code:'OPERATION_USED'});
  assert.equal(db.writes,1);
});

test('falha antes da gravação limpa bloqueio para nova tentativa da MESMA operação',async()=>{
  const db=fakeDb();db.failOnce();
  await assert.rejects(()=>payPayable(actor,payment,{db}),/permission_denied/);
  assert.equal(db.state.erpFinancePayableLocks?.['CP-T275'],undefined);
  const saved=await payPayable(actor,payment,{db});
  assert.equal(saved.payable.status,'Pago');assert.equal(db.writes,1);
});

test('duas chamadas simultâneas com o mesmo UUID terminam com apenas uma movimentação',async()=>{
  const db=fakeDb();let proceed,notify;
  const gate=new Promise(resolve=>{proceed=resolve;});
  const started=new Promise(resolve=>{notify=resolve;});
  db.setBeforeUpdate(async()=>{notify();await gate;});
  const first=payPayable(actor,payment,{db});await started;
  const second=payPayable(actor,payment,{db,sleep:async()=>{proceed();await first;}});
  const a=await first,b=await second;
  assert.equal(a.alreadyCommitted,undefined);assert.equal(b.alreadyCommitted,true);
  assert.equal(db.writes,1);assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
});

test('interface mostra conflito em linguagem compreensível e não reenvia com lock ativo',async()=>{
  let calls=0,clock=Date.now();
  const deps={gateway:{pay:async()=>{calls++;const error=Object.assign(new Error('Outra baixa deste título está em andamento.'),{code:'PAYMENT_IN_PROGRESS',status:409,retryAfterSeconds:90});throw error;}},ledger:{apply(){}},pending:createPendingPayments(()=>clock,()=>op),now:()=>clock};
  const body={...payment};
  const first=await submitPayment(deps,body);
  const second=await submitPayment(deps,body);
  assert.equal(calls,1);
  assert.match(first.message,/Há uma baixa em processamento/);
  assert.match(second.message,/Aguarde/);
  assert.ok(deps.pending.blockedSeconds('CP-T275')>80,'bloqueio local deve respeitar 90 segundos do servidor');
  assert.equal(deps.pending.operation('CP-T275'),op,'nova tentativa reaproveita a mesma operação');
  assert.doesNotMatch(first.message+second.message,/PAYMENT_IN_PROGRESS/);
  const network=await submitPayment({...deps,pending:createPendingPayments(()=>clock,()=>'n1'),gateway:{pay:async()=>{throw Object.assign(new Error('x'),{code:'NETWORK_ERROR',status:0});}}},{...body,operationId:'n1'});
  assert.match(network.message,/Verificar situação/);
});

test('duas pessoas com UUID diferentes não lançam duas baixas durante bloqueio ativo',async()=>{
  const db=fakeDb();let proceed,notify;
  const gate=new Promise(resolve=>{proceed=resolve;});
  const started=new Promise(resolve=>{notify=resolve;});
  db.setBeforeUpdate(async()=>{notify();await gate;});
  const first=payPayable(actor,payment,{db});
  await started;
  const second={...payment,operationId:'d42e7a7a-39d5-4d7c-a989-f96e246a9104'};
  await assert.rejects(()=>payPayable(actor,second,{db,sleep:async()=>{}}),{code:'PAYMENT_IN_PROGRESS',status:409});
  proceed();
  const saved=await first;
  assert.equal(saved.payable.status,'Pago');
  assert.equal(db.writes,1);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
  await assert.rejects(()=>payPayable(actor,second,{db}),{code:'PAYABLE_CHANGED'});
  assert.equal(db.writes,1);
});

test('tentar novamente durante bloqueio válido não estende a expiração',async()=>{
  const db=fakeDb();const expiry=220000;
  db.state.erpFinancePayableLocks={'CP-T275':{owner:'another-worker',expiresAt:expiry}};
  await assert.rejects(()=>payPayable(actor,payment,{db,now:()=>100000,sleep:async()=>{}}),{code:'PAYMENT_IN_PROGRESS'});
  assert.equal(db.state.erpFinancePayableLocks['CP-T275'].expiresAt,expiry);
  assert.equal(db.writes,0);
});

test('T309: commit de pagamento libera a trava ATOMICAMENTE com conta, ticket e débito',async()=>{
  const db=fakeDb();
  const result=await payPayable(actor,payment,{db,now:()=>100000,uuid:()=>owner});
  assert.equal(result.payable.status,'Pago');
  assert.equal(db.writes,1);
  assert.equal(db.lastChanges['erpFinancePayableLocks/CP-T275'],null);
  assert.equal(db.lastChanges['erpFinancePayableTicketLocks/T275'],null);
  assert.equal(db.lastChanges['erp/contasPagar/CP-T275'].status,'Pago');
  assert.equal(db.lastChanges['erp/tickets/T275'].saldoPagar,0);
  assert.equal(db.state.erpFinancePayableLocks?.['CP-T275'],undefined);
});

test('resposta perdida APÓS commit não deixa lock, não gera segunda baixa',async()=>{
  const db=fakeDb();
  let lost=true;
  db.setAfterUpdate(()=>{if(lost){lost=false;throw Error('response lost after commit');}});
  const first=await payPayable(actor,payment,{db,now:()=>100000,uuid:()=>owner});
  assert.equal(first.alreadyCommitted,true);
  assert.equal(db.state.erpFinancePayableLocks?.['CP-T275'],undefined);
  assert.equal(db.writes,1);
  const replay=await payPayable(actor,payment,{db});
  assert.equal(replay.alreadyCommitted,true);
  assert.equal(db.writes,1);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
});

test('consulta somente leitura identifica T309 pendente em processamento sem criar débito',async()=>{
  const db=fakeDb();
  db.state.erpFinancePayableLocks={'CP-T275':{owner:'other',expiresAt:190000}};
  const state=JSON.stringify(db.state);
  const result=await inspectPayablePayment(actor,{payableId:'CP-T275',operationId:op},{db,now:()=>100000});
  assert.equal(result.state,'processing');
  assert.equal(result.retryAfterSeconds,90);
  assert.equal(JSON.stringify(db.state),state);
  assert.equal(db.writes,0);
});

test('consulta retorna confirmação e ticket real depois de pagamento',async()=>{
  const db=fakeDb();await payPayable(actor,payment,{db});
  const result=await inspectPayablePayment(actor,{payableId:'CP-T275',operationId:op},{db});
  assert.equal(result.state,'confirmed');
  assert.equal(result.payable.status,'Pago');
  assert.equal(result.ticket.saldoPagar,0);
  assert.equal(result.ticketKey,'T275');
  assert.equal(result.receiptFound,true);
});

test('conta paga mas ticket T309 pendente exige revisão, SEM nova baixa',async()=>{
  const db=fakeDb();await payPayable(actor,payment,{db});
  db.state.erp.tickets.T275.saldoPagar=230;
  db.state.erp.tickets.T275.status='Pendente';
  const state=JSON.stringify(db.state);
  const result=await inspectPayablePayment(actor,{payableId:'CP-T275'},{db});
  assert.equal(result.state,'needs_review');
  assert.equal(JSON.stringify(db.state),state);
});

test('ticket marcado como pago com conta pendente também bloqueia nova baixa',async()=>{
  const db=fakeDb();
  db.state.erp.tickets.T275.saldoPagar=0;
  db.state.erp.tickets.T275.status='Pago';
  const result=await inspectPayablePayment(actor,{payableId:'CP-T275'},{db});
  assert.equal(result.state,'needs_review');
  assert.equal(db.writes,0);
});

test('ticket T309 ausente não pode receber baixa apenas na conta a pagar',async()=>{
  const db=fakeDb();delete db.state.erp.tickets.T275;
  await assert.rejects(()=>payPayable(actor,payment,{db}),{code:'PURCHASE_TICKET_MISSING',status:409});
  assert.equal(db.writes,0);
  assert.equal(db.state.erp.contasPagar['CP-T275'].status,'Pendente');
  assert.equal(db.state.erp.lancBanco,undefined);
});

test('saldo de compra já quitado não pode gerar novo débito',async()=>{
  const db=fakeDb();db.state.erp.tickets.T275.saldoPagar=0;db.state.erp.tickets.T275.status='Pago';
  await assert.rejects(()=>payPayable(actor,payment,{db}),{code:'PURCHASE_BALANCE_CHANGED',status:409});
  assert.equal(db.writes,0);
  assert.equal(db.state.erp.lancBanco,undefined);
});
