import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const start=purchase.indexOf('function historicalAppliedAdvances(');
const end=purchase.indexOf('function currentState(',start);
assert.ok(start>=0&&end>start);
function financialContext(advances,credit,tickets){
  const context={
    ADT_POR_FORN:{F089:advances},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{F089:credit},
    tickets:()=>tickets,jsonDataset:()=>[],console
  };
  runInNewContext(purchase.slice(start,end)+';this.financialData=financialData;this.validatePurchaseCredits=validatePurchaseCredits;',context);
  return context;
}
const paid={T089:{ticket:'T089',fornecedorCod:'F089',status:'Pago',totalGeral:8703.50,adiantamento:10003.52,reciboFinanceiro:{adiantamentos:[{cod:'ADT089',valorAplicado:8703.50,valorPendente:1300.02}]}}};

test('adiantamento associado a T089 quitado não volta a ser abatido em T115',()=>{
  const ctx=financialContext([{cod:'ADT089',valor:10003.52,status:'Pendente',ticket:'T089',forma:'PIX'}],{valor:1300.02,ticket:'T089'},paid);
  const result=ctx.financialData(null,'F089');
  assert.equal(result.adts.length,1);
  assert.equal(result.adts[0].valor,1300.02);
  assert.equal(result.balance,0);
  assert.equal(Number((1433.80-result.adts[0].valor).toFixed(2)),133.78);
});

test('sincronização antiga sem vínculo também não reaplica o adiantamento original registrado no recibo',()=>{
  const ctx=financialContext([{cod:'ADT089',valor:10003.52,status:'Pendente',ticket:'',forma:'PIX'}],{valor:1300.02,ticket:'T089'},paid);
  assert.equal(ctx.financialData(null,'F089').adts.length,1);
});

test('resíduo autenticado não pode ser somado novamente ao crédito antigo do mesmo ticket',()=>{
  const ctx=financialContext([{cod:'ADT089',valor:1300.02,valorOriginal:10003.52,valorCompensado:8703.50,status:'Pendente',ticket:'',ticketOrigem:'T089',forma:'PIX'}],{valor:1300.02,ticket:'T089'},paid);
  const result=ctx.financialData(null,'F089');
  assert.equal(result.adts.length,1);
  assert.equal(result.adts[0].valor,1300.02);
  assert.equal(result.balance,0);
});

test('adiantamento geral legítimo continua disponível e cancelado não é listado',()=>{
  const ctx=financialContext([{cod:'ADTNEW',valor:500,status:'Pendente',ticket:'',forma:'PIX'},{cod:'ADTCANCEL',valor:300,status:'Cancelado',ticket:'',forma:'PIX'}],null,paid);
  assert.equal(ctx.financialData(null,'F089').adts.length,1);
  assert.equal(ctx.financialData(null,'F089').adts[0].cod,'ADTNEW');
});

test('adiantamento vinculado à pesagem em aberto só é usado nela',()=>{
  const tickets={...paid,TNEW:{status:'Aguard. Preço',_balFinalizado:true,fornecedorCod:'F089'}};
  const ctx=financialContext([{cod:'ADTN',valor:400,status:'Pendente',ticket:'TNEW',forma:'PIX'}],null,tickets);
  assert.equal(ctx.financialData(null,'F089').adts.length,0);
  assert.equal(ctx.financialData(null,'F089',['TNEW']).adts[0].valor,400);
});

test('salvamento bloqueia crédito desatualizado sem modificar o ticket',()=>{
  const ctx=financialContext([{cod:'ADT089',valor:10003.52,status:'Pendente',ticket:'T089',forma:'PIX'}],{valor:1300.02,ticket:'T089'},paid);
  ctx.document={getElementById:id=>id==='csadt-0'?{checked:true}:id==='cssdv'?{checked:true}:null};
  assert.throws(()=>ctx.validatePurchaseCredits({editKey:'',supplierCode:'F089',sourceTicketKeys:[],adts:[{cod:'ADT089',valor:10003.52}],cheques:[],previousCredit:1300.02}),/já foi utilizado/);
});

test('usuário não vê consulta técnica do Firebase no histórico',()=>{
  assert.doesNotMatch(purchase,/Localizar pedido no Firebase|phase4-ticket-lookup/);
});

test('baixa envia a data escolhida sem referência a date inexistente',()=>{
  const begin=core.indexOf('async function confirmarPagarCP(');
  const end=core.indexOf('function _baixarSaldoTicket(',begin);
  const source=core.slice(begin,end);
  assert.match(source,/const paymentDate=document\.getElementById\('pcp-data'\)/);
  assert.match(source,/date:paymentDate/);
  assert.doesNotMatch(source,/date:date\b|date:data\b/);
});

test('front publicado carrega os assets com revisão para não usar o JavaScript antigo',()=>{
  assert.match(bootstrap,/script\.src = src \+ '\?v=' \+ assetRevision/);
  assert.match(html,/app\/bootstrap\.js\?v=20261105-paid-order-reconciliation-t198-v2/);
});
