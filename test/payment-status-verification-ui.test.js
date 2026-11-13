import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingPayments,verifyPayment} from '../web/modules/payables/application/payments.ts';

function createContext(state){
  const requests=[],applied=[];
  const clock=Date.now();
  const deps={
    gateway:{status:async(payableId,operationId)=>{requests.push({payableId,operationId});return state;},pay:async()=>{throw new Error('não deve enviar baixa');}},
    ledger:{apply:(kind,result)=>applied.push([kind,result])},
    pending:createPendingPayments(()=>clock,()=>'6b3e5d56-51e2-418c-9b09-804142c88d8f'),
    now:()=>clock,
  };
  return {deps,requests,applied};
}

test('T309: consulta de baixa confirmada atualiza ticket e conta sem POST financeiro',async()=>{
  const context=createContext({state:'confirmed',payable:{id:'CPPO_T309',status:'Pago',valor:50},ticket:{ticket:'T309',status:'Pago',saldoPagar:0},ticketKey:'T309'});
  const outcome=await verifyPayment(context.deps,'CPPO_T309','6b3e5d56-51e2-418c-9b09-804142c88d8f');
  assert.equal(context.requests.length,1);
  assert.equal(outcome.kind,'done');
  assert.deepEqual(context.applied.map(([kind,result])=>[kind,result.ticket.saldoPagar]),[['status',0]]);
});

test('T309: pagamento em processamento mantém botões de baixa bloqueados e não reenvia POST',async()=>{
  const context=createContext({state:'processing',retryAfterSeconds:74});
  const outcome=await verifyPayment(context.deps,'CPPO_T309','op');
  assert.equal(outcome.kind,'blocked');
  assert.ok(context.deps.pending.blockedSeconds('CPPO_T309')>=70);
  assert.equal(context.applied.length,0);
});

test('T309: conta paga mas ticket pendente não força status Pago nem cobra de novo',async()=>{
  const context=createContext({state:'needs_review'});
  const outcome=await verifyPayment(context.deps,'CPPO_T309','op');
  assert.equal(context.applied.length,0);
  assert.equal(outcome.lock,true);
  assert.match(outcome.message,/situações diferentes/);
});

test('consulta mostra pendente e libera os botões; conta sumida trava', async()=>{
  const pending=createContext({state:'pending'});
  assert.equal((await verifyPayment(pending.deps,'CP','op')).kind,'info');
  assert.equal(pending.deps.pending.blockedSeconds('CP'),0);
  const missing=createContext({state:'not_found'});
  const outcome=await verifyPayment(missing.deps,'CP','op');
  assert.equal(outcome.lock,true);
});
