import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createPurchaseOrder} from '../server/modules/purchases/application/create-purchase-order.js';

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function fakeDb(seed){
  let data=clone(seed);
  const counters={updates:0};
  const get=path=>path.split('/').filter(Boolean).reduce((cur,key)=>cur?.[key],data);
  const put=(path,value)=>{
    const keys=path.split('/').filter(Boolean);if(!keys.length)throw Error('root update only');
    let current=data;
    for(const k of keys.slice(0,-1))current=current[k]??=(isNaN(Number(keys[keys.length-1]))?{}:{});
    if(value===null)delete current[keys.at(-1)];else current[keys.at(-1)]=clone(value);
  };
  return {counters,peek:get,ref(path=''){
    return {
      async get(){return {val:()=>clone(get(path))??null};},
      async transaction(fn){const value=fn(clone(get(path))??null);if(value===undefined)return {committed:false};put(path,value);return {committed:true};},
      async update(updates){
        counters.updates++;
        for(const [key,val] of Object.entries(updates))put([path,key].filter(Boolean).join('/'),val);
      }
    };
  }};
}
const identity={erpAccess:true,canPurchasing:true,uid:'user1',erpUser:'elaine'};
function order(no,amount){return {ticket:no,fornecedorCod:'F1',fornecedor:'TESTE NAO APAGAR',itens:[{mat:'ANTIMONIO',pesoLiq:3,preco:amount/3}],totalGeral:amount,totalProdutos:amount,dataCompra:'2026-11-06',vencimentoSaldo:'2026-11-06',descontoCompra:0,freteCompra:0};}
function input(no,amount,{advanceCodes=[],useLegacyCredit=false}={}){
  return {operationId:'11111111-1111-4111-8111-'+no.slice(1).padStart(12,'0'),ticketNo:no,fornecedorCod:'F1',ticket:order(no,amount),advanceCodes,useLegacyCredit};
}
const legacy={erp:{
  tickets:{T284:{ticket:'T284',fornecedorCod:'F1',totalGeral:300,adiantamento:500,status:'Pago',saldoPagar:0}},
  adiantamentos:{F1:[{cod:'ADT500',valor:500,status:'Quitado',ticket:'T284',forma:'PIX'},{cod:'ADT12',valor:12,status:'Pendente',forma:'PIX'}]},
  saldoDevedor:{F1:{valor:200,ticket:'T284'}},contasPagar:{},cheques:{F1:[]}
}};
const options=db=>({db,now:()=>10000,uuid:()=> 'lock1'});

test('T284: aplicar 150 do residual de 200 sem novo débito, mantendo 50 e outros créditos intactos',async()=>{
 const db=fakeDb(legacy);
 const result=await createPurchaseOrder(identity,input('T286',150,{useLegacyCredit:true}),options(db));
 assert.equal(result.ticket.adiantamento,150);
 assert.equal(result.ticket.saldoPagar,0);
 assert.equal(result.ticket.status,'Pago');
 assert.equal(result.ticket.creditoFornecedorOrigem,'T284');
 assert.equal(result.ticket.creditoFornecedorAplicado,150);
 assert.equal(db.peek('erp/saldoDevedor/F1').valor,50);
 assert.equal(db.peek('erp/adiantamentos/F1')[0].valor,500);
 assert.equal(db.peek('erp/adiantamentos/F1')[1].valor,12);
 assert.equal(db.peek('erp/purchaseCreateOperations/user1_'+input('T286',150).operationId).ticket.ticket,'T286');
 assert.equal(db.peek('erpFinanceAdvanceLocks/F1'),undefined);
 assert.equal(db.counters.updates,1);
 assert.equal(db.peek('erp/lancBanco'),undefined);
 const retry=await createPurchaseOrder(identity,input('T286',150,{useLegacyCredit:true}),options(db));
 assert.equal(retry.alreadyCommitted,true);
 assert.equal(db.counters.updates,1);
});

test('crédito parcial novo: 500 -> 300 aplicados + 200 disponíveis -> 150 aplicados + 50 disponíveis',async()=>{
 const db=fakeDb({erp:{tickets:{},adiantamentos:{F1:[{cod:'ADT500',valor:500,status:'Pendente',forma:'PIX'}]},contasPagar:{}}});
 const first=await createPurchaseOrder(identity,input('T300',300,{advanceCodes:['ADT500']}),options(db));
 assert.equal(first.ticket.adiantamento,300);
 assert.equal(first.ticket.saldoPagar,0);
 assert.equal(first.ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,300);
 assert.deepEqual([db.peek('erp/adiantamentos/F1')[0].valor,db.peek('erp/adiantamentos/F1')[0].valorCompensado,db.peek('erp/adiantamentos/F1')[0].status],[200,300,'Pendente']);
 const second=await createPurchaseOrder(identity,input('T301',150,{advanceCodes:['ADT500']}),options(db));
 assert.equal(second.ticket.adiantamento,150);
 assert.equal(db.peek('erp/adiantamentos/F1')[0].valor,50);
 assert.equal(db.peek('erp/adiantamentos/F1')[0].valorCompensado,450);
 assert.equal(db.peek('erpFinanceAdvanceLocks/F1'),undefined);
 assert.equal(db.counters.updates,2);
});

test('segunda sessão só utiliza o saldo residual atual, e cria a diferença em contas a pagar',async()=>{
 const db=fakeDb(legacy);
 await createPurchaseOrder(identity,input('T286',150,{useLegacyCredit:true}),options(db));
 const second=await createPurchaseOrder({...identity,uid:'other'},input('T287',200,{useLegacyCredit:true}),options(db));
 assert.equal(second.ticket.adiantamento,50);
 assert.equal(second.ticket.saldoPagar,150);
 assert.equal(second.payable.valor,150);
 assert.equal(db.peek('erp/saldoDevedor/F1'),undefined);
});

test('todas as fontes financeiras de uma nova compra são confirmadas em um único update',async()=>{
 const db=fakeDb({erp:{tickets:{},adiantamentos:{F1:[{cod:'ADT1',valor:100,status:'Pendente',forma:'PIX'}]},contasPagar:{}}});
 const r=await createPurchaseOrder(identity,input('T350',150,{advanceCodes:['ADT1']}),options(db));
 assert.equal(r.ticket.adiantamento,100);
 assert.equal(r.ticket.saldoPagar,50);
 assert.equal(r.payable.valor,50);
 assert.equal(db.peek('erp/contasPagar/CPPO_T350').valor,50);
 assert.equal(db.peek('erp/adiantamentos/F1')[0].status,'Quitado');
 assert.equal(db.peek('erp/adiantamentos/F1')[0].valor,100);
 assert.equal(db.peek('erp/adiantamentos/F1')[0].valorDisponivel,0);
 assert.equal(db.counters.updates,1);
});

test('recusa crédito sem origem unívoca e não altera pedido nem banco',async()=>{
 const db=fakeDb({erp:{tickets:{T284:{...legacy.erp.tickets.T284}},adiantamentos:{F1:[]},saldoDevedor:{F1:{valor:200,ticket:'T284'}}}});
 await assert.rejects(createPurchaseOrder(identity,input('T286',150,{useLegacyCredit:true}),options(db)),{code:'CREDIT_UNVERIFIED'});
 assert.equal(db.peek('erp/tickets/T286'),undefined);
 assert.equal(db.counters.updates,0);
});

test('módulo permite residual comprovado junto a outros adiantamentos, sem selecionar automaticamente',()=>{
 const code=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
 const start=code.indexOf('function historicalAppliedAdvances('),end=code.indexOf('function currentState(',start);
 assert.ok(start>=0&&end>start);
 const ctx={ADT_POR_FORN:{F1:clone(legacy.erp.adiantamentos.F1)},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{F1:{valor:200,ticket:'T284'}},tickets:()=>clone(legacy.erp.tickets),jsonDataset:()=>[],console};
 runInNewContext(code.slice(start,end)+';this.financialData=financialData',ctx);
 const fin=ctx.financialData(null,'F1');
 assert.equal(fin.balance,200);
 assert.equal(fin.creditSource,'T284');
 assert.equal(fin.adts.length,1);
 assert.equal(fin.adts[0].cod,'ADT12');
 assert.equal(fin.issues.length,0);
 assert.doesNotMatch(code,/id="csadt-'\+index\+'"[^\n]+ checked onchange=/);
});

test('duas operações simultâneas para o mesmo saldo são serializadas pelo fornecedor',async()=>{
 const db=fakeDb(legacy);
 const attempts=await Promise.allSettled([
   createPurchaseOrder(identity,input('T290',150,{useLegacyCredit:true}),options(db)),
   createPurchaseOrder({...identity,uid:'second'},input('T291',150,{useLegacyCredit:true}),options(db))
 ]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
 assert.equal(db.counters.updates,1);
 assert.equal(db.peek('erp/saldoDevedor/F1').valor,50);
});

test('compra recusa misturar residual e adiantamentos na mesma operação',async()=>{
 const db=fakeDb(legacy);
 await assert.rejects(createPurchaseOrder(identity,input('T299',150,{advanceCodes:['ADT12'],useLegacyCredit:true}),options(db)),{code:'MIXED_CREDITS'});
 assert.equal(db.counters.updates,0);
});

test('histórico e canhoto exibem só 300 aplicados no T284, preservando 500 originais',()=>{
 const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
 const start=core.indexOf('function _compraAdiantamentoAplicado('),end=core.indexOf('function renderTickets(',start);
 assert.ok(start>0&&end>start);
 const adt={cod:'ADT500',valor:500,status:'Quitado',ticket:'T284',forma:'PIX'};
 const context={ADT_POR_FORN:{F1:[adt]}};
 runInNewContext(core.slice(start,end)+';this.applied=_compraAdiantamentoAplicado;',context);
 assert.equal(context.applied({ticket:'T284',fornecedorCod:'F1',adiantamento:500,totalGeral:300}),300);
 assert.equal(context.applied({ticket:'T284',fornecedorCod:'F1',adiantamento:500,totalGeral:500}),500);
 assert.match(core,/const alvo=Math\.max\(0,_numFinito\(_compraAdiantamentoAplicado\(tk\),0\)\)/);
});
