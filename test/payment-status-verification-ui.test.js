import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const begin=core.indexOf('async function _cpVerificarSituacaoPagamento(');
const end=core.indexOf('async function confirmarPagarCP(',begin);
assert.ok(begin>=0&&end>begin);
const source=core.slice(begin,end);

function createContext(state){
  const messages=[],requests=[],local={id:'CPPO_T309',ticket:'T309',valor:50,status:'Pendente'};
  const modal={dataset:{paymentOperation:'6b3e5d56-51e2-418c-9b09-804142c88d8f'},querySelectorAll:()=>[{disabled:false},{disabled:false}]};
  const verify={disabled:false};
  const user={uid:'elaine',getIdToken:async()=> 'token'};
  let closed=0;
  const env={
    document:{getElementById:id=>({ 'modal-body':modal,'pcp-id':{value:'CPPO_T309'},'btn-verificar-baixa':verify})[id]||null},
    firebase:{auth:()=>({currentUser:user})},URLSearchParams,
    fetch:async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>state};},
    _cpIdxPorId:()=>0,CONTAS_PAGAR:[local],TICKETS_DB:{T309:{ticket:'T309',saldoPagar:50,status:'Pendente'}},
    renderContasPagar(){},renderTickets(){},renderFluxo(){},renderDashboard(){},
    cm(){closed++;},showToast:message=>messages.push(message),console
  };
  runInNewContext('const _cpPendingPayments=new Map();'+source+';this.verify=_cpVerificarSituacaoPagamento;',env);
  return {env,requests,messages,modal,verify,get closed(){return closed;}};
}

test('T309: consulta de baixa confirmada atualiza ticket e conta sem POST financeiro',async()=>{
  const context=createContext({state:'confirmed',payable:{id:'CPPO_T309',status:'Pago',valor:50},ticket:{ticket:'T309',status:'Pago',saldoPagar:0},ticketKey:'T309'});
  await context.env.verify();
  assert.equal(context.requests.length,1);
  assert.match(context.requests[0].url,/payables-status\?/);
  assert.equal(context.requests[0].init.method,undefined,'Consulta usa GET e não envia dados de baixa');
  assert.equal(context.env.CONTAS_PAGAR[0].status,'Pago');
  assert.equal(context.env.TICKETS_DB.T309.saldoPagar,0);
  assert.equal(context.closed,1);
});

test('T309: pagamento em processamento mantém botões de baixa bloqueados e não reenvia POST',async()=>{
  const context=createContext({state:'processing',retryAfterSeconds:74});
  await context.env.verify();
  assert.equal(context.requests.length,1);
  assert.equal(context.env.CONTAS_PAGAR[0].status,'Pendente');
  assert.ok(Number(context.modal.dataset.paymentLockedUntil)>Date.now()+70000);
  assert.equal(context.closed,0);
});

test('T309: conta paga mas ticket pendente não força status Pago nem cobra de novo',async()=>{
  const context=createContext({state:'needs_review'});
  await context.env.verify();
  assert.equal(context.env.CONTAS_PAGAR[0].status,'Pendente');
  assert.equal(context.env.TICKETS_DB.T309.status,'Pendente');
  assert.equal(context.requests.length,1);
  assert.match(context.messages.join(' '),/situações diferentes/);
});
