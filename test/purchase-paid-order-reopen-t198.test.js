import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editPurchaseOrder} from '../server/application/purchase-order-edit.js';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const identity={erpAccess:true,canPurchasing:true,uid:'test-user',erpUser:'engAdministrator'};
const operation='b66f8d67-20c7-4a1e-9384-d4d215f42abc';
const advanceCode='ADTMW3FQY2A79203A81';
const original=()=>({
  ticket:'T198',fornecedor:'GILBERTO RAMOS',fornecedorCod:'F500',status:'Pago',
  dataCompra:'2026-11-05',vencimentoSaldo:'2026-11-05',totalGeral:76850.85,totalProdutos:76850.85,
  saldoPagar:-3098.65,adiantamento:79949.5,descontoCompra:0,freteCompra:0,
  itens:[{mat:'PERFIL PINTADO',pesoLiq:1,pesoBruto:1,quantidade:1,preco:76850.85,total:76850.85}],
  pedidoCompra:{numero:'T198',totalPedido:76850.85,dataCompra:'2026-11-05'},
  reciboFinanceiro:{versao:1,total:79949.5,adiantamentos:[{cod:advanceCode,valorOriginal:79949.5,valorAplicado:76850.85,valorPendente:3098.65}],cheques:[]}
});
function setup(){
 const data={
  'erp/tickets/T198':original(),
  'erp/adiantamentos/F500':[
   {cod:advanceCode,valor:3098.65,valorOriginal:79949.5,valorCompensado:76850.85,status:'Pendente',ticket:''},
   {cod:'ADT-PARTIAL',valor:76850.85,status:'Quitado',ticket:'T198',obs:'Quitação parcial de '+advanceCode}
  ],
  'erp/saldos/F500':{ticket:'T198',valor:3098.65,data:'2026-11-05'},
  'erp/saldoDevedor/F500':{ticket:'T198',valor:3098.65,data:'2026-11-05'},
  'erp/contasPagar':[]
 };
 const changes=[];
 function ref(path){return {
  get:async()=>({val:()=>structuredClone(data[path]??null)}),
  transaction:async updater=>{const result=updater(structuredClone(data[path]??null));if(result===undefined)return {committed:false};data[path]=structuredClone(result);return {committed:true};},
  update:async updates=>{changes.push(structuredClone(updates));for(const [k,v] of Object.entries(updates))data[path+'/'+k]=structuredClone(v);}
 };}
 const edited=original();edited.itens[0]={...edited.itens[0],preco:76796.05,total:76796.05};
 edited.totalProdutos=76796.05;edited.totalGeral=76796.05;edited.saldoPagar=-3153.45;
 const input={ticketNo:'T198',operationId:operation,expectedTicket:original(),ticket:edited};
 return {data,db:{ref},input,changes};
}
test('edição de T198 concilia pedido, recibo e adiantamento na mesma atualização',async()=>{
 const x=setup();const response=await editPurchaseOrder(identity,x.input,{db:x.db,now:()=>1793910000000,uuid:()=>operation});
 assert.equal(response.ticket.totalGeral,76796.05);
 assert.equal(response.ticket.saldoPagar,-3153.45);
 assert.equal(response.ticket.status,'Pago');
 assert.equal(response.ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,76796.05);
 assert.equal(response.ticket.reciboFinanceiro.adiantamentos[0].valorPendente,3153.45);
 assert.equal(x.data['erp/adiantamentos/F500'][0].valor,3153.45);
 assert.equal(x.data['erp/adiantamentos/F500'][0].valorCompensado,76796.05);
 assert.equal(x.data['erp/adiantamentos/F500'][1].valor,76796.05);
 assert.equal(x.data['erp/saldos/F500'].valor,3153.45);
 assert.equal(x.data['erp/saldoDevedor/F500'].valor,3153.45);
 assert.equal(x.changes.length,1);
 assert.ok(x.changes[0]['tickets/T198']);
 assert.ok(x.changes[0]['adiantamentos/F500']);
 assert.equal(x.changes[0]['saldos/F500'].valor,3153.45);
});
test('operação idempotente não grava segunda correção financeira',async()=>{
 const x=setup();await editPurchaseOrder(identity,x.input,{db:x.db,now:()=>1793910000000,uuid:()=>operation});
 const second=await editPurchaseOrder(identity,x.input,{db:x.db,now:()=>1793910000001,uuid:()=>operation});
 assert.equal(second.alreadyCommitted,true);assert.equal(x.changes.length,1);
});
test('conflito no pedido não altera crédito ou registro existente',async()=>{
 const x=setup();x.data['erp/tickets/T198'].totalGeral=80000;
 await assert.rejects(editPurchaseOrder(identity,x.input,{db:x.db,uuid:()=>operation}),{code:'TICKET_CHANGED'});
 assert.equal(x.data['erp/adiantamentos/F500'][0].valor,3098.65);assert.equal(x.changes.length,0);
});
test('conflito no adiantamento não regrava ticket nem conta',async()=>{
 const x=setup();x.data['erp/adiantamentos/F500'][0].valorCompensado=76800;
 await assert.rejects(editPurchaseOrder(identity,x.input,{db:x.db,uuid:()=>operation}),{code:'ADVANCE_CHANGED'});
 assert.equal(x.data['erp/tickets/T198'].totalGeral,76850.85);assert.equal(x.changes.length,0);
});
test('pagamento bancário preexistente impede recomposição de crédito',async()=>{
 const x=setup();x.data['erp/contasPagar']=[{ticket:'T198',valorPago:100,pagamentos:[{valor:100}]}];
 await assert.rejects(editPurchaseOrder(identity,x.input,{db:x.db,uuid:()=>operation}),{code:'PAID_AND_ADVANCE_RECONCILIATION_REQUIRED'});
 assert.equal(x.changes.length,0);
});
test('perfil sem compras não consegue alterar o pedido',async()=>{
 const x=setup();await assert.rejects(editPurchaseOrder({...identity,canPurchasing:false},x.input,{db:x.db}),{code:'PURCHASE_FORBIDDEN'});
 assert.equal(x.changes.length,0);
});
test('frontend lê a versão oficial sem clamping e evita alteração financeira local antecipada',()=>{
 assert.match(purchase,/originalBalance:Number\(ticket\.saldoPagar\|\|0\)/);
 assert.match(purchase,/const remote=await purchaseCloudRef\(entry\[0\]\)\.once\('value'\)/);
 assert.match(purchase,/ticket=state\.ticketSnapshot\?JSON\.parse\(state\.ticketSnapshot\):null/);
 assert.match(purchase,/await purchaseEditWithReconciliation/);
 assert.match(purchase,/afterConfirmedPurchaseEdit\(confirmed,state,totals\)/);
 assert.match(core,/if\(!ticket\._pagoUndo\)/);
 assert.match(core,/phase4PurchaseEditTicket\(dbKey\)/);
});

test('crédito já consumido por outra compra impede regravar adiantamento',async()=>{
 const x=setup();x.data['erp/saldos/F500'].ticket='T199';
 await assert.rejects(editPurchaseOrder(identity,x.input,{db:x.db,uuid:()=>operation}),{code:'CREDIT_CHANGED'});
 assert.equal(x.data['erp/tickets/T198'].totalGeral,76850.85);
 assert.equal(x.changes.length,0);
});
test('edição de compra parcialmente abatida atualiza apenas conta em aberto',async()=>{
 const x=setup();
 const t=original();t.totalGeral=1000;t.totalProdutos=1000;t.saldoPagar=700;t.adiantamento=300;
 t.itens=[{mat:'COBRE',quantidade:10,pesoLiq:10,preco:100,total:1000}];
 t.reciboFinanceiro.adiantamentos=[{cod:advanceCode,valorOriginal:300,valorAplicado:300,valorPendente:0}];
 x.data['erp/tickets/T198']=t;
 x.data['erp/contasPagar']=[{ticket:'T198',id:'CP100',status:'Pendente',valor:700,pagamentos:[]}];
 const next=structuredClone(t);next.itens[0].preco=120;next.itens[0].total=1200;
 next.totalGeral=1200;next.totalProdutos=1200;next.saldoPagar=900;
 x.input.expectedTicket=t;x.input.ticket=next;
 const saved=await editPurchaseOrder(identity,x.input,{db:x.db,uuid:()=>operation});
 assert.equal(saved.ticket.saldoPagar,900);
 assert.equal(x.data['erp/contasPagar/0'].valor,900);
 assert.equal(x.data['erp/tickets/T198'].saldoPagar,900);
 assert.equal(x.changes[0]['adiantamentos/F500'],undefined);
 assert.equal(x.changes.length,1);
});
test('desmarcar compra liquidada não cria dívida nem modifica ticket local',async()=>{
 const start=core.indexOf('async function desmarcarCompraPaga(dbKey){');
 const end=core.indexOf("window['desmarcarCompraPaga']=desmarcarCompraPaga;",start);
 assert.ok(start>=0&&end>start);
 const ticket={ticket:'T198',status:'Pago',totalGeral:76850.85,adiantamento:79949.5,saldoPagar:-3098.65};
 let called=0;
 const ctx={TICKETS_DB:{T198:ticket},showToast(){},window:{phase4PurchaseEditTicket:async key=>{called++;assert.equal(key,'T198');}}};
 const {runInNewContext}=await import('node:vm');
 await runInNewContext(core.slice(start,end)+';desmarcarCompraPaga("T198")',ctx);
 assert.equal(called,1);
 assert.equal(ticket.saldoPagar,-3098.65);
 assert.equal(ticket.status,'Pago');
});
test('desfazer marcação manual só altera o pedido depois do commit Firebase',async()=>{
 const start=core.indexOf('async function desmarcarCompraPaga(dbKey){');
 const end=core.indexOf("window['desmarcarCompraPaga']=desmarcarCompraPaga;",start);
 const {runInNewContext}=await import('node:vm');
 const cloud={ticket:'T100',status:'Pago',saldoPagar:0,adiantamento:0,
  _pagoUndo:{status:'Pendente',saldoPagar:400,adiantamento:0}};
 const local=structuredClone(cloud);
 let committed=0,localSaves=0;
 const ref={
  transaction:async updater=>{const next=updater(structuredClone(cloud));if(!next)return {committed:false};Object.assign(cloud,next);delete cloud._pagoUndo;committed++;return {committed:true};},
  once:async()=>({val:()=>structuredClone(cloud)})
 };
 const ctx={TICKETS_DB:{T100:local},_ticketsSnapJSON:{},CONTAS_PAGAR:[],
  confirm:()=>true,showToast(){},saveDB(){localSaves++;},renderTickets(){},renderFluxo(){},renderDashboard(){},
  window:{_fbDB:{ref:()=>ref},firebase:{auth:()=>({currentUser:{uid:'test'}})}}};
 await runInNewContext(core.slice(start,end)+';desmarcarCompraPaga("T100")',ctx);
 assert.equal(committed,1);
 assert.equal(localSaves,1);
 assert.equal(ctx.TICKETS_DB.T100.saldoPagar,400);
 assert.equal(ctx.TICKETS_DB.T100.status,'Pendente');
 assert.equal(ctx._ticketsSnapJSON.T100,JSON.stringify(ctx.TICKETS_DB.T100));
});
