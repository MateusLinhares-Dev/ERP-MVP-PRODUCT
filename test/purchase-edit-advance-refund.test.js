import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startFakeRtdb} from './support/fake-rtdb-server.mjs';

let srv,db,app,mod={};
const identity={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPurchasing:true,canAdvances:true,canPayables:true,canFinance:true,canBanking:true};
const today='2026-11-08';
const viaSdk=async path=>(await db.ref(path).get()).val();
const advanceOf=async(code)=>(await viaSdk('erp/adiantamentos/F1')).find(row=>row.cod===code);

function seed(){
  srv.reset({erp:{fornecedores:{f1:{cod:'F1',nome:'TESTE NAO APAGAR',ativo:true}},bancos:{b1:{cod:'B1',banco:'Conta Principal'}},_ts:1}});
}
function ticketOf(no,kg,price){
  const total=Math.round(kg*price*100)/100;
  return {ticket:no,fornecedorCod:'F1',fornecedor:'TESTE NAO APAGAR',fornecedorNome:'TESTE NAO APAGAR',
    itens:[{mat:'COBRE',pesoLiq:kg,quantidade:kg,preco:price,total}],totalProdutos:total,totalGeral:total,
    descontoCompra:0,freteCompra:0,dataCompra:today,vencimentoSaldo:today,status:'Pendente',_consolidado:true,_purchaseOperationId:'x'};
}
async function advance(valor){
  const r=await mod.createAdvance(identity,{operationId:randomUUID(),fornCod:'F1',data:today,valor,forma:'PIX',bancoCod:'B1'},{db});
  return r.advance.cod;
}
async function purchase(no,kg,price,codes){
  await mod.createPurchaseOrder(identity,{ticketNo:no,fornecedorCod:'F1',operationId:randomUUID(),ticket:ticketOf(no,kg,price),advanceCodes:codes},{db});
  return viaSdk('erp/tickets/'+no);
}
async function edit(no,kg,price){
  const current=await viaSdk('erp/tickets/'+no);
  const next=structuredClone(current);
  next.itens[0]={...next.itens[0],pesoLiq:kg,quantidade:kg,preco:price,total:Math.round(kg*price*100)/100};
  next.totalGeral=next.totalProdutos=Math.round(kg*price*100)/100;
  return mod.editPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:no,expectedTicket:current,ticket:next},{db});
}
const locks=()=>[srv.read('erpFinanceAdvanceLocks'),srv.read('erpFinancePayableTicketLocks')].filter(Boolean);

before(async()=>{
  srv=await startFakeRtdb({namespace:'demo-refund-test'});
  process.env.USE_FIREBASE_EMULATORS='true';
  process.env.FIREBASE_PROJECT_ID='demo-refund-test';
  process.env.FIREBASE_DATABASE_URL=srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST=srv.host;
  process.env.FIREBASE_STORAGE_BUCKET='demo-refund-test.appspot.com';
  delete process.env.APP_ENV;delete process.env.VERCEL_ENV;
  const firebase=await import('../server/shared/firebase/firebase-admin.js');
  ({app,db}=firebase.getFirebaseAdmin());
  mod={...(await import('../server/modules/advances/application/advances.js')),
    ...(await import('../server/modules/purchases/application/create-purchase-order.js')),
    ...(await import('../server/modules/purchases/application/edit-purchase-order.js')),
    ...(await import('../server/modules/payables/application/payables.js')),
    ...(await import('../server/modules/purchases/application/delete-purchase-order.js'))};
});
after(async()=>{try{await app?.delete();}catch{}await srv?.close();});

test('compra quitada 100% com adiantamento: reduzir devolve a diferença ao adiantamento',async()=>{
  seed();
  const code=await advance(1000);
  const created=await purchase('T100',100,10,[code]);
  assert.equal(created.status,'Pago');
  assert.equal((await advanceOf(code)).status,'Quitado');
  const saved=await edit('T100',90,10);
  assert.deepEqual(saved.advanceRefund,{valor:100,adiantamentos:[{cod:code,valor:100}]});
  const ticket=await viaSdk('erp/tickets/T100');
  assert.equal(ticket.totalGeral,900);assert.equal(ticket.adiantamento,900);assert.equal(ticket.saldoPagar,0);assert.equal(ticket.status,'Pago');
  assert.equal(ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,900);
  assert.equal(ticket.reciboFinanceiro.total,900);
  const adt=await advanceOf(code);
  assert.equal(adt.status,'Pendente');assert.equal(adt.valor,100);assert.equal(adt.valorDisponivel,100);
  assert.equal(adt.valorCompensado,900);assert.equal(adt.valorOriginal,1000);
  assert.equal(adt.ticket,'');assert.equal(adt.ticketOrigem,'T100');
  assert.equal(srv.read('erp/contasPagar'),null,'nenhuma conta a pagar criada');
  assert.deepEqual(locks(),[],'travas liberadas');
  const next=await purchase('T101',10,10,[code]);
  assert.equal(next.adiantamento,100);assert.equal(next.status,'Pago');
  const used=await advanceOf(code);
  assert.equal(used.status,'Quitado');assert.equal(used.valorCompensado,1000);
});

test('adiantamento parcial + conta a pagar em aberto: zera a conta e devolve o excedente',async()=>{
  seed();
  const code=await advance(500);
  await purchase('T200',80,10,[code]);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T200')).valor,300);
  const saved=await edit('T200',40,10);
  assert.equal(saved.advanceRefund.valor,100);
  const ticket=await viaSdk('erp/tickets/T200');
  assert.equal(ticket.adiantamento,400);assert.equal(ticket.saldoPagar,0);assert.equal(ticket.status,'Pago');
  const payable=await viaSdk('erp/contasPagar/CPPO_T200');
  assert.equal(payable.status,'Pago');assert.equal(payable.valor,0);
  const adt=await advanceOf(code);
  assert.equal(adt.valorDisponivel,100);assert.equal(adt.valorCompensado,400);assert.equal(adt.status,'Pendente');
});

test('devolução total libera o adiantamento por completo (pode até ser editado/excluído de novo)',async()=>{
  seed();
  const code=await advance(300);
  await purchase('T300',30,10,[code]);
  await edit('T300',1,0.01);
  const adt=await advanceOf(code);
  assert.equal(adt.valorCompensado,0.01);assert.equal(adt.valorDisponivel,299.99);
  assert.equal(adt.ticketOrigem,'T300','ainda há consumo: mantém a origem');
});

test('redução maior que o pago com adiantamento (parte paga no banco) continua bloqueada',async()=>{
  seed();
  const code=await advance(500);
  await purchase('T400',80,10,[code]);
  await mod.payPayable(identity,{payableId:'CPPO_T400',operationId:randomUUID(),bankCode:'B1',date:today,amount:300,
    expected:{valor:300,status:'Pendente',paymentsCount:0}},{db});
  await assert.rejects(()=>edit('T400',20,10),{code:'PAID_REFUND_REQUIRED',message:/estorno no financeiro/});
  assert.equal((await viaSdk('erp/tickets/T400')).totalGeral,800,'nada alterado');
  assert.equal((await advanceOf(code)).valorCompensado,500);
  assert.deepEqual(locks(),[]);
  const saved=await edit('T400',70,10);
  assert.equal(saved.advanceRefund.valor,100);
  assert.equal((await advanceOf(code)).valorDisponivel,100);
});

test('adiantamento alterado depois da compra bloqueia a devolução sem gravar nada',async()=>{
  seed();
  const code=await advance(1000);
  await purchase('T500',100,10,[code]);
  const list=await viaSdk('erp/adiantamentos/F1');
  list[0].valorCompensado=950;
  srv.seed('erp/adiantamentos/F1',list);
  await assert.rejects(()=>edit('T500',90,10),{code:'ADVANCE_CHANGED'});
  assert.equal((await viaSdk('erp/tickets/T500')).totalGeral,1000);
});

test('excluir compra paga com adiantamento devolve tudo e libera o adiantamento',async()=>{
  seed();
  const code=await advance(1000);
  await purchase('T600',60,10,[code]);
  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T600',expectedTotal:600,expectedSupplier:'F1'},{db});
  assert.equal(removed.status,'CONFIRMED');
  assert.deepEqual(removed.advanceRefund,{valor:600,adiantamentos:[{cod:code,valor:600}]});
  assert.equal(await viaSdk('erp/tickets/T600'),null);
  assert.equal(await viaSdk('erp/ticketsDeletedV2/T600'),true);
  const adt=await advanceOf(code);
  assert.equal(adt.status,'Pendente');assert.equal(adt.valor,1000);assert.equal(adt.valorCompensado,0);
  assert.equal(adt.ticketOrigem,undefined,'nada mais consumido: adiantamento livre');
  assert.ok(await viaSdk('erp/lancBanco/'+adt.movBancoId),'PIX do adiantamento continua no extrato');
  assert.deepEqual(locks(),[]);
  const change=await mod.changeAdvance(identity,{action:'delete',operationId:randomUUID(),fornCod:'F1',adtCod:code,expected:adt},{db});
  assert.equal(change.removedCode,code);
});

test('excluir compra com adiantamento parcial e conta pendente remove a conta e devolve',async()=>{
  seed();
  const code=await advance(500);
  await purchase('T700',80,10,[code]);
  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T700',expectedTotal:800},{db});
  assert.deepEqual(removed.deletedPayableIds,['CPPO_T700']);
  assert.equal(await viaSdk('erp/contasPagar/CPPO_T700'),null);
  assert.equal((await advanceOf(code)).valorDisponivel,500);
});

test('excluir compra com adiantamento E pagamento no banco continua bloqueado',async()=>{
  seed();
  const code=await advance(500);
  await purchase('T800',80,10,[code]);
  await mod.payPayable(identity,{payableId:'CPPO_T800',operationId:randomUUID(),bankCode:'B1',date:today,amount:100,
    expected:{valor:300,status:'Pendente',paymentsCount:0}},{db});
  await assert.rejects(()=>mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T800'},{db}),{code:'PURCHASE_HAS_PAYMENTS'});
  assert.ok(await viaSdk('erp/tickets/T800'));
  assert.equal((await advanceOf(code)).valorCompensado,500);
  assert.deepEqual(locks(),[]);
});

test('compra reduzida (conta encerrada em R$ 0) ainda pode ser excluída depois',async()=>{
  seed();
  const code=await advance(500);
  await purchase('T900',80,10,[code]);
  await edit('T900',40,10);
  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T900'},{db});
  assert.equal(removed.status,'CONFIRMED');
  assert.equal((await advanceOf(code)).valorDisponivel,500);
});
