import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {payPayable} from '../server/modules/payables/application/payables.js';
import {changeAdvance} from '../server/modules/advances/application/advances.js';

const actor={uid:'erp:thais',erpUser:'thais',erpAccess:true,canPayables:true,canAdvances:true,canBanking:false};
const operationId='cebcaa20-2e4a-4e32-8e08-41ad07415dc0';
const input={operationId,payableId:'CP-T089',date:'2026-11-04',bankCode:'',amount:0,advanceAmount:8703.50,fornCod:'F089',expected:{valor:8703.50,status:'Pendente',paymentsCount:0}};
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');

function fakeDb(){
  const advance={cod:'ADT-089',valor:10003.52,status:'Pendente',ticket:'T089',forma:'PIX',bancoCod:'BC-007',bancoNome:'Santander',movBancoId:'LB-089',data:'28/10/2026'};
  const state={erp:{
    bancos:{bank1:{cod:'BC-007',banco:'Santander'}},
    fornecedores:{supplier1:{cod:'F089',nome:'Adriano Ferreira de Lima Junior'}},
    lancBanco:{'LB-089':{id:'LB-089',bancoCod:'BC-007',data:'28/10/2026',descricao:'Adiantamento: Adriano',tipo:'Saida',valor:10003.52}},
    contasPagar:{'CP-T089':{id:'CP-T089',ticket:'T089',fornCod:'F089',cred:'Adriano Ferreira de Lima Junior',desc:'Compra de Sucata – T089',valor:8703.50,status:'Pendente'},'CP-T059':{id:'CP-T059',ticket:'T059',fornCod:'F089',cred:'Adriano Ferreira de Lima Junior',desc:'Compra de Sucata – T059',valor:8703.50,status:'Pendente'}},
    adiantamentos:{F089:[advance]},
    tickets:{T089:{ticket:'T089',fornecedorCod:'F089',saldoPagar:8703.50,status:'Pendente'},T059:{ticket:'T059',fornecedorCod:'F089',saldoPagar:8703.50,status:'Pendente'}}
  }};
  let updates=0,fail=false;
  const get=path=>path.split('/').filter(Boolean).reduce((obj,k)=>obj?.[k],state);
  const put=(path,value)=>{const parts=path.split('/').filter(Boolean),name=parts.pop();let obj=state;for(const part of parts)obj=obj[part]??={};if(value===null)delete obj[name];else obj[name]=structuredClone(value);};
  return {state,get updates(){return updates;},failOnce(){fail=true;},ref(path){return {
    async get(){return {val:()=>structuredClone(get(path)??null)};},
    async transaction(fn){const old=structuredClone(get(path)??null),next=fn(old);if(next===undefined)return {committed:false};put(path,next);return {committed:true};},
    async update(changes){if(fail){fail=false;throw Error('permission_denied');}for(const [name,value] of Object.entries(changes))put((path?path+'/':'')+name,value);updates++;}
  };}};
}

test('adiantamento vinculado a T089 não pode quitar T059',async()=>{
  const db=fakeDb();
  await assert.rejects(()=>payPayable(actor,{...input,payableId:'CP-T059'},{db}),{code:'ADVANCE_BALANCE_CHANGED'});
  assert.equal(db.updates,0);
  assert.equal(db.state.erp.contasPagar['CP-T059'].status,'Pendente');
  assert.equal(db.state.erp.adiantamentos.F089[0].valor,10003.52);
});

test('T089 de 8703,50 consome crédito sem novo débito e deixa 1300,02 disponível',async()=>{
  const db=fakeDb();
  const result=await payPayable(actor,input,{db,now:()=>1793740000000,uuid:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'});
  assert.equal(db.updates,1);
  assert.equal(result.payable.status,'Pago');
  assert.equal(result.payable.adtCompensado,8703.50);
  assert.equal(result.payable.valorPago,0);
  assert.equal(result.bankMovement,null);
  assert.equal(result.ticket.saldoPagar,0);
  const [remaining,used]=db.state.erp.adiantamentos.F089;
  assert.equal(remaining.valor,1300.02);
  assert.equal(remaining.valorOriginal,10003.52);
  assert.equal(remaining.valorCompensado,8703.50);
  assert.equal(remaining.status,'Pendente');
  assert.equal(remaining.ticket,'');
  assert.equal(remaining.ticketOrigem,'T089');
  assert.equal(used.valor,8703.50);
  assert.equal(used.status,'Quitado');
  assert.equal(used.ticket,'T089');
  assert.equal(used.adiantamentoOrigem,'ADT-089');
  assert.equal(db.state.erp.lancBanco['LB-089'].valor,10003.52);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
  assert.equal((await payPayable(actor,input,{db})).alreadyCommitted,true);
  assert.equal(db.updates,1);
});

test('crédito residual pode ser usado em próxima compra, sem duplicar o adiantamento bancário',async()=>{
  const db=fakeDb();
  await payPayable(actor,input,{db});
  const result=await payPayable(actor,{...input,operationId:'aa0bc880-1704-4e9d-81fe-9398cb3cb285',payableId:'CP-T059',advanceAmount:1300.02},{db});
  assert.equal(result.payable.status,'Pendente');
  assert.equal(result.payable.valor,7403.48);
  assert.equal(db.state.erp.tickets.T059.saldoPagar,7403.48);
  assert.equal(db.state.erp.adiantamentos.F089.filter(a=>a.status==='Pendente').length,0);
  assert.equal(db.state.erp.lancBanco['LB-089'].valor,10003.52);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
});

test('compensação não permite usar crédito de fornecedor diferente',async()=>{
  const db=fakeDb();
  await assert.rejects(()=>payPayable(actor,{...input,fornCod:'F001'},{db}),{code:'SUPPLIER_MISMATCH'});
  assert.equal(db.updates,0);
});

test('falha remota mantém adiantamento, título e movimento intactos',async()=>{
  const db=fakeDb();db.failOnce();
  await assert.rejects(()=>payPayable(actor,input,{db}),/permission_denied/);
  assert.equal(db.updates,0);
  assert.equal(db.state.erp.contasPagar['CP-T089'].status,'Pendente');
  assert.equal(db.state.erp.adiantamentos.F089[0].valor,10003.52);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,1);
});

test('registro parcialmente compensado não pode ser editado nem excluído apagando débito original',async()=>{
  const db=fakeDb();await payPayable(actor,input,{db});
  const pending=db.state.erp.adiantamentos.F089[0];
  const expected=Object.fromEntries(['cod','valor','data','forma','bancoCod','movBancoId','status','ticket','empresa','obs'].map(k=>[k,pending[k]??'']));
  for(const action of ['edit','delete']){
    await assert.rejects(()=>changeAdvance(actor,{action,fornCod:'F089',adtCod:pending.cod,operationId:action==='edit'?'9b55cc37-e8d7-4cd3-918e-614e4100b4c9':'87eb107f-7c06-4140-8071-dc2a9a37b231',expected},{db}),{code:'ADVANCE_ALREADY_COMPENSATED'});
  }
  assert.equal(db.state.erp.lancBanco['LB-089'].valor,10003.52);
});

test('navegador envia a data correta para a API e não exige banco se compensação for integral',async()=>{
  const start=core.indexOf('async function confirmarPagarCP(');
  const end=core.indexOf('function confirmarAcao(',start);
  assert.ok(start>0&&end>start);
  const elems={
    'modal-body':{dataset:{paymentOperation:operationId},querySelectorAll:()=>[]},
    'pcp-id':{value:'CP-T089'},'pcp-valor-pagar':{value:'8703.5'},'pcp-adt':{value:'8703.5',max:'8703.5'},
    'pcp-banco':{value:'BC-007'},'pcp-data':{value:'2026-11-04'},'pcp-forn-cod':{value:'F089'},'pcp-obs':{value:''}
  };
  let sent=null,closed=false;
  const payable={id:'CP-T089',valor:8703.50,status:'Pendente',ticket:'T089',fornCod:'F089'};
  const ctx={
    document:{getElementById:id=>elems[id]},CONTAS_PAGAR:[payable],ADT_POR_FORN:{F089:[]},TICKETS_DB:{},
    _cpIdxPorId:()=>0,firebase:{auth:()=>({currentUser:{uid:'user1',getIdToken:async()=> 'token'}})},
    fetch:async(url,opts)=>{sent={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>({payable:{...payable,status:'Pago'},advanceEntries:[],fornCod:'F089'})};},
    showToast(){},renderContasPagar(){},renderAdiantamentos(){},renderTickets(){},renderFluxo(){},renderDashboard(){},
    cm(){closed=true;},console
  };
  runInNewContext('const _cpPendingPayments=new Map();'+core.slice(start,end)+';this.submit=confirmarPagarCP;',ctx);
  await ctx.submit('pagar-tudo');
  assert.equal(sent.body.date,'2026-11-04');
  assert.equal(sent.body.amount,0);
  assert.equal(sent.body.bankCode,'');
  assert.equal(sent.body.advanceAmount,8703.50);
  assert.equal(closed,true);
});

test('pagamento bancário envia data e banco sem referência JavaScript indefinida',async()=>{
  const start=core.indexOf('async function confirmarPagarCP(');
  const end=core.indexOf('function confirmarAcao(',start);
  const elems={
    'modal-body':{dataset:{paymentOperation:operationId},querySelectorAll:()=>[]},
    'pcp-id':{value:'CP-T080'},'pcp-valor-pagar':{value:'2794.80'},'pcp-adt':null,
    'pcp-banco':{value:'BC-007'},'pcp-data':{value:'2026-11-03'},'pcp-forn-cod':{value:'F080'},'pcp-obs':{value:''}
  };
  const payable={id:'CP-T080',valor:2794.80,status:'Pendente',ticket:'T080',fornCod:'F080'};
  let sent=null;
  const ctx={document:{getElementById:id=>elems[id]},CONTAS_PAGAR:[payable],ADT_POR_FORN:{},TICKETS_DB:{},
    _cpIdxPorId:()=>0,firebase:{auth:()=>({currentUser:{uid:'user1',getIdToken:async()=> 'token'}})},
    fetch:async(url,opts)=>{sent=JSON.parse(opts.body);return {ok:true,json:async()=>({payable:{...payable,status:'Pago'}})};},
    showToast(){},renderContasPagar(){},renderAdiantamentos(){},renderTickets(){},renderFluxo(){},renderDashboard(){},cm(){},console
  };
  runInNewContext('const _cpPendingPayments=new Map();'+core.slice(start,end)+';this.submit=confirmarPagarCP;',ctx);
  await ctx.submit('pagar-tudo');
  assert.equal(sent.date,'2026-11-03');
  assert.equal(sent.bankCode,'BC-007');
  assert.equal(sent.amount,2794.80);
  assert.equal(sent.advanceAmount,0);
});

test('conta legada sem código mantém compensação quando fornecedor é verificado pelo nome',async()=>{
  const db=fakeDb();
  delete db.state.erp.contasPagar['CP-T089'].fornCod;
  delete db.state.erp.tickets.T089.fornecedorCod;
  const result=await payPayable(actor,input,{db});
  assert.equal(result.payable.status,'Pago');
  assert.equal(db.updates,1);
});

test('conta legada com fornecedor divergente não consome crédito de outra pessoa',async()=>{
  const db=fakeDb();
  delete db.state.erp.contasPagar['CP-T089'].fornCod;
  delete db.state.erp.tickets.T089.fornecedorCod;
  db.state.erp.contasPagar['CP-T089'].cred='Fornecedor Diferente';
  await assert.rejects(()=>payPayable(actor,input,{db}),{code:'SUPPLIER_NOT_VERIFIED'});
  assert.equal(db.updates,0);
});
