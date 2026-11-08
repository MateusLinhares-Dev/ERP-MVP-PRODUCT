// Integração com o SDK OFICIAL do Firebase (firebase-admin) falando o protocolo
// WebSocket real com um servidor RTDB simulado (test/support/fake-rtdb-server.mjs).
//
// Os testes antigos usavam objetos falsos que chamavam a transação já com o
// valor do banco e aceitavam ref(''). Por isso não detectaram, em produção:
//  - db.ref('') lança "invalid path" no SDK Admin  -> HTTP 500 ao salvar compra;
//  - liberação de trava com cache frio é abortada  -> HTTP 409 por até 120 s;
//  - queda do WebSocket com transação em voo       -> Error('disconnect') / 500.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {startFakeRtdb} from './support/fake-rtdb-server.mjs';

let srv,db,app;
let mod={};
const identity={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPurchasing:true,canAdvances:true,canPayables:true,canFinance:true,canBanking:true};
const today='2026-11-08';
const viaSdk=async path=>(await db.ref(path).get()).val();
const lockPaths=()=>[
  ...Object.keys(srv.read('erpFinancePayableTicketLocks')||{}).map(k=>'erpFinancePayableTicketLocks/'+k),
  ...Object.keys(srv.read('erpFinanceAdvanceLocks')||{}).map(k=>'erpFinanceAdvanceLocks/'+k),
  ...Object.keys(srv.read('erpFinancePayableLocks')||{}).map(k=>'erpFinancePayableLocks/'+k),
  ...Object.keys(srv.read('erpSupplierRepasseLocks')||{}).map(k=>'erpSupplierRepasseLocks/'+k)
];
const baseData=()=>({erp:{
  fornecedores:{f1:{cod:'F1',nome:'TESTE NAO APAGAR',ativo:true},f2:{cod:'F2',nome:'OUTRO FORNECEDOR',ativo:true}},
  bancos:{b1:{cod:'B1',banco:'Conta Principal'}},
  tickets:{},contasPagar:{},adiantamentos:{},_ts:1
}});
function purchaseTicket(no,items,{supplier='F1',name='TESTE NAO APAGAR',discount=0,freight=0}={}){
  const products=items.reduce((sum,[,qty,price])=>sum+Math.round(qty*price*100),0)/100;
  return {ticket:no,fornecedorCod:supplier,fornecedor:name,fornecedorNome:name,
    itens:items.map(([mat,qty,price])=>({mat,pesoLiq:qty,quantidade:qty,preco:price,total:qty*price})),
    totalProdutos:products,totalGeral:Math.round((products-discount+freight)*100)/100,descontoCompra:discount,freteCompra:freight,
    dataCompra:today,vencimentoSaldo:today,status:'Pendente',_consolidado:true,_purchaseOperationId:'x'};
}

before(async()=>{
  srv=await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS='true';
  process.env.FIREBASE_PROJECT_ID='demo-erp-test';
  process.env.FIREBASE_DATABASE_URL=srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST=srv.host;
  process.env.FIREBASE_STORAGE_BUCKET='demo-erp-test.appspot.com';
  delete process.env.APP_ENV;delete process.env.VERCEL_ENV;
  const admin=await import('../server/infrastructure/firebase-admin.js');
  ({app,db}=admin.getFirebaseAdmin());
  mod={admin,
    ...(await import('../server/infrastructure/rtdb-transaction.js')),
    ...(await import('../server/infrastructure/firebase-session.js')),
    ...(await import('../server/application/purchase-order-create.js')),
    ...(await import('../server/application/purchase-order-edit.js')),
    ...(await import('../server/application/purchase-order-delete.js')),
    ...(await import('../server/application/finance-advances.js')),
    ...(await import('../server/application/finance-payment.js')),
    ...(await import('../server/application/supplier-cash-repasses.js')),
    ...(await import('../server/domain/agenda-service-catalog.js')),
    ...(await import('../server/domain/company-directory.js'))
  };
});
after(async()=>{
  try{await app?.delete();}catch{}
  await srv?.close();
});

test('SDK real: padrão antigo de liberação aborta com cache frio; releaseLease remove a trava',async()=>{
  srv.reset({locks:{T1:{owner:'A',expiresAt:Date.now()+60000}}});
  const legacy=await db.ref('locks/T1').transaction(c=>c?.owner==='A'?null:undefined,undefined,false);
  assert.equal(legacy.committed,false,'reproduz o bug de produção');
  assert.equal(srv.read('locks/T1').owner,'A');
  assert.equal(await mod.releaseLease(db.ref('locks/T1'),'A'),true);
  assert.equal(srv.read('locks/T1'),null);
  // Trava de outro dono nunca é removida.
  srv.seed('locks/T2',{owner:'B',expiresAt:Date.now()+60000});
  assert.equal(await mod.releaseLease(db.ref('locks/T2'),'A'),true);
  assert.equal(srv.read('locks/T2').owner,'B');
});

test('SDK real: db.ref("") é inválido no SDK Admin (causa do 500 ao salvar compra)',()=>{
  assert.throws(()=>db.ref(''),/invalid path/i);
  assert.doesNotThrow(()=>db.ref());
});

test('compras: duas compras seguidas são confirmadas sem 500 nem 409 e sem travas residuais',async()=>{
  srv.reset(baseData());
  for(const [no,qty] of [['T327',3],['T328',5]]){
    const ticket=purchaseTicket(no,[['BRONZE',qty,30],['CABO BANDA',1,10]]);
    const result=await mod.createPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:no,fornecedorCod:'F1',ticket,advanceCodes:[],chequeIds:[],useLegacyCredit:false,sourceTicketKeys:[]},{db});
    assert.equal(result.ticket.ticket,no);
    assert.equal(result.payable.id,'CPPO_'+no);
    assert.equal(srv.read('erp/tickets/'+no).totalGeral,qty*30+10);
    assert.equal(srv.read('erp/contasPagar/CPPO_'+no).valor,qty*30+10);
  }
  assert.deepEqual(lockPaths(),[]);
});

test('compras: falha de validação após obter a trava não bloqueia a nova tentativa',async()=>{
  srv.reset(baseData());
  srv.seed('erp/tickets/T100',{ticket:'T100',fornecedorCod:'F1',status:'Consolidado',_balFinalizado:false});
  const ticket=purchaseTicket('T329',[['BRONZE',2,30]]);
  const input={operationId:randomUUID(),ticketNo:'T329',fornecedorCod:'F1',ticket,advanceCodes:[],chequeIds:[],useLegacyCredit:false,sourceTicketKeys:['T100']};
  await assert.rejects(mod.createPurchaseOrder(identity,input,{db}),{code:'SOURCE_CHANGED'});
  assert.deepEqual(lockPaths(),[],'trava liberada após a recusa');
  const ok=await mod.createPurchaseOrder(identity,{...input,operationId:randomUUID(),sourceTicketKeys:[]},{db});
  assert.equal(ok.ticket.ticket,'T329');
  assert.deepEqual(lockPaths(),[]);
});

test('compras: queda de conexão durante a trava é recuperada; repetição é idempotente',async()=>{
  srv.reset(baseData());
  srv.dropNextTransaction('erpFinancePayableTicketLocks/T330');
  const ticket=purchaseTicket('T330',[['COBRE',4,40]]);
  const input={operationId:randomUUID(),ticketNo:'T330',fornecedorCod:'F1',ticket,advanceCodes:[],chequeIds:[],useLegacyCredit:false,sourceTicketKeys:[]};
  const first=await mod.createPurchaseOrder(identity,input,{db});
  assert.equal(first.alreadyCommitted,false);
  const again=await mod.createPurchaseOrder(identity,input,{db});
  assert.equal(again.alreadyCommitted,true);
  assert.deepEqual(lockPaths(),[]);
  assert.ok(srv.stats.dropped>=1);
});

test('compras: associa adiantamento PIX parcial e adiantamento pago em cheque',async()=>{
  const data=baseData();
  data.erp.adiantamentos.F1=[
    {cod:'ADTPIX',valor:100,status:'Pendente',forma:'PIX',bancoCod:'B1',data:'01/11/2026'},
    {cod:'ADTCHQ',valor:50,status:'Pendente',forma:'Cheque',data:'02/11/2026',chequeIds:['CC1']}
  ];
  srv.reset(data);
  const ticket=purchaseTicket('T331',[['ALUMINIO',3,40]]); // 120,00
  const result=await mod.createPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T331',fornecedorCod:'F1',ticket,
    advanceCodes:['ADTPIX','ADTCHQ'],chequeIds:[],useLegacyCredit:false,sourceTicketKeys:[]},{db});
  assert.equal(result.ticket.adiantamento,120);
  assert.equal(result.ticket.saldoPagar,0);
  assert.equal(result.ticket.status,'Pago');
  const advances=await viaSdk('erp/adiantamentos/F1');
  assert.equal(advances[0].status,'Quitado');
  assert.equal(advances[1].status,'Pendente');
  assert.equal(advances[1].valor,30);
  assert.equal(advances[1].valorCompensado,20);
  assert.equal(srv.read('erp/contasPagar/CPPO_T331'),null);
  assert.deepEqual(lockPaths(),[]);
});

test('compras: edição com mudança de valor e exclusão de pedido sem baixa funcionam (antes: 500)',async()=>{
  srv.reset(baseData());
  const ticket=purchaseTicket('T332',[['BRONZE',2,50]]);
  const created=await mod.createPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T332',fornecedorCod:'F1',ticket,advanceCodes:[],chequeIds:[],useLegacyCredit:false,sourceTicketKeys:[]},{db});
  // O cliente lê o pedido pelo SDK (arrays reconstituídos); o teste faz o mesmo.
  const expectedTicket=await viaSdk('erp/tickets/T332');
  const next=structuredClone(expectedTicket);
  next.itens[0].preco=60;next.itens[0].total=120;next.totalProdutos=120;next.totalGeral=120;next.saldoPagar=120;
  const edited=await mod.editPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T332',expectedTicket,ticket:next},{db});
  assert.equal(edited.ticket.totalGeral,120);
  assert.equal(srv.read('erp/contasPagar/CPPO_T332').valor,120);
  assert.deepEqual(lockPaths(),[]);
  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T332',expectedTotal:120,expectedSupplier:'F1'},{db});
  assert.equal(removed.status,'CONFIRMED');
  assert.equal(srv.read('erp/tickets/T332'),null);
  assert.equal(srv.read('erp/contasPagar/CPPO_T332'),null);
  assert.equal(srv.read('erp/ticketsDeletedV2/T332'),true);
  assert.deepEqual(lockPaths(),[]);
  assert.equal(created.ticket.ticket,'T332');
});

test('adiantamentos: criar, recusa de exclusão, excluir e criar de novo sem bloqueio do fornecedor',async()=>{
  srv.reset(baseData());
  const input={fornCod:'F1',data:today,valor:150,forma:'PIX',bancoCod:'B1',empresa:'Manuela',ticket:'',obs:''};
  const first=await mod.createAdvance(identity,{...input,operationId:randomUUID()},{db});
  assert.equal(first.advance.valor,150);
  const wrong={...first.advance,valor:999};
  await assert.rejects(mod.changeAdvance(identity,{action:'delete',fornCod:'F1',adtCod:first.advance.cod,expected:wrong,operationId:randomUUID()},{db}),{code:'ADVANCE_CHANGED'});
  assert.deepEqual(lockPaths(),[],'trava liberada após recusa');
  const removed=await mod.changeAdvance(identity,{action:'delete',fornCod:'F1',adtCod:first.advance.cod,expected:first.advance,operationId:randomUUID()},{db});
  assert.equal(removed.action,'delete');
  const second=await mod.createAdvance(identity,{...input,valor:80,operationId:randomUUID()},{db});
  assert.equal(second.advance.valor,80);
  assert.equal((await viaSdk('erp/adiantamentos/F1')).length,1);
  assert.equal(Object.keys(srv.read('erp/lancBanco')).length,1);
  assert.deepEqual(lockPaths(),[]);
});

test('contas a pagar: recusa por versão desatualizada não bloqueia a baixa correta',async()=>{
  const data=baseData();
  data.erp.contasPagar={CP1:{id:'CP1',desc:'Frete',cred:'Transportadora',valor:300,status:'Pendente',pagamentos:[]}};
  srv.reset(data);
  const base={payableId:'CP1',bankCode:'B1',date:today,amount:300,advanceAmount:0};
  await assert.rejects(mod.payPayable(identity,{...base,operationId:randomUUID(),expected:{valor:250,status:'Pendente',paymentsCount:0}},{db}),{code:'PAYABLE_CHANGED'});
  assert.deepEqual(lockPaths(),[]);
  const paid=await mod.payPayable(identity,{...base,operationId:randomUUID(),expected:{valor:300,status:'Pendente',paymentsCount:0}},{db});
  assert.equal(paid.payable.status,'Pago');
  assert.equal(Object.values(srv.read('erp/lancBanco')).length,1);
  assert.deepEqual(lockPaths(),[]);
});

test('repasses: dois lançamentos seguidos do mesmo fornecedor (antes: trava presa por 90 s)',async()=>{
  srv.reset(baseData());
  for(const valor of [100,40]){
    const result=await mod.changeSupplierCashRepasse(identity,{action:'receive',fornCod:'F1',operationId:randomUUID(),data:today,valor,obs:'teste'},{db});
    assert.equal(result.record.valor,valor);
  }
  assert.equal(Object.keys(srv.read('erp/fornecedorRepasses/F1')).length,2);
  assert.deepEqual(lockPaths(),[]);
});

test('agenda e empresas: exclusão funciona com cache frio',async()=>{
  srv.reset({erpAgendaServices:null});
  const ref=db.ref('erpAgendaServices/catalog');
  const added=await mod.mutateAgendaServiceCatalog(ref,{action:'add',name:'PESAGEM AVULSA',actor:'elaine'});
  const custom=added.items.find(item=>item.name==='PESAGEM AVULSA');
  assert.ok(custom);
  const removed=await mod.mutateAgendaServiceCatalog(ref,{action:'delete',id:custom.id,actor:'elaine'});
  assert.equal(removed.changed,true);
  assert.equal((await viaSdk('erpAgendaServices/catalog')).items.some(item=>item.id===custom.id),false);

  srv.reset({erp:{config:{}}});
  const directory=await mod.getCompanyDirectory(db);
  const dirRef=db.ref('erp/companyDirectory');
  const created=await mod.transactCompanyDirectory(db,dirRef,'create','RAFAEL',directory.revision);
  assert.equal(created.committed,true);
  const deleted=await mod.transactCompanyDirectory(db,dirRef,'delete','RAFAEL',directory.revision+1);
  assert.equal(deleted.committed,true);
  assert.ok((await viaSdk('erp/companyDirectory')).deletedCompanies.includes('RAFAEL'));
});

test('conexão: cada rajada de requisições usa WebSocket novo e encerra ao ficar ociosa',async()=>{
  srv.reset({erp:{_ts:1}});
  // Estado inicial conhecido: uma rajada encerrada deixa a conexão offline.
  const warm=new EventEmitter();mod.trackFirebaseRequest(warm);warm.emit('finish');
  const before=srv.stats.connections;
  for(let i=0;i<2;i++){
    const res=new EventEmitter();
    mod.trackFirebaseRequest(res);
    const {db:requestDb}=mod.admin.getFirebaseAdmin();
    assert.equal((await requestDb.ref('erp/_ts').get()).val(),1);
    res.emit('finish');res.emit('close');
    assert.equal(mod.firebaseSessionState().activeRequests,0);
  }
  assert.ok(srv.stats.connections>=before+2,'uma conexão nova por rajada');
  // Requisições concorrentes compartilham a mesma conexão.
  const a=new EventEmitter(),b=new EventEmitter();
  mod.trackFirebaseRequest(a);mod.trackFirebaseRequest(b);
  const first=mod.admin.getFirebaseAdmin().db;
  await first.ref('erp/_ts').get();
  a.emit('finish');
  assert.equal(mod.firebaseSessionState().activeRequests,1);
  assert.equal((await mod.admin.getFirebaseAdmin().db.ref('erp/_ts').get()).val(),1);
  b.emit('finish');
  assert.equal(mod.firebaseSessionState().activeRequests,0);
  // Deixa o SDK online para os próximos testes do arquivo (se houver).
  mod.admin.getFirebaseAdmin();
});
