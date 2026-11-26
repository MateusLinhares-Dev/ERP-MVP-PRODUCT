import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
function extract(start,end){
  const first=purchase.indexOf(start),last=purchase.indexOf(end,first);
  assert.ok(first>=0&&last>first,`trecho ausente: ${start}`);
  return purchase.slice(first,last);
}
const helpers=extract('function isoDay(value){','function supplierOpenPayables(code){')+
  extract('function printAdvanceUsedElsewhere(code,ticketNo,day){','function printLaterAdvanceRows(key,ticket){')+
  extract('function printCarriedCutoff(key,ticket){','function printPaymentSnapshot(key,ticket,total){');

function ciclo(extra={}){
  const ADT_POR_FORN={F619:[
    {cod:'ADT-SOBRA',data:'24/11/2026',forma:'PIX',valor:46130.98,valorOriginal:90000,valorCompensado:43869.02,status:'Pendente',ticket:''},
    {cod:'ADT-4010',data:'25/11/2026',forma:'PIX',valor:4010,valorOriginal:4010,valorCompensado:0,status:'Pendente',ticket:''},
    {cod:'ADT-8645',data:'25/11/2026',forma:'PIX',valor:8645.15,valorOriginal:8645.15,valorCompensado:0,status:'Pendente',ticket:''},
  ]};
  const TICKETS={
    T983:{ticket:'T983',fornecedorCod:'F619',dataCompra:'2026-11-23',status:'Pago',totalGeral:102857.66,adiantamento:0},
    T1421:{ticket:'T1421',fornecedorCod:'F619',dataCompra:'2026-11-26',status:'Pendente',totalGeral:32040.20,adiantamento:0},
    ...(extra.tickets||{}),
  };
  const CONTAS_PAGAR=[
    {id:'CPPO_T983',ticket:'T983',fornCod:'F619',pagamentos:[{data:'24/11/2026',adt:30653.18,adtUsos:[{cod:'ADT-SOBRA',valor:30653.18}]}]},
    {id:'CP-SALDO',ticket:'',fornCod:'F619',pagamentos:[{data:'26/11/2026',adt:13215.84,adtUsos:[{cod:'ADT-SOBRA',valor:13215.84}]}]},
    ...(extra.payables||[]),
  ];
  const fields={'phase4-po-number':{value:'T1463'},'phase4-po-date':{value:'2026-11-26'}};
  const ctx={ADT_POR_FORN,CONTAS_PAGAR,tickets:()=>TICKETS,today:()=> '2026-11-26',getNextTicketId:()=> 'T1463',
    document:{getElementById:id=>fields[id]||null}};
  runInNewContext(helpers+'\nthis.advancesThisLoadFirst=advancesThisLoadFirst;this.purchaseAdvanceOrder=purchaseAdvanceOrder;this.loadFirstAdvances=loadFirstAdvances;',ctx);
  return ctx;
}

test('caso CICLO: os adiantamentos desta carga vêm antes da sobra do PIX de R$ 90.000 já usado na T983 e no saldo inicial',()=>{
  const ctx=ciclo();
  assert.deepEqual([...ctx.purchaseAdvanceOrder('T1421','F619')],['ADT-4010','ADT-8645','ADT-SOBRA']);
  const novos=ctx.loadFirstAdvances(ctx.ADT_POR_FORN.F619,'F619').map(a=>a.cod);
  assert.deepEqual(novos,['ADT-4010','ADT-8645','ADT-SOBRA']);
});

test('adiantamento usado em parte só nesta compra continua sendo desta carga; sem uso e anterior à última notinha vira sobra',()=>{
  const ctx=ciclo({
    tickets:{T1300:{ticket:'T1300',fornecedorCod:'F619',dataCompra:'2026-11-25',status:'Pago',totalGeral:500,adiantamento:500,reciboFinanceiro:{adiantamentos:[{cod:'ADT-OUTRO',valorAplicado:500}]}}},
    payables:[{id:'CPPO_T1421',ticket:'T1421',fornCod:'F619',pagamentos:[{data:'26/11/2026',adt:1000,adtUsos:[{cod:'ADT-8645',valor:1000}]}]}],
  });
  ctx.ADT_POR_FORN.F619[2]={...ctx.ADT_POR_FORN.F619[2],data:'26/11/2026',valor:7645.15,valorCompensado:1000};
  assert.deepEqual([...ctx.purchaseAdvanceOrder('T1421','F619')],['ADT-8645','ADT-SOBRA','ADT-4010'],'4.010 de 25/11 é até o dia da T1300, que usou adiantamento: vira sobra');
});

test('fechamento: cada adiantamento marcado mostra quanto entra, na ordem em que o servidor aplica',()=>{
  const code=extract('function showAdvanceUse(state,total,credit){','async function compensatePurchaseFromAdvance(');
  const boxes={'csadt-0':{checked:true,value:'4010'},'csadt-1':{checked:true,value:'8645.15'},'csadt-2':{checked:true,value:'46130.98'},'csadt-3':{checked:false,value:'100'}};
  const notes={};for(let i=0;i<4;i++)notes['csadt-use-'+i]={textContent:'x',className:''};
  const ctx={document:{getElementById:id=>boxes[id]||notes[id]||null},cents:v=>Math.round(Number(v||0)*100),
    money:v=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
  runInNewContext(code+'\nthis.showAdvanceUse=showAdvanceUse;',ctx);
  const state={adts:[{},{},{},{}]};
  ctx.showAdvanceUse(state,32040.20,0);
  assert.deepEqual(Object.values(notes).map(n=>n.textContent),['Usa o valor todo.','Usa o valor todo.','Usa R$ 19.385,05 e sobram R$ 26.745,93.','']);
  ctx.showAdvanceUse(state,10000,0);
  assert.deepEqual(Object.values(notes).map(n=>n.textContent),['Usa o valor todo.','Usa R$ 5.990,00 e sobram R$ 2.655,15.','Não entra: o pedido já fica pago com os de cima.','']);
  assert.match(notes['csadt-use-2'].className,/unused/);
  ctx.showAdvanceUse(state,10000,9000);
  assert.equal(notes['csadt-use-0'].textContent,'Usa R$ 1.000,00 e sobram R$ 3.010,00.','crédito antigo do fornecedor entra antes, como no servidor');
});

test('usar adiantamento depois do fechamento e usar de novo após editar mandam a ordem desta carga ao servidor',()=>{
  assert.match(purchase,/global\.erpPayablesCompensateAdvance\(cp\.id,portion,order\|\|\[\]\)/);
  assert.match(purchase,/compensatePurchaseFromAdvance\(payables,amount,purchaseAdvanceOrder\(key,code\)\)/);
  assert.match(purchase,/compensatePurchaseFromAdvance\(payables,amount,purchaseAdvanceOrder\(key,info\.supplierCode\)\)/);
  assert.match(purchase,/adts:loadFirstAdvances\(fin\.adts,/);
  assert.match(purchase,/fresh\.adts=loadFirstAdvances\(fresh\.adts,state\.supplierCode\);/);
  assert.match(core,/if\(_approved\)\{ const _ordem=Object\.keys\(_approved\); pendentesAdt\.sort/);
  const bridge=readFileSync(new URL('../web/erp/payables.tsx',import.meta.url),'utf8');
  assert.match(bridge,/advanceOrder\.length \? \{ \.\.\.plan\.payload, advanceOrder \} : plan\.payload/);
});

test('compra lançada ou editada pela tela nova volta ao cadastro o material excluído que ela usa (caso CHAPA DURA da T781)',()=>{
  const code=extract('function registerPurchaseMaterials(ticket){','function afterConfirmedPurchaseEdit(ticket,state,totals){');
  const registrados=[];let salvou=0;
  const ctx={METAIS:['FERRO','GRANA GROSSA'],_estoqueMaterialExcluido:n=>['CHAPA DURA','MEDALHA'].includes(n),
    _nomeAtualDoMaterial:n=>n==='MEDALHA'?'GRANA GROSSA':'',_garantirMetalCadastrado:n=>registrados.push(n),saveEstoque:()=>{salvou++;}};
  runInNewContext(code+'\nthis.registerPurchaseMaterials=registerPurchaseMaterials;',ctx);
  ctx.registerPurchaseMaterials({itens:[{mat:'FERRO'},{mat:'CHAPA DURA'},{mat:'MEDALHA'},{mat:'COBRE NOVO'},{mat:''}]});
  assert.deepEqual(registrados,['CHAPA DURA','COBRE NOVO'],'nome renomeado continua no nome novo; material do cadastro não é regravado');
  assert.equal(salvou,1);
  ctx.registerPurchaseMaterials({itens:[{mat:'FERRO'}]});
  assert.equal(salvou,1,'nada a cadastrar não grava');
  assert.match(purchase,/function finishPurchaseSave\(body,key,ticket,totals\)\{\n  manualMode=false;\n  resetOrderState\(body\);\n  try\{registerPurchaseMaterials\(ticket\);\}catch\(e\)\{\}/);
  assert.match(purchase,/function afterConfirmedPurchaseEdit\(ticket,state,totals\)\{\n  try\{registerPurchaseMaterials\(ticket\);\}catch\(e\)\{\}/);
});
