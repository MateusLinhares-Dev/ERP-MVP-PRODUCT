import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {editPurchaseOrder} from '../server/application/purchase-order-edit.js';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const template=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const identity={erpAccess:true,canPurchasing:true,uid:'tester',erpUser:'engenharia'};
const uuid='a3b10989-6fc8-4e18-819c-b09712ee38be';
const original=()=>({
 ticket:'T198',fornecedor:'GILBERTO RAMOS',fornecedorCod:'F198',totalGeral:76850.85,totalProdutos:76850.85,
 adiantamento:79949.50,saldoPagar:-3098.65,status:'Pago',dataCompra:'2026-11-05',vencimentoSaldo:'2026-11-05',
 itens:[{mat:'ALUMINIO',pesoLiq:1,pesoBruto:1,quantidade:1,preco:76850.85,total:76850.85}]
});
const copy=value=>value==null?null:structuredClone(value);
function database(override={}){
 const records={
  'erp/tickets/T198':original(),
  'erp/adiantamentos/F198':[
    {cod:'ADT-ORIGINAL',status:'Pendente',valor:3098.65,valorOriginal:79949.50,valorCompensado:76850.85,forma:'PIX'},
    {cod:'ADT-PARCIAL',status:'Quitado',ticket:'T198',valor:76850.85,adiantamentoOrigem:'ADT-ORIGINAL'}
  ],
  'erp/saldos/F198':{ticket:'T198',valor:3098.65},
  'erp/saldoDevedor/F198':{ticket:'T198',valor:3098.65},
  'erp/contasPagar':[],
  ...override
 };
 const updates=[];
 const db={ref(path){return {
  get:async()=>({val:()=>copy(records[path])}),
  transaction:async callback=>{
    const candidate=callback(copy(records[path]));
    if(candidate===undefined)return {committed:false};
    records[path]=copy(candidate);
    return {committed:true,snapshot:{val:()=>copy(candidate)}};
  },
  update:async change=>{
    updates.push(copy(change));
    for(const [key,value] of Object.entries(change))records[path+'/'+key]=copy(value);
  }
 };}};
 return {records,updates,db};
}
function edit(ticket,price,operationId=uuid){
 const next=copy(ticket);
 next.itens[0].preco=price;
 next.itens[0].total=price;
 next.totalGeral=price;
 next.totalProdutos=price;
 next.saldoPagar=Number((ticket.saldoPagar+price-ticket.totalGeral).toFixed(2));
 return {ticketNo:ticket.ticket,operationId,expectedTicket:ticket,ticket:next};
}

test('T198 legado sem recibo: comprovante único permite correção atômica de R$ 54,80',async()=>{
 const env=database();
 const result=await editPurchaseOrder(identity,edit(original(),76796.05),{db:env.db});
 assert.equal(result.ticket.saldoPagar,-3153.45);
 assert.equal(result.ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,76796.05);
 assert.equal(result.ticket.reciboFinanceiro.adiantamentos[0].valorPendente,3153.45);
 assert.equal(env.records['erp/adiantamentos/F198'][0].valor,3153.45);
 assert.equal(env.records['erp/adiantamentos/F198'][0].valorCompensado,76796.05);
 assert.equal(env.records['erp/saldos/F198'].valor,3153.45);
 assert.equal(env.records['erp/saldoDevedor/F198'].valor,3153.45);
 assert.equal(env.updates.length,1);
});

test('recibo legado ambíguo bloqueia edição sem gravar ticket ou crédito',async()=>{
 const env=database();
 env.records['erp/adiantamentos/F198'].push(copy(env.records['erp/adiantamentos/F198'][0]));
 await assert.rejects(editPurchaseOrder(identity,edit(original(),76796.05),{db:env.db}),{code:'ADVANCE_RECONCILIATION_REQUIRED'});
 assert.equal(env.records['erp/tickets/T198'].totalGeral,76850.85);
 assert.equal(env.updates.length,0);
});

test('pedido com PIX parcial preserva pagamento bancário e ajusta só saldo pendente',async()=>{
 const ticket=original();
 ticket.adiantamento=300;ticket.totalGeral=1000;ticket.totalProdutos=1000;ticket.saldoPagar=500;ticket.status='Pendente';
 ticket.itens[0].preco=1000;ticket.itens[0].total=1000;
 const payment={id:'CP-1',ticket:'T198',status:'Pendente',valor:500,valorPago:200,pagamentos:[{valor:200,movBancoId:'LB-1'}]};
 const env=database({'erp/tickets/T198':ticket,'erp/contasPagar':[payment]});
 const saved=await editPurchaseOrder(identity,edit(ticket,1100),{db:env.db});
 assert.equal(saved.ticket.saldoPagar,600);
 assert.equal(saved.payable.valor,600);
 assert.equal(saved.payable.valorPago,200);
 assert.deepEqual(saved.payable.pagamentos,payment.pagamentos);
 assert.equal(env.records['erp/contasPagar/0'].pagamentos[0].movBancoId,'LB-1');
 assert.equal(env.updates.length,1);
});

test('compra quitada em PIX ganha título de diferença sem reabrir saída bancária antiga',async()=>{
 const ticket=original();
 ticket.adiantamento=0;ticket.totalGeral=1000;ticket.totalProdutos=1000;ticket.saldoPagar=0;ticket.status='Pago';
 ticket.itens[0].preco=1000;ticket.itens[0].total=1000;
 const payment={id:'CP-OLD',ticket:'T198',status:'Pago',valor:1000,valorPago:1000,pagamentos:[{valor:1000,movBancoId:'LB-OLD'}]};
 const env=database({'erp/tickets/T198':ticket,'erp/contasPagar':[payment]});
 const saved=await editPurchaseOrder(identity,edit(ticket,1100),{db:env.db});
 assert.equal(saved.ticket.saldoPagar,100);
 assert.equal(saved.payable.valor,100);
 assert.equal(saved.payable.status,'Pendente');
 assert.equal(env.records['erp/contasPagar/1'].valor,100);
 assert.equal(env.records['erp/contasPagar'][0].status,'Pago');
 assert.equal(env.records['erp/contasPagar'][0].pagamentos[0].movBancoId,'LB-OLD');
 assert.equal(env.updates.length,1);
});

test('compra quitada em PIX não transforma redução em crédito sem processo de estorno',async()=>{
 const ticket=original();
 ticket.adiantamento=0;ticket.totalGeral=1000;ticket.totalProdutos=1000;ticket.saldoPagar=0;ticket.status='Pago';
 ticket.itens[0].preco=1000;ticket.itens[0].total=1000;
 const env=database({'erp/tickets/T198':ticket,'erp/contasPagar':[{ticket:'T198',status:'Pago',valorPago:1000,pagamentos:[{valor:1000}]}]});
 await assert.rejects(editPurchaseOrder(identity,edit(ticket,950),{db:env.db}),{code:'FINANCE_RECONCILIATION_REQUIRED'});
 assert.equal(env.updates.length,0);
});

test('histórico de compras não grava Firebase durante filtros nem muda saldo',()=>{
 const start=core.indexOf('function renderTickets(){');
 const end=core.indexOf('function excluirEntradaCompra(',start);
 const source=core.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(source,/saveDB\(/);
 assert.doesNotMatch(source,/saveContasPagar\(/);
 assert.match(source,/ERPListPager\?\.slice\('compra-historico'/);
 assert.match(source,/all\.sort\(compararTicketsHistorico\)/);
 assert.match(template,/window\.ERPListPager\?\.reset\('compra-historico'\);renderTickets\(\)/);
 assert.match(source,/Reabrir edição/);
});

test('nova compra consulta número disponível na nuvem antes do legado criar',async()=>{
 const begin=purchase.indexOf('async function checkAvailablePurchaseNumber(){');
 const end=purchase.indexOf('async function purchaseEditWithReconciliation(',begin);
 assert.ok(begin>=0&&end>begin);
 const store={hw:230};
 const tickets={T230:true};
 const cloud={'erp/tickets/T231':true,'erp/tickets/T232':true};
 const global={firebase:{auth:()=>({currentUser:{uid:'test'}})},_fbDB:{ref:path=>({once:async()=>({val:()=>cloud[path]??null})})}};
 const ctx={global,localStorage:{setItem:(key,value)=>{if(key==='mm_ticket_hw')store.hw=Number(value);}},getNextTicketId:()=>{
  const num=Math.max(store.hw,230)+1;store.hw=num;return 'T'+num;
 }};
 const fn=runInNewContext(purchase.slice(begin,end)+';checkAvailablePurchaseNumber',ctx);
 const next=await fn();
 assert.equal(next,'T233');
 assert.equal(store.hw,232);
 assert.equal(ctx.getNextTicketId(),'T233');
 assert.match(purchase,/const availableNumber=body\.dataset\.purchaseReservedNumber\|\|await checkAvailablePurchaseNumber\(\)/);
});

test('sincronização de empresas aplica eventos mais novos e preserva versão por sessão',()=>{
 const begin=core.indexOf('function _cfgPublicBusiness(){');
 const end=core.indexOf('function gerenciarEmpresasFuncionarios(){',begin);
 const script=core.slice(begin,end);
 function session(){
  const config={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor']};
  let changes=0;
  const window={__PUBLIC_BUSINESS_CONFIG__:{employeeCompanies:['Manuela Metais','Mabor']}};
  const ctx={window,ERP_BUSINESS_CONFIG:config,EMPRESAS_INFO:{},document:{getElementById:()=>null,dispatchEvent:()=>{}},CustomEvent:class {},esc:String,
   _erpRefreshCompanySources(){changes++;},_popularEmpresasDespesa(){},state:{get:()=>changes}};
  runInNewContext(script,ctx);
  return ctx;
 }
 const first=session(),second=session();
 const make=rev=>({employeeCompanies:['Manuela Metais','Mabor','Sítio Mabor'],inactiveCompanies:[],deletedCompanies:[],companyDirectoryRevision:rev});
 assert.equal(first._erpApplyCompanyDirectory(make(8)),true);
 assert.equal(second._erpApplyCompanyDirectory(make(8)),true);
 assert.ok(Array.from(first._cfgEmployeeCompanies()).includes('Sítio Mabor'));
 assert.ok(Array.from(second._cfgFinanceCompanies()).includes('Sítio Mabor'));
 assert.equal(second._erpApplyCompanyDirectory(make(7)),false);
 assert.equal(second._erpApplyCompanyDirectory(make(8)),false);
 assert.equal(second.state.get(),1);
 assert.match(sync,/ref\('erp\/companyDirectory'\)\.on\('value'/);
 assert.match(sync,/addEventListener\('visibilitychange'/);
});
