import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');

function makePrint(ticket,payables=[]){
  let html='';
  const printedTicket=structuredClone(ticket);
  const context={
    document:{addEventListener(){},getElementById(){return null;}},
    setTimeout(){return 0;},
    clearTimeout(){},
    getFornAtivos(){return [];},
    FORNECEDORES:[{cod:'F1',nome:'Fornecedor de teste',cnpj:'12.345.678/0001-90'}],
    TICKETS_DB:{TK01:printedTicket},
    CONTAS_PAGAR:structuredClone(payables),
    _empresaPrincipalLabel(){return 'Manuela Metais';},
    _empresaPrincipalRazao(){return 'Manuela Metais LTDA';},
    _empresaPrincipalInfo(){return {cnpj:'28.071.250/0001-31',endereco:'Endereço comercial'};},
    window:{
      location:{href:'https://erp.exemplo.com/app'},
      open(){return {document:{write(value){html+=value;},close(){}}};}
    }
  };
  context.window.window=context.window;
  runInNewContext(source,context);
  context.window.phase4PurchasePrint('TK01');
  return {html,printedTicket};
}

const base={
  ticket:'T827763',numeroPedido:'T827763',fornecedor:'Fornecedor de teste',fornecedorCod:'F1',
  dataCompra:'2026-10-22',vencimentoSaldo:'2026-11-03',
  itens:[{mat:'COBRE MISTO',quantidade:2.5,preco:12.50,descricaoDetalhada:'Material classificado'}],
  totalProdutos:31.25,totalGeral:31.25,adiantamento:31.25,saldoPagar:0,
  pedidoCompra:{ordemCompra:'',observacoes:''}
};

test('PDF mantém layout A4 e totais do ticket sem alterar dados',()=>{
  const {html,printedTicket}=makePrint(base);
  assert.match(html,/@page\{size:A4;margin:14mm\}/);
  assert.match(html,/Pedido de compra Nº T827763/);
  assert.match(html,/Valor unitário/);
  assert.match(html,/31,25/);
  assert.match(html,/0,00/);
  assert.deepEqual(printedTicket,base);
});

test('impressão não confunde vencimento financeiro com data prevista de entrega',()=>{
  const {html}=makePrint(base);
  assert.match(html,/<th>Data prevista<\/th><td><\/td>/);
  const unpaid=makePrint({...base,saldoPagar:31.25,adiantamento:0}).html;
  assert.match(unpaid,/<td>03\/11\/2026<\/td>/); // O vencimento permanece somente em Parcelas.
  const withDelivery=makePrint({...base,dataPrevista:'2026-11-13'}).html;
  assert.match(withDelivery,/<th>Data prevista<\/th><td>13\/11\/2026<\/td>/);
});

test('seção de observações fica visível mesmo vazia e imprime texto salvo com escape',()=>{
  const blank=makePrint(base).html;
  assert.match(blank,/<section class="print-section order-notes"><h2>Observações<\/h2><div class="notes"><\/div><\/section>/);
  const withNotes=makePrint({...base,observacoesPedido:'Coleta no pátio <B> & revisada'}).html;
  assert.match(withNotes,/class="print-section order-notes"/);
  assert.match(withNotes,/Coleta no pátio &lt;B&gt; &amp; revisada/);
});

test('descrição detalhada impressa preserva quebras e escapa conteúdo do item',()=>{
  const {html}=makePrint({...base,itens:[{...base.itens[0],descricaoDetalhada:'Primeira linha\nSegunda <linha>'}]});
  assert.match(html,/Primeira linha\nSegunda &lt;linha&gt;/);
  assert.match(html,/\.item-description span\{white-space:pre-wrap/);
});


test('impressão inclui a logo enviada no cabeçalho com fallback em texto',()=>{
  const {html}=makePrint(base);
  assert.match(html,/class="logo-image"/);
  assert.match(html,/assets\/branding\/manuela-metais-logo\.webp/);
  assert.match(html,/class="logo-fallback">Manuela Metais</);
});


test('cadastro das observações gerais mantém o campo único antes dos totais e a persistência existente',()=>{
  const start=source.indexOf("'<section class=\"phase4-po-card phase4-po-notes-card");
  const totals=source.indexOf("'<div class=\"phase4-po-columns");
  assert.ok(start>=0&&totals>start);
  assert.match(source,/id=\"phase4-po-notes\" name=\"observacoesPedido\"/);
  assert.ok(source.includes("ticket.observacoesPedido=String(state.notes||'').trim()"));
  assert.match(source,/observacoes:ticket\.observacoesPedido/);
});

test('observações gerais podem ser apagadas do formulário sem ressurgir ao salvar',()=>{
  const order={supplierName:'Fornecedor de teste',items:[],notes:'Observação anterior'};
  const body={dataset:{phase4Order:JSON.stringify(order)}};
  const input={value:''};
  const fields={'cs-lanc-body':body,'phase4-po-notes':input};
  const context={
    document:{addEventListener(){},getElementById(id){return fields[id]||null;}},
    window:{},
    setTimeout(){},clearTimeout(){}
  };
  runInNewContext(source,context);
  context.window.phase4PurchaseSyncMeta();
  assert.equal(JSON.parse(body.dataset.phase4Order).notes,'');
  input.value='Entrega no pátio <seguro>';
  context.window.phase4PurchaseSyncMeta();
  assert.equal(JSON.parse(body.dataset.phase4Order).notes,'Entrega no pátio <seguro>');
});


test('canhoto reflete pagamento registrado após o fechamento sem dar baixa novamente',()=>{
  const ticket={...base,totalProdutos:39000,totalGeral:39000,adiantamento:15000,saldoPagar:24000};
  const accounts=[{id:'CP-1',ticket:'T827763',status:'Pendente',valor:14000,
    valorPago:10000,pagamentos:[{data:'27/10/2026',valor:10000,adt:0,banco:'Itaú'}]}];
  const {html,printedTicket}=makePrint(ticket,accounts);
  assert.match(html,/Situação financeira do pedido/);
  assert.match(html,/Total do pedido<\/th><td>R\$ 39\.000,00/);
  assert.match(html,/Adiantamentos \/ abatimentos no fechamento<\/th><td>R\$ 15\.000,00/);
  assert.match(html,/Pagamentos e abatimentos posteriores<\/th><td>R\$ 10\.000,00/);
  assert.match(html,/Total pago \/ abatido<\/th><td>R\$ 25\.000,00/);
  assert.match(html,/Saldo a pagar<\/th><td>R\$ 14\.000,00/);
  assert.match(html,/27\/10\/2026/);
  assert.match(html,/Itaú/);
  assert.equal(printedTicket.saldoPagar,24000); // print cannot mutate the order
});

test('quitado via contas a pagar aparece no canhoto mesmo se ticket estiver atrasado',()=>{
  const ticket={...base,totalGeral:39000,adiantamento:15000,saldoPagar:24000};
  const accounts=[{id:'CP-1',ticket:'T827763',status:'Pago',valor:24000,
    valorPago:24000,pagamentos:[{data:'28/10/2026',valor:24000,banco:'Sicredi'}]}];
  const {html}=makePrint(ticket,accounts);
  assert.match(html,/Total pago \/ abatido<\/th><td>R\$ 39\.000,00/);
  assert.match(html,/Saldo a pagar<\/th><td>R\$ 0,00/);
});

test('não mistura pagamentos de outros pedidos ou duplica adiantamentos de origem',()=>{
  const ticket={...base,totalGeral:39000,adiantamento:15000,saldoPagar:24000};
  const accounts=[{ticket:'OUTRO-TICKET',status:'Pago',valor:10000,
    pagamentos:[{data:'28/10/2026',valor:10000}]}];
  const {html}=makePrint(ticket,accounts);
  assert.match(html,/Total pago \/ abatido<\/th><td>R\$ 15\.000,00/);
  assert.match(html,/Saldo a pagar<\/th><td>R\$ 24\.000,00/);
  assert.doesNotMatch(html,/Pagamentos registrados após o pedido/);
});
