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

test('adiantamentos recém-cadastrados prevalecem sobre dataset financeiro vazio',()=>{
  const code=extract(purchase,'function financialData(body,supplierCode,sourceTicketKeys=[]){','function currentState(body){');
  const ctx={
    jsonDataset:(b,k,f)=>JSON.parse(b.dataset[k]||'null')??f,
    ADT_POR_FORN:{F3:[{cod:'A1',valor:100000,status:'Pendente',forma:'PIX'},{cod:'A2',valor:50000,status:'Pendente',forma:'PIX'},{cod:'A3',valor:35000,status:'Pendente',forma:'PIX'}]},
    CHEQUES_POR_FORN:{},SALDO_DEVEDOR_FORN:{},tickets(){return {};},linkedPurchase(){return null;}
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
  ctx.tickets=()=>ctx.TICKETS_DB;
  const state={editKey:'k1',ticketSnapshot:JSON.stringify(ticket),supplierName:'JOAO ELIAS',supplierCode:'F3',originalTotal:1000,originalBalance:700,
    items:[{mat:'ALUMINIO',originalIndex:0,ident:'LIMPO',quantidade:100,pesoBruto:100,preco:10},
           {mat:'COBRE',quantidade:10,pesoBruto:10,preco:20}],
    discount:0,freight:0,orderNumber:'T100',purchaseOrder:'',purchaseDate:'2026-10-27',dueDate:'2026-10-30',notes:'Teste'};
  ctx.state=state;
  const edited=runInNewContext(`${code}\nsaveEditedTicket(state, {total:1200,productTotal:1200,balance:900})`,ctx);
  assert.equal(ticket.itens.length,1);
  assert.equal(ticket.saldoPagar,700);
  assert.equal(cp.valor,700);
  assert.equal(saved,0);assert.equal(savedCp,0);
  assert.equal(edited.itens.length,2);
  assert.equal(edited.itens[0].ident,'LIMPO');
  assert.equal(edited.itens[1].mat,'COBRE');
  assert.equal(edited.saldoPagar,900);
  ctx.edited=edited;
  runInNewContext(`${code}\nafterConfirmedPurchaseEdit(edited,state,{total:1200,productTotal:1200,balance:900})`,ctx);
  assert.equal(cp.valor,700);
  assert.equal(ticket.adiantamento,300);
  assert.equal(ticket.reciboFinanceiro.adiantamentos[0].valorAplicado,300);
  assert.equal(adts[0].status,'Quitado');
  assert.equal(saved,0);assert.equal(savedCp,0);
});

test('edição impede preço total inferior ao já pago/abatido',()=>{
  const code=extract(purchase,'function saveEditedTicket(state,totals){','function stateForSourceTicket(ticketKey){');
  const ticket={ticket:'T1',totalGeral:1000,saldoPagar:0,itens:[{mat:'COBRE',quantidade:1,preco:1000}]};
  const ctx={TICKETS_DB:{T1:ticket},ticket,tickets:()=>ctx.TICKETS_DB};
  assert.throws(()=>runInNewContext(`${code}\nsaveEditedTicket({editKey:'T1',ticketSnapshot:JSON.stringify(ticket),originalTotal:1000,originalBalance:0}, {balance:-1,total:999})`,ctx),/abaixo de pagamento já registrado/);
});

test('histórico navega para edição completa, atalho Alt+Z e impressão enxuta',()=>{
  assert.match(core,/onclick="phase4PurchaseEditTicket\('\$\{tk\._dbKey\}'\)"/);
  assert.match(purchase,/global\.phase4PurchaseEditTicket=async function/);
  assert.match(purchase,/global\.csTab\('lancamento'\)/);
  assert.match(purchase,/String\(ev\.key\|\|'?'\)\.toLowerCase\(\)!=='z'/);
  assert.match(purchase,/aria-keyshortcuts="Alt\+Z"/);
  assert.doesNotMatch(purchase,/<th>Código do fornecedor<\/th>/);
  assert.doesNotMatch(purchase,/<th>Código<\/th>/);
});

test('edição mantém valores extras legados sem modificar o total da compra ao abrir',()=>{
  const code=extract(purchase,'function stateForExistingTicket(key,cloudTicket){','global.phase4PurchaseEditTicket=async function');
  const ticket={ticket:'T200',fornecedor:'JOAO ELIAS',totalGeral:1165,saldoPagar:665,adiantamento:500,
    descontoCompra:0,freteCompra:0,acrescimo:165,
    itens:[{mat:'COBRE',pesoLiq:10,quantidade:10,preco:100}]};
  const ctx={
    tickets(){return {T200:ticket};},
    supplierForTicket(){return {nome:'JOAO ELIAS',cod:'F3'};},
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

test('fornecedor renomeado: editar o pedido acha o fornecedor pelo código e usa o nome atual',()=>{
  const lookup=extract(purchase,'function suppliers(){','function jsonDataset(');
  const code=extract(purchase,'function stateForExistingTicket(key,cloudTicket){','global.phase4PurchaseEditTicket=async function');
  const ticket={ticket:'T178',fornecedor:'JORGE ANTONIO DA SILVA ',fornecedorCod:'F042',totalGeral:500,saldoPagar:500,
    itens:[{mat:'COBRE',pesoLiq:5,quantidade:5,preco:100}]};
  const list=[{cod:'F041',nome:'JORGE ANTONIO DA SILVA'},{cod:'F042',nome:'JORGE ANTONIO',nomesAnteriores:['JORGE ANTONIO DA SILVA']}];
  const ctx={
    getFornAtivos(){return list;},
    tickets(){return {T178:ticket};},
    ticketItemsForOrder(){return [{mat:'COBRE',quantidade:5,preco:100}];},
    itemNet(i){return Number(i.quantidade||0);},
    isoDate(){return '2026-11-17';},
    today(){return '2026-11-17';}
  };
  const state=runInNewContext(`${lookup}\n${code}\nstateForExistingTicket('T178')`,ctx);
  assert.equal(state.supplierCode,'F042');
  assert.equal(state.supplierName,'JORGE ANTONIO');
  assert.equal(state.originalSupplierCode,'F042');
  const found=(t)=>runInNewContext(`${lookup}\nsupplierForTicket(t)`,{...ctx,t});
  assert.equal(found({fornecedor:'jorge  antonio da silva'}).cod,'F041');
  assert.equal(found({forn:'JORGE ANTONIO'}).cod,'F042');
  list.shift();
  assert.equal(found({fornecedorNome:'Jorge Antonio da Silva'}).cod,'F042');
  assert.equal(found({fornecedor:'OUTRO'}),null);
  ticket.fornecedorCod='F999';ticket.fornecedor='NINGUEM';
  assert.throws(()=>runInNewContext(`${lookup}\n${code}\nstateForExistingTicket('T178')`,ctx),/NINGUEM\) não está ativo no cadastro/);
});

test('fornecedor renomeado: pesagens e sessão do Balanceiro acham o fornecedor pelo código ou nome antigo',()=>{
  const helpers=extract(core,'function _fornChaveNome(nome){','function balIniciarNovaSessao(){');
  const forn={cod:'F042',nome:'JORGE ANTONIO',nomesAnteriores:['JORGE ANTONIO DA SILVA']};
  const ctx={getFornAtivos(){return [{cod:'F001',nome:'CICLO'},forn];}};
  const run=(expr,extra={})=>runInNewContext(`${helpers}\n${expr}`,{...ctx,...extra});
  assert.equal(run(`_fornPorNome('jorge antonio da silva')`).cod,'F042');
  assert.equal(run(`_fornPorNome(' JORGE  ANTONIO ')`).cod,'F042');
  assert.equal(run(`_fornPorNome('SEM CADASTRO')`),null);
  const match=(t)=>run(`_ticketDoForn(t,forn,'JORGE ANTONIO')`,{t,forn});
  assert.equal(match({fornecedorCod:'F042',fornecedor:'JORGE ANTONIO DA SILVA'}),true);
  assert.equal(match({fornecedorCod:'F001',fornecedor:'JORGE ANTONIO'}),false);
  assert.equal(match({forn:'JORGE ANTONIO DA SILVA',_balSessao:true}),true);
  assert.equal(match({fornecedorNome:'OUTRO'}),false);
  const load=extract(core,'function csCarregarForn(forceName){','const adtsTodos=');
  assert.match(load,/const fornObj=_fornPorNome\(fornNome\);[\s\S]*_ticketDoForn\(t,fornObj,fornNome\)/);
  assert.match(extract(core,'function balIniciarNovaSessao(){','const sessId'),/_ticketDoForn\(t,fornSel,fornNome\)/);
});

test('lançamento manual puxa o preço da tabela do fornecedor ao escolher o material, sem trocar preço digitado',()=>{
  const code=extract(purchase,'function tablePrice(code,mat){','function supplierForTicket(ticket){');
  const ctx={PRECOS_FORN_DATA:{F42:{'ALUMINIO DURO LIMPO':9.5,'Bronze ':46,COBRE:0,_datas:{'ALUMINIO DURO LIMPO':'17/11/2026'}}}};
  runInNewContext(code+';this.price=tablePrice;this.fill=fillTablePrices;',ctx);
  assert.equal(ctx.price('F42','aluminio duro limpo'),9.5);
  assert.equal(ctx.price('F42','BRONZE'),46);
  assert.equal(ctx.price('F42','COBRE'),0);
  assert.equal(ctx.price('F42','_datas'),0);
  assert.equal(ctx.price('F99','BRONZE'),0);
  const state={supplierCode:'F42',items:[{mat:'Bronze',preco:0},{mat:'ALUMINIO DURO LIMPO',preco:12},{mat:'',preco:0},{mat:'aluminio duro limpo',preco:3,tablePrice:true}]};
  ctx.fill(state);
  assert.equal(JSON.stringify(state.items.map(i=>i.preco)),JSON.stringify([46,12,0,9.5]));
  const handler=extract(purchase,'global.phase4PurchaseItem=function(index,field,value){','global.phase4PurchaseAddItem=function(){');
  assert.match(handler,/if\(field==='preco'\)item\.tablePrice=false;/);
  assert.match(handler,/if\(field==='mat'&&\(!\(Number\(item\.preco\|\|0\)>0\)\|\|item\.tablePrice\)\)\{\s*const price=tablePrice\(state\.supplierCode,item\.mat\);/);
  assert.match(purchase,/next\.sourceTicketKeys=\[\];\s*if\(!next\.items\?\.length\)next\.items=\[newItem\(\)\];\s*fillTablePrices\(next\);/);
});

test('janela Contas / PIX do fornecedor leva ao cadastro onde a conta é editada ou excluída',()=>{
  const compat=readFileSync(new URL('../public/legacy/supplier-compat.js',import.meta.url),'utf8');
  assert.match(compat,/id="forn-pix-edit">✏️ Editar ou excluir contas<\/button>/);
  assert.match(compat,/window\.phase3OpenPartyBanks\('fornecedor',String\(f\.cod\|\|''\),String\(f\.nome\|\|''\)\)/);
});
