import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const file=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const po=file('../public/modules/purchase-order/purchase-order.js');
const core=file('../public/legacy/app-core.js');
const sync=file('../public/legacy/firebase-sync.js');
const pager=file('../public/modules/phase1/list-pagination.js');
const html=file('../public/index.template.html');
const bootstrap=file('../public/app/bootstrap.js');
const part=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`Unable to extract ${start}`);return text.slice(a,b);};

test('numeração escolhida na nuvem é obrigatória na criação legada, e nunca é gerada uma segunda vez',()=>{
 const legacy=part(core,'async function csConfirmarEntrada(fornNome){','function _balGetHistorico(){');
 assert.match(legacy,/const ticketNum=__integratedPurchase\?reserved:getNextTicketId\(\)/);
 assert.match(legacy,/if\(TICKETS_DB\[ticketNum\]\)throw/);
 assert.match(po,/global\.__ERP_PURCHASE_SELECTED_NUMBER__=availableNumber/);
 assert.match(po,/const key=availableNumber/);
 assert.doesNotMatch(po,/const key=created\[created\.length-1\]/);
});

test('cancelamento da transação descarta pedido temporário e preserva conta de outro usuário',()=>{
 const rollback=part(po,'function purchaseTakeLocalSnapshot(state){','function purchaseEditError(result,status){');
 const TICKETS_DB={T150:{ticket:'T150',status:'Aguard. Preço',_balFinalizado:true},T100:{ticket:'T100',status:'Pago'}};
 const ADT_POR_FORN={F1:[{cod:'ADT1',status:'Pendente',valor:500}]};
 const CHEQUES_POR_FORN={F1:[{id:'CH1',_aplicadoTicket:''}]};
 const SALDO_DEVEDOR_FORN={F1:{valor:12}};
 const PRECOS_FORN_DATA={F1:{COBRE:10}};
 const CONTAS_PAGAR=[{id:'CP1',ticket:'T100',valor:50}];
 const _DEL_SETS={saldoDevedor:new Set()};
 const localValues={};
 const ctx={TICKETS_DB,ADT_POR_FORN,CHEQUES_POR_FORN,SALDO_DEVEDOR_FORN,PRECOS_FORN_DATA,CONTAS_PAGAR,_DEL_SETS,
   _DEL_LS_KEY:{saldoDevedor:'deleted-saldos'},
   global:{__ERP_PURCHASE_SELECTED_NUMBER__:'T151'},tickets:()=>TICKETS_DB,
   localStorage:{setItem(k,v){localValues[k]=v;}},saveDB(){},renderTickets(){}};
 runInNewContext(rollback+'\nvar savedState=purchaseTakeLocalSnapshot({supplierCode:"F1",sourceTicketKeys:["T150"]});',ctx);
 TICKETS_DB.T151={ticket:'T151',totalGeral:1000};
 TICKETS_DB.T150.status='Consolidado';
 ADT_POR_FORN.F1[0].status='Quitado';
 CHEQUES_POR_FORN.F1[0]._aplicadoTicket='T151';
 SALDO_DEVEDOR_FORN.F1.valor=800;
 _DEL_SETS.saldoDevedor.add('F1');
 PRECOS_FORN_DATA.F1.COBRE=19;
 CONTAS_PAGAR.push({id:'NEW',ticket:'T151',valor:500});
 CONTAS_PAGAR.push({id:'OTHER',ticket:'T200',valor:600});
 runInNewContext(rollback+'\npurchaseRollbackLocal(savedState);',ctx);
 assert.equal(TICKETS_DB.T151,undefined);
 assert.equal(TICKETS_DB.T150.status,'Aguard. Preço');
 assert.equal(ADT_POR_FORN.F1[0].status,'Pendente');
 assert.equal(CHEQUES_POR_FORN.F1[0]._aplicadoTicket,'');
 assert.equal(SALDO_DEVEDOR_FORN.F1.valor,12);
 assert.equal(_DEL_SETS.saldoDevedor.has('F1'),false);
 assert.equal(localValues['deleted-saldos'],'[]');
 assert.equal(PRECOS_FORN_DATA.F1.COBRE,10);
 assert.deepEqual(CONTAS_PAGAR.map(row=>row.id),['CP1','OTHER']);
});

test('edicao recusada no servidor restaura ticket e contas a pagar originais sem afetar outras compras',()=>{
 const rollback=part(po,'function purchaseTakeLocalSnapshot(state){','function purchaseEditError(result,status){');
 const TICKETS_DB={T124:{ticket:'T124',totalGeral:1200,saldoPagar:200}};
 const ADT_POR_FORN={F1:[]};const CHEQUES_POR_FORN={F1:[]};
 const SALDO_DEVEDOR_FORN={};const PRECOS_FORN_DATA={};
 const CONTAS_PAGAR=[{id:'FIN',ticket:'T124',valor:200},{id:'ANOTHER',ticket:'T500',valor:300}];
 const ctx={TICKETS_DB,ADT_POR_FORN,CHEQUES_POR_FORN,SALDO_DEVEDOR_FORN,PRECOS_FORN_DATA,CONTAS_PAGAR,
   global:{},tickets:()=>TICKETS_DB,localStorage:{setItem(){}},saveDB(){},renderTickets(){}};
 runInNewContext(rollback+'\nvar savedEdit=purchaseTakeLocalSnapshot({supplierCode:"F1",editKey:"T124"});',ctx);
 TICKETS_DB.T124.totalGeral=950;CONTAS_PAGAR[0].valor=150;
 CONTAS_PAGAR.push({id:'LATE',ticket:'T999',valor:1});
 runInNewContext(rollback+'\npurchaseRollbackLocal(savedEdit);',ctx);
 assert.equal(TICKETS_DB.T124.totalGeral,1200);
 assert.equal(CONTAS_PAGAR.find(x=>x.id==='FIN').valor,200);
 assert.deepEqual(CONTAS_PAGAR.filter(x=>x.ticket==='T124').map(x=>x.id),['FIN']);
 assert.deepEqual(CONTAS_PAGAR.filter(x=>x.ticket!=='T124').map(x=>x.id),['ANOTHER','LATE']);
 assert.match(po,/purchaseRollbackLocal\(editSnapshot\)/);
});

test('segunda sessão não fecha pesagem já consolidada no Firebase',async()=>{
 const validate=part(po,'async function validateCloudSourceTickets(state){','function setSaving(value){');
 const cloud={T150:{ticket:'T150',status:'Aguard. Preço',_balFinalizado:true},
   T151:{ticket:'T151',status:'Consolidado',_consolidadoEm:'T190',_balFinalizado:false}};
 const ctx={purchaseCloudRef:id=>({once:async()=>({val:()=>cloud[id]})})};
 const valid=await runInNewContext(validate+'\nvalidateCloudSourceTickets({sourceTicketKeys:["T150"]})',ctx);
 assert.equal(valid,undefined);
 await assert.rejects(runInNewContext(validate+'\nvalidateCloudSourceTickets({sourceTicketKeys:["T151"]})',ctx),/já foi fechada/);
});

test('histórico financeiro não conta pesagem de origem junto de pedido consolidado',()=>{
 const code=part(core,'function _compraHistoricoVisivel(ticket){','function renderTickets(){');
 const TICKETS_DB={T150:{ticket:'T150',status:'Consolidado',_consolidadoEm:'T151'},
   T151:{ticket:'T151',status:'Pendente',_consolidado:true},
   T152:{ticket:'T152',status:'Pendente'}};
 const ctx={TICKETS_DB};
 const testVisibility=runInNewContext(code+'\n_compraHistoricoVisivel',ctx);
 assert.equal(testVisibility(TICKETS_DB.T150),false);
 assert.equal(testVisibility(TICKETS_DB.T151),true);
 assert.equal(testVisibility(TICKETS_DB.T152),true);
 delete TICKETS_DB.T151;
 assert.equal(testVisibility(TICKETS_DB.T150),true); // não oculta a fonte sem pedido final
});

test('paginador de compra aparece antes da tabela e nunca é escondido com <=25 compras',()=>{
 assert.match(pager,/key === 'compra-historico' \? 'beforebegin' : 'afterend'/);
 assert.match(core,/ERPListPager\?\.slice\('compra-historico',all,'tb-compras',renderTickets,\{alwaysShow:true\}\)/);
 assert.match(bootstrap,/const assetRevision = '20261106-payables-choice-v1'/);
 assert.match(html,/bootstrap\.js\?v=20261106-payables-choice-v1/);
});

test('sincronizador em lote não publica pedido provisório enquanto transação individual está em andamento',()=>{
 assert.match(sync,/if\(window\.__ERP_PURCHASE_IN_PROGRESS__===true\)/);
 assert.match(sync,/if\(window\.__ERP_PURCHASE_PENDING_KEYS__\?\.has\(String\(k\)\)\)return/);
 assert.match(sync,/if\(window\.__ERP_PURCHASE_PENDING_KEYS__\?\.has\(tid\)\)return/);
 assert.match(po,/purchaseRollbackLocal\(snapshot\)/);
 assert.match(po,/ticket\._purchaseOperationId=body\.dataset\.purchaseOperationId/);
});
