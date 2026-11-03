import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const phase1=readFileSync(new URL('../public/modules/phase1/phase1-purchase.js',import.meta.url),'utf8');
const firebaseSync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
const selectCss=readFileSync(new URL('../public/legacy/erp-selects-polish.css',import.meta.url),'utf8');
const helper=purchase.slice(purchase.indexOf('const purchasePendingKeys='),purchase.indexOf('function sourceSignature(keys){'));
function setup(initial={}, options={}){
 const data={...initial};let commits=0;
 const ref=path=>({
  once:async()=>({val:()=>{
   if(options.failRead && path==='erp/tickets/T049')throw new Error('Falha na confirmação');
   if(path.startsWith('erp/ticketsDeletedV2/'))return null;
   return data[path]??null;
  }}),
  transaction:async fn=>{
   if(options.deny)throw new Error('PERMISSION_DENIED');
   const next=fn(data[path]??null);
   if(next===undefined)return {committed:false};
   data[path]=JSON.parse(JSON.stringify(next));commits++;
   return {committed:true,snapshot:{val:()=>data[path]}};
  }
 });
 const global={firebase:{auth:()=>({currentUser:{uid:'teste'}})},_fbDB:{ref}};
 const ticketStore={};let snapshots=0;
 const ctx={global,TICKETS_DB:ticketStore,TICKETS_DELETED:new Set(),
  _ticketsAtualizarSnapshot(){snapshots++},document:{getElementById(){return null}},money:v=>Number(v).toFixed(2)};
 runInNewContext(helper,ctx);
 return {commit:global.__ERP_PURCHASE_COMMIT_TICKET__,data,ctx,commits:()=>commits,snapshots:()=>snapshots};
}
const sample=()=>({ticket:'T049',fornecedor:'FERRO VELHO SILVA',fornecedorCod:'F001',totalGeral:46946.70,saldoPagar:46946.70,itens:[{mat:'COBRE MEL',pesoLiq:172.5,preco:71}]});
test('pedido novo é confirmado por transação no caminho individual',async()=>{
 const x=setup();await x.commit('T049',sample(),{create:true});
 assert.equal(x.commits(),1);
 assert.equal(x.data['erp/tickets/T049'].totalGeral,46946.7);
 assert.equal(x.ctx.TICKETS_DB.T049.fornecedor,'FERRO VELHO SILVA');
 assert.equal(x.snapshots(),1);
});
test('ticket existente não é sobrescrito nem gera sucesso',async()=>{
 const x=setup({'erp/tickets/T049':{ticket:'T049',fornecedor:'OUTRO',totalGeral:10}});
 await assert.rejects(x.commit('T049',sample(),{create:true}),/já existe/);
 assert.equal(x.commits(),0);assert.equal(x.data['erp/tickets/T049'].totalGeral,10);
});
test('falha de permissão não confirma e não modifica ticket',async()=>{
 const x=setup({}, {deny:true});await assert.rejects(x.commit('T049',sample(),{create:true}),/PERMISSION_DENIED/);
 assert.equal(x.data['erp/tickets/T049'],undefined);
});
test('falha de leitura posterior não é exibida como persistência confirmada',async()=>{
 const x=setup({}, {failRead:true});await assert.rejects(x.commit('T049',sample(),{create:true}),/Falha na confirmação/);
 assert.equal(x.commits(),1); // Gravação pode ter sido confirmada no servidor, mas UI deve alertar incerteza
});
test('edição concorrente não sobrescreve outro usuário',async()=>{
 const current=sample();const x=setup({'erp/tickets/T049':{...current,totalGeral:50000}});
 await assert.rejects(x.commit('T049',current,{expected:{totalGeral:46946.7,saldoPagar:46946.7}}),/outra sessão/);
 assert.equal(x.data['erp/tickets/T049'].totalGeral,50000);
});
test('ticket marcado excluído não volta por gravar outro pedido',async()=>{
 const x=setup();x.ctx.TICKETS_DELETED.add('T049');
 await assert.rejects(x.commit('T049',sample(),{create:true}),/marcado como excluído/);
});
test('sem Firebase autenticado não declara pedido salvo',async()=>{
 const x=setup();x.ctx.global.firebase.auth=()=>({currentUser:null});
 await assert.rejects(x.commit('T049',sample(),{create:true}),/Sessão Firebase expirada/);
});
test('formulário só encerra após confirmação, e listener comum aguarda commit',()=>{
 assert.match(core,/async function csConfirmarEntrada\(fornNome\)/);
 assert.match(core,/if\(__integratedPurchase\) return ticketNum;/);
 assert.match(phase1,/const result=await original\.confirmPurchase\.apply/);
 assert.match(purchase,/const result=await legacy\.confirmPurchase\.call/);
 assert.match(purchase,/await purchaseConfirmCloud\(key,ticket,\{create:true\}\)/);
 assert.ok(purchase.indexOf('await purchaseConfirmCloud(key,ticket,{create:true})')<purchase.indexOf('finishPurchaseSave(body,key,ticket,totals);'));
 assert.match(purchase,/if\(global\.__ERP_PURCHASE_IN_PROGRESS__\)/);
 assert.match(purchase,/finishPurchaseDeferredSave\(purchaseCommitted\)/);
});
test('histórico permite consultar ticket na nuvem sem criar automaticamente outro',()=>{
 assert.match(purchase,/global\.phase4PurchaseFindCloudTicket=purchaseFindCloudTicket/);
 assert.match(purchase,/Localizar pedido no Firebase/);
 assert.match(purchase,/Não recrie automaticamente/);
});
test('seletores de situação compartilham estilo profissional em múltiplos módulos',()=>{
 assert.match(selectCss,/#app-screen \.tab-panel select:not\(\[multiple\]\)/);
 for(const id of ['ponto-situacao','folha-situacao','vales-situacao','epi-situacao'])assert.ok(selectCss.includes('#'+id));
 assert.match(bootstrap,/loadStyle\('\/legacy\/erp-selects-polish\.css'\)/);
});
