import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
function extract(source,start,end){
  const first=source.indexOf(start);
  const last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,`function range missing: ${start}`);
  return source.slice(first,last);
}

test('cheque oferece clientes e fornecedores ativos com destino identificável',()=>{
  const code=extract(core,'function _chqCadastroDestinos(){','function _chqModal(id){');
  const ctx={CLIENTES:[{nome:'CLIENTE TESTE',cod:'C1'}],FORNECEDORES:[{nome:'JOAO ELIAS',cod:'F3'},{nome:'FORN INATIVO',inativo:true}]};
  const found=runInNewContext(`${code}\n_chqCadastroDestinos()`,ctx);
  assert.ok(found.some(x=>x.nome==='JOAO ELIAS'&&x.tipo==='Fornecedor'&&x.cod==='F3'));
  assert.ok(found.some(x=>x.nome==='CLIENTE TESTE'&&x.tipo==='Cliente'));
  assert.ok(!found.some(x=>x.nome==='FORN INATIVO'));
  assert.match(core,/fornecedorCod=_fornObj\.cod/);
});

test('adiantamentos recém-cadastrados prevalecem sobre dataset financeiro vazio',()=>{
  const code=extract(purchase,'function financialData(body,supplierCode){','function currentState(body){');
  const ctx={
    jsonDataset:(b,k,f)=>JSON.parse(b.dataset[k]||'null')??f,
    ADT_POR_FORN:{F3:[{cod:'A1',valor:100000,status:'Pendente',forma:'PIX'},{cod:'A2',valor:50000,status:'Pendente',forma:'PIX'},{cod:'A3',valor:35000,status:'Pendente',forma:'PIX'}]},
    CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{}
  };
  const body={dataset:{fornCod:'F3',adtsData:'[]',cheqsData:'[]',saldoAnterior:'0'}};
  ctx.body=body;
  const result=runInNewContext(`${code}\nfinancialData(body,'F3')`,ctx);
  assert.equal(result.adts.length,3);
  assert.equal(result.adts.reduce((sum,a)=>sum+a.valor,0),185000);
});

test('editar pedido altera materiais sem reaplicar adiantamentos e atualiza apenas saldo restante',()=>{
  const code=extract(purchase,'function saveEditedTicket(state,totals){','function stateForSourceTicket(ticketKey){');
  const ticket={ticket:'T100',fornecedor:'JOAO ELIAS',fornecedorCod:'F3',totalGeral:1000,
    totalProdutos:1000,adiantamento:300,saldoPagar:700,status:'Pendente',
    reciboFinanceiro:{adiantamentos:[{cod:'ADT100',valorAplicado:300}]},
    itens:[{mat:'ALUMINIO',quantidade:100,pesoLiq:100,pesoBruto:100,preco:10,ident:'LIMPO'}]};
  const adts=[{cod:'ADT100',valor:300,status:'Quitado',ticket:'T100'}];
  const cp={ticket:'T100',valor:700,status:'Pendente',id:'CP1'};
  let saved=0, savedCp=0;
  const ctx={
    TICKETS_DB:{k1:ticket},ADT_POR_FORN:{F3:adts},CHEQUES_POR_FORN:{},
    CONTAS_PAGAR:[cp],global:{},
    tickets(){return this.TICKETS_DB;},
    supplierByName(){return {cod:'F3',nome:'JOAO ELIAS'};},
    saveDB(){saved++;},saveContasPagar(){savedCp++;},
    fbSalvarImediato(){},registrarHistorico(){},itemNet(x){return Number(x.quantidade??x.pesoLiq??0);}
  };
  // Pass a closure that works as it does in the browser, without `this` dependencies.
  ctx.tickets=()=>ctx.TICKETS_DB;
  const state={editKey:'k1',supplierName:'JOAO ELIAS',supplierCode:'F3',originalTotal:1000,originalBalance:700,
    items:[{mat:'ALUMINIO',originalIndex:0,ident:'LIMPO',quantidade:100,pesoBruto:100,preco:10},
           {mat:'COBRE',quantidade:10,pesoBruto:10,preco:20}],
    discount:0,freight:0,orderNumber:'T100',purchaseOrder:'',purchaseDate:'2026-10-27',dueDate:'2026-10-30',notes:'Teste'};
  ctx.state=state;
  runInNewContext(`${code}\nsaveEditedTicket(state, {total:1200,productTotal:1200,balance:900})`,ctx);
  assert.equal(ticket.itens.length,2);
  assert.equal(ticket.itens[0].ident,'LIMPO');
  assert.equal(ticket.itens[1].mat,'COBRE');
  assert.equal(ticket.saldoPagar,900);
  assert.equal(cp.valor,900);
  assert.equal(ticket.adiantamento,300);
  assert.equal(ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,300);
  assert.equal(adts[0].status,'Quitado');
  assert.equal(saved,1);assert.equal(savedCp,1);
});

test('edição impede preço total inferior ao já pago/abatido',()=>{
  const code=extract(purchase,'function saveEditedTicket(state,totals){','function stateForSourceTicket(ticketKey){');
  const ticket={ticket:'T1',totalGeral:1000,saldoPagar:0,itens:[{mat:'COBRE',quantidade:1,preco:1000}]};
  const ctx={TICKETS_DB:{T1:ticket},tickets:()=>ctx.TICKETS_DB};
  assert.throws(()=>runInNewContext(`${code}\nsaveEditedTicket({editKey:'T1',originalTotal:1000,originalBalance:0}, {balance:-1,total:999})`,ctx),/abaixo do que já foi pago/);
});

test('histórico navega para edição completa, atalho Alt+Z e impressão enxuta',()=>{
  assert.match(core,/onclick="phase4PurchaseEditTicket\('\$\{tk\._dbKey\}'\)"/);
  assert.match(purchase,/global\.phase4PurchaseEditTicket=function/);
  assert.match(purchase,/global\.csTab\('lancamento'\)/);
  assert.match(purchase,/String\(ev\.key\|\|'?'\)\.toLowerCase\(\)!=='z'/);
  assert.match(purchase,/aria-keyshortcuts="Alt\+Z"/);
  assert.doesNotMatch(purchase,/<th>Código do fornecedor<\/th>/);
  assert.doesNotMatch(purchase,/<th>Código<\/th>/);
});

test('edição mantém valores extras legados sem modificar o total da compra ao abrir',()=>{
  const code=extract(purchase,'function stateForExistingTicket(key){','global.phase4PurchaseEditTicket=function');
  const ticket={ticket:'T200',fornecedor:'JOAO ELIAS',totalGeral:1165,saldoPagar:665,adiantamento:500,
    descontoCompra:0,freteCompra:0,acrescimo:165,
    itens:[{mat:'COBRE',pesoLiq:10,quantidade:10,preco:100}]};
  const ctx={
    tickets(){return {T200:ticket};},
    supplierByName(){return {nome:'JOAO ELIAS',cod:'F3'};},
    ticketItemsForOrder(){return [{mat:'COBRE',quantidade:10,preco:100,source:true}]},
    itemNet(i){return Number(i.quantidade||i.pesoLiq||0);},
    isoDate(){return '2026-10-27';},
    today(){return '2026-10-27';}
  };
  const state=runInNewContext(`${code}\nstateForExistingTicket('T200')`,ctx);
  assert.equal(state.legacyExtra,165);
  assert.equal(state.originalTotal,1165);
  assert.equal(state.originalBalance,665);
  assert.equal(state.appliedAdvance,500);
  assert.equal(state.items[0].source,false);
});
