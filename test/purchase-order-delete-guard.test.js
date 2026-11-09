import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {deletePurchaseOrder} from '../server/modules/purchases/application/delete-purchase-order.js';

const user={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPurchasing:true,canPayables:true};
const op='4e2b0b8a-e5d8-40bd-a74d-d489eeb23a54';
const request={ticketNo:'T310',operationId:op,expectedTotal:50,expectedSupplier:'F675'};
function fakeDb(opts={}){
  const data={erp:{
    tickets:{T310:{ticket:'T310',_consolidado:true,_purchaseOperationId:'a',fornecedorCod:'F675',totalGeral:50,saldoPagar:50,adiantamento:0,status:'Pendente',reciboFinanceiro:{total:0,versao:2}}},
    contasPagar:{CPPO_T310:{id:'CPPO_T310',ticket:'T310',fornCod:'F675',valor:50,status:'Pendente',valorPago:0,pagamentos:[]}},
    adiantamentos:{F675:[]},lancBanco:{},cheques:{F675:[]},saldos:{},saldoDevedor:{},financePayableOperations:{},financeAdvanceOperations:{},ticketsDeletedV2:{},
  }};
  const original=structuredClone(data);
  let updates=0;
  const get=path=>path.split('/').filter(Boolean).reduce((cur,k)=>cur?.[k],data);
  const put=(path,value)=>{
    const parts=path.split('/').filter(Boolean),leaf=parts.pop();let current=data;
    for(const name of parts){if(current[name]==null)current[name]={};current=current[name];}
    if(value===null)delete current[leaf];else current[leaf]=structuredClone(value);
  };
  const db={data,original,get updates(){return updates;},onUpdate:null,ref(path=''){return {
    async get(){const val=structuredClone(get(path)??null);return {val:()=>val};},
    async transaction(fn){const before=structuredClone(get(path)??null),after=fn(before);if(after===undefined)return {committed:false,snapshot:{val:()=>before}};put(path,after);return {committed:true,snapshot:{val:()=>after}};},
    async update(patch){if(db.onUpdate)await db.onUpdate();if(opts.failUpdate)throw Error('simulated failure');for(const [subpath,value] of Object.entries(patch))put(path+'/'+subpath,value);updates++;}
  };}};
  return db;
}
const run=(db,req=request,actor=user)=>deletePurchaseOrder(actor,req,{db,now:()=>1794050000000,uuid:()=> 'unique-lock-owner'});

function assertNoDelete(db){
  assert.equal(db.updates,0);
  assert.ok(db.data.erp.tickets.T310);
  assert.ok(db.data.erp.contasPagar.CPPO_T310);
  assert.equal(db.data.erp.ticketsDeletedV2.T310,undefined);
}

test('compra com conta a pagar pendente e sem baixas é excluída junto com o título em uma gravação',async()=>{
  const db=fakeDb(),out=await run(db);
  assert.equal(out.status,'CONFIRMED');
  assert.deepEqual(out.deletedPayableIds,['CPPO_T310']);
  assert.equal(db.updates,1);
  assert.equal(db.data.erp.tickets.T310,undefined);
  assert.equal(db.data.erp.contasPagar.CPPO_T310,undefined);
  assert.equal(db.data.erp.ticketsDeletedV2.T310,true);
  assert.equal(db.data.erp.contasPagarDeleted.CPPO_T310,true);
  assert.equal(db.data.erpFinancePayableTicketLocks?.T310,undefined);
});

test('duas tentativas com o mesmo UUID não excluem outra coisa e não geram operação adicional',async()=>{
  const db=fakeDb(),first=await run(db),replay=await run(db);
  assert.equal(first.status,'CONFIRMED');assert.equal(replay.alreadyCommitted,true);
  assert.equal(db.updates,1);
  await assert.rejects(run(db,{...request,ticketNo:'T311'}),{code:'OPERATION_USED'});
});

test('compra consolidada sem conta a pagar não é removida isoladamente',async()=>{
  const db=fakeDb();delete db.data.erp.contasPagar.CPPO_T310;
  await assert.rejects(run(db),{code:'PURCHASE_PAYABLE_MISSING'});
  assert.equal(db.updates,0);assert.ok(db.data.erp.tickets.T310);
});

test('título legado não canônico exige revisão em vez de exclusão parcial',async()=>{
  const db=fakeDb();db.data.erp.contasPagar={'0':{id:'CP-OLD',ticket:'T310',fornCod:'F675',valor:50,status:'Pendente'}};
  await assert.rejects(run(db),{code:'LEGACY_PAYABLE_REVIEW'});
  assert.equal(db.updates,0);
});

test('bloqueia compra paga mesmo que título financeiro tenha desaparecido',async()=>{
  const db=fakeDb();db.data.erp.tickets.T310.status='Pago';delete db.data.erp.contasPagar.CPPO_T310;
  await assert.rejects(run(db),{code:'PURCHASE_HAS_FINANCE'});assert.equal(db.updates,0);
});

test('bloqueia adiantamento utilizado e não modifica o movimento original',async()=>{
  const db=fakeDb(),t=db.data.erp.tickets.T310;t.adiantamento=35;t.saldoPagar=15;
  db.data.erp.adiantamentos.F675=[{cod:'ADT-35',ticket:'T310',status:'Quitado',valor:35}];
  await assert.rejects(run(db),{code:'PURCHASE_HAS_FINANCE'});assertNoDelete(db);
});

test('bloqueia título com pagamentos mesmo quando status foi restaurado a Pendente',async()=>{
  const db=fakeDb();db.data.erp.contasPagar.CPPO_T310.pagamentos=[{valor:50,movBancoId:'LB-1'}];
  await assert.rejects(run(db),{code:'PURCHASE_HAS_PAYMENTS'});assertNoDelete(db);
});

test('bloqueia lançamento bancário vinculado a título ainda pendente',async()=>{
  const db=fakeDb();db.data.erp.lancBanco['LB-PG-1']={tipo:'Saida',valor:50,payableId:'CPPO_T310'};
  await assert.rejects(run(db),{code:'PURCHASE_HAS_LINKS'});assertNoDelete(db);
});

test('bloqueia recibo de baixa confirmado, mesmo se a conta a pagar não tem pagamentos visíveis',async()=>{
  const db=fakeDb();db.data.erp.financePayableOperations['usr_uuid']={result:{payable:{ticket:'T310',status:'Pago'}}};
  await assert.rejects(run(db),{code:'PURCHASE_HAS_LINKS'});assertNoDelete(db);
});

test('bloqueia saldo credor legado vinculado a T310',async()=>{
  const db=fakeDb();db.data.erp.saldoDevedor.F675={ticket:'T310',valor:200};
  await assert.rejects(run(db),{code:'PURCHASE_HAS_LINKS'});assertNoDelete(db);
});

test('não remove conta a pagar já quitada nem versão alterada',async()=>{
  const db=fakeDb();db.data.erp.contasPagar.CPPO_T310.status='Pago';
  await assert.rejects(run(db),{code:'PURCHASE_HAS_PAYMENTS'});assertNoDelete(db);
  const next=fakeDb();next.data.erp.tickets.T310.totalGeral=75;
  await assert.rejects(run(next),{code:'PURCHASE_CHANGED'});assertNoDelete(next);
});

test('dois títulos para o mesmo ticket bloqueiam exclusão',async()=>{
  const db=fakeDb();db.data.erp.contasPagar.CPALT={id:'CPALT',ticket:'T310',valor:50,status:'Pendente',pagamentos:[]};
  await assert.rejects(run(db),{code:'MULTIPLE_PAYABLES'});assertNoDelete(db);
});

test('bloqueia sessão sem permissão e requer acesso financeiro para excluir título',async()=>{
  const db=fakeDb();await assert.rejects(run(db,request,{...user,canPurchasing:false}),{code:'PURCHASE_FORBIDDEN'});
  await assert.rejects(run(db,request,{...user,canPayables:false}),{code:'PAYABLES_REQUIRED'});assertNoDelete(db);
});

test('não considera exclusão confirmada se a gravação Firebase falhar',async()=>{
  const db=fakeDb({failUpdate:true});await assert.rejects(run(db),/simulated failure/);assertNoDelete(db);
});

test('trava financeira em andamento impede exclusão antes de tocar no pedido',async()=>{
  const db=fakeDb();db.data.erpFinancePayableTicketLocks={T310:{owner:'payment',expiresAt:1794050100000}};
  await assert.rejects(run(db),{code:'PURCHASE_DELETE_BUSY'});assertNoDelete(db);
});

test('front usa endpoint e não apaga localmente antes do ACK; rules vedam deleção de compra consolidada',()=>{
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  const start=core.indexOf('async function excluirEntradaCompra('),end=core.indexOf('function abrirBaixaCompraNoFinanceiro(',start);
  assert.ok(start>0&&end>start);
  const snippet=core.slice(start,end);
  assert.match(snippet,/fetch\('\/api\/finance\/purchase-order-delete'/);
  assert.ok(snippet.indexOf('if(result.status!==\'CONFIRMED\'')<snippet.indexOf('delete TICKETS_DB[id]'));
  assert.doesNotMatch(snippet.replace(/\/\/[^\n]*/g,''),/_ticketExcluir\(ticket\)|saveDB\(\)|saveContasPagar\(\);/);
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url)));
  assert.ok(rules.rules.erp.tickets.$ticketId['.write'].includes("data.child('_consolidado').val() != true"));
  assert.equal(rules.rules.erp.ticketsDeletedV2['.write'],false);
});

function frontend(response,shouldThrow=false){
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  const begin=core.indexOf('const _purchaseDeletePending=new Set();');
  const end=core.indexOf('function abrirBaixaCompraNoFinanceiro(',begin);
  assert.ok(begin>0&&end>begin);
  const state={TICKETS_DB:{T310:{ticket:'T310',fornecedorCod:'F675',totalGeral:50}},
    CONTAS_PAGAR:[{id:'CPPO_T310',ticket:'T310',status:'Pendente',valor:50}],
    TICKETS_DELETED:new Set(),CONTAS_PAGAR_DELETED:new Set(),_ticketsSnapJSON:{T310:'snapshot'}};
  const messages=[];
  const scope={...state,localStorage:{setItem(){}},console:{error(){}},document:{getElementById:()=>null},
    window:{firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token'}})},crypto:{randomUUID:()=>op}},
    confirm:()=>true,showToast:(message,level)=>messages.push({message,level}),
    renderTickets(){},renderContasPagar(){},
    fetch:async()=>{if(shouldThrow)throw new Error('network timeout');return response;}};
  runInNewContext(core.slice(begin,end)+';this.executePurchaseDelete=excluirEntradaCompra;',scope);
  return {scope,messages};
}

test('navegador não oculta compra ou título quando API retorna vínculo financeiro',async()=>{
  const {scope,messages}=frontend({ok:false,status:409,json:async()=>({code:'PURCHASE_HAS_LINKS',message:'Existem vínculos financeiros nesta compra. Não é possível excluí-la sem estorno e conciliação.'})});
  await scope.executePurchaseDelete('T310');
  assert.ok(scope.TICKETS_DB.T310);
  assert.equal(scope.CONTAS_PAGAR.length,1);
  assert.equal(scope.TICKETS_DELETED.size,0);
  assert.match(messages.at(-1).message,/vínculos financeiros/,'mostra o motivo real enviado pelo servidor');
  const semMensagem=frontend({ok:false,status:409,json:async()=>({code:'PURCHASE_HAS_PAYMENTS'})});
  await semMensagem.scope.executePurchaseDelete('T310');
  assert.match(semMensagem.messages.at(-1).message,/vínculo financeiro/);
});

test('navegador remove ticket local somente após resposta CONFIRMED da API',async()=>{
  const {scope,messages}=frontend({ok:true,status:200,json:async()=>({status:'CONFIRMED',ticketNo:'T310',deletedPayableIds:['CPPO_T310']})});
  await scope.executePurchaseDelete('T310');
  assert.equal(scope.TICKETS_DB.T310,undefined);
  assert.equal(scope.CONTAS_PAGAR.length,0);
  assert.equal(scope.TICKETS_DELETED.has('T310'),true);
  assert.equal(scope.CONTAS_PAGAR_DELETED.has('CPPO_T310'),true);
  assert.match(messages.at(-1).message,/excluída com segurança/);
});

test('falha de rede não pode confirmar exclusão na interface',async()=>{
  const {scope}=frontend(null,true);
  await scope.executePurchaseDelete('T310');
  assert.ok(scope.TICKETS_DB.T310);
  assert.equal(scope.CONTAS_PAGAR.length,1);
});
