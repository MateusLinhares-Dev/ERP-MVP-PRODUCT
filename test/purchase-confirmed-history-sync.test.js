import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const extract=(source,begin,end)=>{
  const start=source.indexOf(begin);
  assert.ok(start>=0,`Não encontrei início: ${begin}`);
  const stop=source.indexOf(end,start);
  assert.ok(stop>start,`Não encontrei fim: ${end}`);
  return source.slice(start,stop);
};
const purchaseHelpers=extract(purchase,'const purchasePendingKeys=','function sourceSignature(keys){');
const syncProtector=extract(sync,'  function _fbPreservarComprasConfirmadas(','  // Protect a locally edited ticket');
function setup(){
  const saved={};
  const db={ref:path=>({
    once:async()=>({val:()=>path.startsWith('erp/ticketsDeletedV2/')?null:(saved[path]||null)}),
    transaction:async updater=>{
      const value=updater(saved[path]??null);
      if(value===undefined)return {committed:false};
      saved[path]=structuredClone(value);
      return {committed:true};
    }
  })};
  const global={_fbDB:db,firebase:{auth:()=>({currentUser:{uid:'teste'}})}};
  const ctx={global,window:global,Map,Date,TICKETS_DB:{},_ticketsSnapJSON:{},TICKETS_DELETED:new Set()};
  runInNewContext(purchaseHelpers+'\n'+syncProtector+'\nthis.protect=_fbPreservarComprasConfirmadas;',ctx);
  return {ctx,commit:global.__ERP_PURCHASE_COMMIT_TICKET__,saved};
}
const ticket=()=>({
  ticket:'T317',fornecedorCod:'F675',fornecedor:'TESTE NAO APAGAR',
  totalGeral:23,saldoPagar:23,status:'Pendente',_purchaseOperationId:'operacao-317',
  itens:[{mat:'ALUMINIO',pesoLiq:1,preco:23}]
});

test('ACK confirmado permanece visível se uma leitura geral anterior ainda não traz o ticket',async()=>{
  const x=setup();
  await x.commit('T317',ticket(),{create:true});
  assert.equal(x.ctx.TICKETS_DB.T317.totalGeral,23);
  assert.ok(x.ctx.global.__ERP_PURCHASE_RECENT_CONFIRMED__?.has('T317'));
  // Simula uma leitura geral iniciada antes do commit: o merge substitui a lista.
  const before=structuredClone(x.ctx.TICKETS_DB);
  Object.keys(x.ctx.TICKETS_DB).forEach(k=>delete x.ctx.TICKETS_DB[k]);
  x.ctx.protect({},before);
  assert.equal(x.ctx.TICKETS_DB.T317.ticket,'T317');
  assert.equal(x.ctx.TICKETS_DB.T317.status,'Pendente');
  assert.equal(x.saved['erp/tickets/T317'].totalGeral,23);
});

test('leitura atualizada do servidor prevalece e não restaura status antigo',async()=>{
  const x=setup();await x.commit('T317',ticket(),{create:true});
  const paid={...ticket(),status:'Pago',saldoPagar:0};
  x.ctx.TICKETS_DB={T317:paid};
  x.ctx.protect({T317:paid},{T317:ticket()});
  assert.equal(x.ctx.TICKETS_DB.T317.status,'Pago');
  assert.equal(x.ctx.global.__ERP_PURCHASE_RECENT_CONFIRMED__.has('T317'),false);
});

test('tombstone ou expiração impedem reaparecimento do ticket',async()=>{
  const x=setup();await x.commit('T317',ticket(),{create:true});
  x.ctx.TICKETS_DELETED.add('T317');
  delete x.ctx.TICKETS_DB.T317;
  x.ctx.protect({},{});
  assert.equal(x.ctx.TICKETS_DB.T317,undefined);
  assert.equal(x.ctx.global.__ERP_PURCHASE_RECENT_CONFIRMED__.has('T317'),false);
  x.ctx.TICKETS_DELETED.clear();
  x.ctx.global.__ERP_PURCHASE_RECENT_CONFIRMED__.set('T317',{ticket:ticket(),ts:Date.now()-31000});
  x.ctx.protect({},{});
  assert.equal(x.ctx.TICKETS_DB.T317,undefined);
});

test('as duas leituras gerais usam proteção e child_removed descarta registro recente',()=>{
  assert.match(sync,/_safeMerge\(_tkLocal, d\.tickets\|\|\{\}, TICKETS_DB\); _fbPreservarComprasConfirmadas\(d\.tickets,_tkLocal\)/);
  assert.match(sync,/_mergeObj\(_tkLocal, d\.tickets\|\|\{\}, TICKETS_DB\); _fbPreservarComprasConfirmadas\(d\.tickets,_tkLocal\)/);
  assert.match(sync,/__ERP_PURCHASE_RECENT_CONFIRMED__\?\.delete\(tid\)/);
  assert.match(purchase,/purchaseRememberServerAck\(key,result\.ticket\)/);
  assert.match(purchase,/await purchaseCreateAtomic\(key,ticket,state,body\)/);
});

test('versão atualizada do bootstrap impede carregar JavaScript antigo',()=>{
  assert.match(bootstrap,/assetRevision = '20261109-rapido-cheques-datas-v5'/);
  assert.match(html,/bootstrap\.js\?v=20261109-rapido-cheques-datas-v5/);
});
