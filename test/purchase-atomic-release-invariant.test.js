import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const first=purchase.indexOf('function historicalAppliedAdvances(');
const last=purchase.indexOf('function currentState(',first);
assert.ok(first>=0&&last>first);
function setup(advances,balance,purchases){
  const fields={};
  const ctx={ADT_POR_FORN:{F1:advances},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:balance?{F1:balance}:{},
    tickets:()=>purchases,jsonDataset:()=>[],document:{getElementById:key=>fields[key]||null},console};
  runInNewContext(purchase.slice(first,last)+';this.financialData=financialData;this.validatePurchaseCredits=validatePurchaseCredits;',ctx);
  return {...ctx,fields};
}

test('regressão: compras são confirmadas pela API financeira atômica, não por escrita individual ou saveDB',()=>{
  assert.match(purchase,/fetch\('\/api\/finance\/purchase-order-create'/);
  const start=purchase.indexOf('const availableNumber=body.dataset.purchaseReservedNumber');
  const end=purchase.indexOf('finishPurchaseSave(body,key,TICKETS_DB[key],totals)',start);
  assert.ok(start>0&&end>start);
  const flow=purchase.slice(start,end);
  assert.match(flow,/await purchaseCreateAtomic\(key,ticket,state,body\)/);
  assert.doesNotMatch(flow,/await purchaseConfirmCloud\(key,ticket,\{create:true\}\)/);
  assert.doesNotMatch(flow,/\bsaveContasPagar\(\)|\bsaveDB\(\)/);
  assert.match(flow,/body.dataset.purchaseReservedNumber=availableNumber/);
});

test('regressão: checkboxes financeiros não começam marcados',()=>{
  const start=purchase.indexOf('function paymentHtml(state){');
  const end=purchase.indexOf('function render(body){',start);
  const payment=purchase.slice(start,end);
  assert.doesNotMatch(payment,/\bchecked onchange=/);
  assert.match(payment,/id="csadt-/);
  assert.match(payment,/id="cssdv"/);
});

test('regressão: crédito antigo incerto não esconde novos adiantamentos não vinculados',()=>{
  const ctx=setup([{cod:'ADT12',valor:12,status:'Pendente',forma:'PIX'},{cod:'ADT124',valor:124,status:'Pendente',forma:'PIX'}],
    {valor:200,ticket:'T284'},{T284:{ticket:'T284',fornecedorCod:'F1',status:'Pago',totalGeral:300,adiantamento:500}});
  const result=ctx.financialData(null,'F1');
  assert.equal(result.balance,0);
  assert.deepEqual(Array.from(result.adts,a=>a.cod),['ADT12','ADT124']);
  assert.ok(result.issues.length);
  ctx.fields['csadt-0']={checked:true};
  assert.doesNotThrow(()=>ctx.validatePurchaseCredits({supplierCode:'F1',sourceTicketKeys:[],adts:result.adts,cheques:[],previousCredit:0}));
});

test('regressão: sobra de T284 só é mostrada com origem única comprovada',()=>{
  const ctx=setup([{cod:'ADT500',valor:500,status:'Quitado',ticket:'T284',forma:'PIX'},
    {cod:'ADT12',valor:12,status:'Pendente',forma:'PIX'}],
    {valor:200,ticket:'T284'},{T284:{ticket:'T284',fornecedorCod:'F1',status:'Pago',totalGeral:300,adiantamento:500}});
  const result=ctx.financialData(null,'F1');
  assert.equal(result.balance,200);
  assert.equal(result.creditSource,'T284');
  assert.deepEqual(Array.from(result.adts,a=>a.cod),['ADT12']);
  assert.deepEqual(Array.from(result.issues),[]);
});

test('regressão: ACK do backend protege contra leitura antiga do Histórico',()=>{
  assert.match(purchase,/purchaseRememberServerAck\(key,result\.ticket\)/);
  assert.match(sync,/function _fbPreservarComprasConfirmadas\(/);
  assert.match(sync,/_fbPreservarComprasConfirmadas\(d\.tickets,_tkLocal\)/);
});
