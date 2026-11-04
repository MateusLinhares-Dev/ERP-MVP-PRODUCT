import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const part=purchase.slice(purchase.indexOf('function historicalAppliedAdvances('),purchase.indexOf('function currentState('));
function fixture(paid,advances,credit){
  const context={ADT_POR_FORN:{F001:advances},CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:credit?{F001:credit}:{},tickets:()=>paid,jsonDataset:()=>[],console};
  runInNewContext(part+'\nthis.financialData=financialData;',context);
  return context.financialData(null,'F001');
}
const paid={
  T089:{ticket:'T089',fornecedorCod:'F001',status:'Pago',totalGeral:8703.50,adiantamento:10003.52,
    reciboFinanceiro:{adiantamentos:[{cod:'ADT100',valorAplicado:8703.50,valorPendente:1300.02}]}}
};
const stale={cod:'ADT100',ticket:'T089',status:'Pendente',valor:10003.52,forma:'PIX'};
test('compra quitada por adiantamento de 10003,52 deixa somente crédito de 1300,02 para a próxima compra',()=>{
  const fin=fixture(paid,[stale],null);
  assert.equal(fin.adts.length,1);
  assert.equal(fin.adts[0].valor,1300.02);
  assert.equal(fin.balance,0);
  assert.equal(Number((1366.80-fin.adts[0].valor).toFixed(2)),66.78);
});
test('se lançamento posterior já usou o crédito, não oferecer novamente nem o original nem o residual',()=>{
  const bought={...paid,T130:{ticket:'T130',fornecedorCod:'F001',totalGeral:1366.80,creditoFornecedorAplicado:1300.02,creditoFornecedorOrigem:'ADT100'}};
  const fin=fixture(bought,[stale],null);
  assert.equal(fin.adts.length,0);
  assert.equal(fin.balance,0);
});
test('um cache financeiro atrasado não ressuscita o crédito depois da compensação integral',()=>{
  const bought={...paid,T130:{ticket:'T130',fornecedorCod:'F001',totalGeral:1366.80,creditoFornecedorAplicado:1300.02,creditoFornecedorOrigem:'ADT100'}};
  const fin=fixture(bought,[stale],{valor:1300.02,ticket:'T089'});
  assert.equal(fin.balance,0);
  assert.equal(fin.adts.length,0);
});
test('saldo residual parcialmente usado continua disponível só pelo restante',()=>{
  const bought={...paid,T130:{ticket:'T130',fornecedorCod:'F001',totalGeral:500,creditoFornecedorAplicado:500,creditoFornecedorOrigem:'ADT100'}};
  const fin=fixture(bought,[stale],{valor:800.02,ticket:'T130'});
  assert.equal(fin.adts.length,1);
  assert.equal(fin.adts[0].valor,800.02);
  assert.equal(fin.balance,0);
});
test('registro original sem comprovante de compensação não gera crédito presumido',()=>{
  const fin=fixture({T089:{ticket:'T089',fornecedorCod:'F001',totalGeral:8703.50,status:'Pendente',adiantamento:10003.52}},[stale],null);
  assert.equal(fin.balance,0);
  assert.equal(fin.adts.length,0);
});
test('dashboard não recria gráficos nem perde interação quando a nuvem repete os mesmos valores',()=>{
  const part=core.slice(core.indexOf('function renderDashboard('),core.indexOf('function populateAll('));
  let created=0,updated=0,destroyed=0;
  const nodes=new Map();
  const document={getElementById(id){
    if(!nodes.has(id))nodes.set(id,{style:{},classList:{toggle(){}},parentElement:{innerHTML:''}});
    return nodes.get(id);
  }};
  class Chart{
    constructor(node,settings){this.data=settings.data;created++;}
    update(){updated++;}
    destroy(){destroyed++;}
  }
  const ctx={document,Chart,console,TICKETS_DB:{T1:{data:'2026-11-04',totalGeral:100}},VENDAS_DB:[],
    FUNCIONARIOS:[{status:'Ativo'}],ESTOQUE_DB:{aluminio:{inicial:50}},CHEQUES_POR_FORN:{},
    getEntradasMaterial:()=>0,getSaidasMaterial:()=>0};
  runInNewContext(part+'\nthis.draw=renderDashboard;',ctx);
  ctx.draw();ctx.draw();ctx.draw();
  assert.equal(created,2);
  assert.equal(updated,0);
  assert.equal(destroyed,0);
  ctx.TICKETS_DB.T1.totalGeral=150000;
  ctx.draw();
  assert.equal(created,2);
  assert.equal(updated,1);
  assert.equal(destroyed,0);
});
test('fechamento da compra registra o uso do crédito e não conserva saldo antigo após uso total',()=>{
  const body=purchase.slice(purchase.indexOf('function syncSupplierCredit('),purchase.indexOf('function patchCreatedTicket('));
  const saldos={F001:{valor:1300.02,ticket:'T089'}};
  const writes=[];
  const context={SALDO_DEVEDOR_FORN:saldos,document:{getElementById:()=>({checked:true})},localStorage:{setItem:(key,value)=>writes.push([key,value])},today:()=> '2026-11-04',console};
  runInNewContext(body+'\nthis.update=syncSupplierCredit;',context);
  const ticket={ticket:'T130'};
  context.update(ticket,{supplierCode:'F001',previousCredit:1300.02,creditSource:'ADT100',purchaseDate:'2026-11-04'},{total:1366.80,balance:66.78});
  assert.equal(ticket.creditoFornecedorAplicado,1300.02);
  assert.equal(ticket.creditoFornecedorOrigem,'ADT100');
  assert.equal(saldos.F001,undefined);
  assert.equal(writes.length,1);
});
test('crédito que excede a compra registra somente o restante, sem reaplicar o original',()=>{
  const body=purchase.slice(purchase.indexOf('function syncSupplierCredit('),purchase.indexOf('function patchCreatedTicket('));
  const saldos={};
  const context={SALDO_DEVEDOR_FORN:saldos,document:{getElementById:()=>({checked:true})},localStorage:{setItem(){}},today:()=> '2026-11-04',console};
  runInNewContext(body+'\nthis.update=syncSupplierCredit;',context);
  const ticket={ticket:'T130'};
  context.update(ticket,{supplierCode:'F001',previousCredit:1300.02,creditSource:'ADT100',purchaseDate:'2026-11-04'},{total:500,balance:-800.02});
  assert.equal(ticket.creditoFornecedorAplicado,500);
  assert.equal(saldos.F001.valor,800.02);
});
test('sincronização não publica heartbeat quando só existem metadados e nenhum dado alterado',()=>{
  const part=sync.slice(sync.indexOf('async function _enviarDadosEmLotes('),sync.indexOf('function fbSalvar()',sync.indexOf('async function _enviarDadosEmLotes(')));
  assert.match(part,/every\(function\(key\)\{return key==='_ts'\|\|key==='_user';\}\)/);
});
