import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const snippet=purchase.slice(purchase.indexOf('function historicalAppliedAdvances('),purchase.indexOf('function currentState('));
function financial(advances,balances,records){
  const context={ADT_POR_FORN:{F001:advances},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:balances,tickets:()=>records,jsonDataset:()=>[],console};
  runInNewContext(snippet+'\nthis.read=financialData;this.validate=validatePurchaseCredits;',context);
  return context;
}
const advance={cod:'ADT-1',ticket:'T089',status:'Pendente',valor:10003.52,forma:'PIX'};
const purchaseReceipt={T089:{ticket:'T089',fornecedorCod:'F001',status:'Pago',totalGeral:8703.50,adiantamento:10003.52,reciboFinanceiro:{adiantamentos:[{cod:'ADT-1',valorOriginal:10003.52,valorAplicado:8703.50,valorPendente:1300.02}]}}};

test('uma compensação comprovada oferece somente o saldo residual como adiantamento, sem somar o cache antigo',()=>{
  const c=financial([advance],{F001:{valor:1300.02,ticket:'T089'}},purchaseReceipt);
  const result=c.read(null,'F001');
  assert.equal(result.adts.length,1);
  assert.equal(result.adts[0].valor,1300.02);
  assert.equal(result.balance,0);
  assert.equal(result.issues.length,0);
});

test('ticket excluído e cache residual incoerente não geram crédito automático',()=>{
  const c=financial([advance],{F001:{valor:8636.72,ticket:'T130'}},{});
  const result=c.read(null,'F001');
  assert.equal(result.adts.length,0);
  assert.equal(result.balance,0);
  assert.ok(result.issues.length>0);
  assert.match(result.issues.join(' '),/T089.*não está no histórico/);
  c.document={getElementById:()=>null};
  assert.doesNotThrow(()=>c.validate({supplierCode:'F001',sourceTicketKeys:[],adts:[],cheques:[],previousCredit:0}));
  c.document={getElementById:id=>id==='cssdv'?{checked:true}:null};
  assert.throws(()=>c.validate({supplierCode:'F001',sourceTicketKeys:[],adts:[],cheques:[],previousCredit:50}),/não está no histórico/);
});

test('adiantamento vinculado ao número da própria compra em criação é oferecido',()=>{
  const c=financial([{cod:'ADT-9',ticket:'T300',status:'Pendente',valor:500,forma:'PIX'}],{},{});
  c.getNextTicketId=()=>'T300';
  const result=c.read(null,'F001');
  assert.equal(result.adts.length,1);
  assert.equal(result.issues.length,0);
});

test('saldo legado gerado pelo excedente de um ticket não ressuscita depois que o adiantamento foi quitado',()=>{
  const closed=Object.assign({},advance,{status:'Quitado'});
  const history={T130:{ticket:'T130',fornecedorCod:'F001',status:'Pago',adiantamento:10003.52,totalGeral:1366.80}};
  const c=financial([closed],{F001:{valor:8636.72,ticket:'T130'}},history);
  const result=c.read(null,'F001');
  assert.equal(result.balance,0);
  assert.equal(result.adts.length,0);
  assert.ok(result.issues.length>0);
});

test('sem ticket no histórico não se presume o residual de 1300,02',()=>{
  const c=financial([advance],{},{});
  const result=c.read(null,'F001');
  assert.equal(result.balance,0);
  assert.equal(result.adts.length,0);
  assert.ok(result.issues.length>0);
});

test('uso posterior do residual impede a reoferta após a compensação',()=>{
  const c=financial([advance],{F001:{valor:8636.72,ticket:'T130'}},{...purchaseReceipt,T130:{ticket:'T130',fornecedorCod:'F001',creditoFornecedorOrigem:'ADT-1',creditoFornecedorAplicado:1300.02}});
  const result=c.read(null,'F001');
  assert.equal(result.adts.length,0);
  assert.equal(result.balance,0);
});

test('fechamento não cria nova conta de crédito quando o adiantamento excede a compra',()=>{
  const section=purchase.slice(purchase.indexOf('function syncSupplierCredit('),purchase.indexOf('function patchCreatedTicket('));
  const balances={};
  const ctx={SALDO_DEVEDOR_FORN:balances,document:{getElementById:()=>null},localStorage:{setItem(){}},console};
  runInNewContext(section+'\nthis.sync=syncSupplierCredit;',ctx);
  const ticket={ticket:'T150'};
  ctx.sync(ticket,{supplierCode:'F001',previousCredit:0,creditSource:'',adts:[advance]},{total:1366.80,balance:-8636.72});
  assert.equal(Object.keys(balances).length,0);
});

test('legado respeita limites de adiantamentos aprovados na tela, sem consumir o valor original inteiro',()=>{
  assert.match(purchase,/__ERP_PURCHASE_APPROVED_ADVANCES__/);
  assert.match(core,/const _adtDisponivel=a=>_approved\?/);
  assert.match(core,/const vAdt=_adtDisponivel\(a\)/);
  assert.match(core,/const saldoAnterior=_approved\?0:/);
});
