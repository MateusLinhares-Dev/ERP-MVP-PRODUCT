import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const js=fs.readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/purchase-order/purchase-order.css',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');

test('bootstrap carrega o módulo de pedido de compra por último',()=>{
  assert.match(bootstrap,/purchase-order\/purchase-order\.css/);
  assert.match(bootstrap,/purchase-order\/purchase-order\.js/);
  assert.ok(bootstrap.indexOf('phase3-homologation.js') < bootstrap.indexOf('purchase-order.js'));
});

test('layout possui campos pedidos pelo cliente e remove identificação da interface nova',()=>{
  for(const label of ['Fornecedor','Itens do pedido de compra','Detalhes','Quantidade','Preço unitário','Preço total','Desconto R$','Frete R$','Número do pedido','Ordem de compra','Data da compra']){
    assert.ok(js.includes(label),`faltando ${label}`);
  }
  assert.doesNotMatch(js,/\>Identificação\</);
});

test('salvamento continua passando pelo fluxo legado e depois sincroniza integrações',()=>{
  assert.match(js,/legacy\.confirmPurchase\.call/);
  assert.match(js,/syncPayable\(/);
  assert.match(js,/syncPrices\(/);
  assert.match(js,/syncSupplierCredit\(/);
  assert.match(js,/saveDB\(\)/);
  assert.match(js,/fbSalvarImediato/);
  assert.match(js,/ticket\.pedidoCompra=/);
});

test('impressão usa modelo de pedido de compra com fornecedor itens e totais',()=>{
  assert.match(js,/Pedido de compra Nº/);
  assert.match(js,/Itens do pedido de compra/);
  assert.match(js,/Descrição do produto\/serviço/);
  assert.match(js,/Número do pedido/);
  assert.match(js,/Ordem de compra/);
  assert.match(js,/Total do pedido/);
  assert.match(js,/global\.phase1PurchasePrint=global\.phase4PurchasePrint/);
  assert.match(js,/global\.imprimirCanhoto=function/);
});

test('itens vindos da pesagem continuam vinculados e quantidade fica protegida',()=>{
  assert.match(js,/source:true/);
  assert.match(js,/Quantidade originada da pesagem/);
  assert.match(js,/sourceTicketKeys/);
});

test('estilo preserva tema do ERP em vez de copiar tema escuro do Bling',()=>{
  assert.match(css,/var\(--primary/);
  assert.doesNotMatch(css,/background:\s*#1[0-2]1[0-2]1[0-2]/i);
});


test('descrição detalhada usa ícone e modal em vez de input aberto na grade',()=>{
  assert.match(js,/phase4-po-detail-button/);
  assert.match(js,/phase4PurchaseOpenDescription/);
  assert.match(js,/phase4PurchaseSaveDescription/);
  assert.match(js,/Descrição detalhada preenchida/);
  assert.match(css,/\.phase4-po-detail-button\.active/);
  assert.match(css,/\.phase4-po-description-overlay/);
});

test('pesagens pendentes viram fila unitária de pesagens a fechar',()=>{
  assert.match(js,/function pendingPurchaseTickets/);
  assert.match(js,/Pesagens a fechar/);
  assert.match(js,/phase4OpenTicketForPurchase/);
  assert.match(js,/Esta pesagem já virou o pedido/);
});

test('salvar pedido limpa lançamento e termina no histórico sem permitir duplicar a origem',()=>{
  assert.match(js,/function resetOrderState/);
  assert.match(js,/delete body\.dataset\[key\]/);
  assert.match(js,/global\.csTab\('historico'\)/);
  assert.match(js,/existingPurchaseForSources/);
  assert.match(js,/validateSourceTickets/);
  assert.match(js,/Esta pesagem já foi fechada no pedido/);
});

test('pedido impresso segue estrutura operacional inspirada no documento de referência',()=>{
  for(const label of ['Data prevista','Código do fornecedor','Parcelas','Data Vencimento','Observações']){
    assert.ok(js.includes(label),`faltando na impressão: ${label}`);
  }
});
