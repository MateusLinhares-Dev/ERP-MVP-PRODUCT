import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {startFakeRtdb} from './support/fake-rtdb-server.mjs';
import {
  installmentPayableIds,installmentPayables,installmentSignature,isInstallmentPayableId,normalizeInstallments
} from '../server/modules/purchases/domain/installments.ts';

const today='2026-11-08';
const identity={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canPurchasing:true,canAdvances:true,canPayables:true,canFinance:true,canBanking:true};
const context={balanceCents:100_000,purchaseDate:'2026-11-08',defaultDueDate:'2026-11-08'};
const rejects=(fn,code)=>assert.throws(fn,error=>error.code===code);

test('parcelas: sem parcelas informadas vira uma parcela única com o saldo inteiro',()=>{
  assert.deepEqual(normalizeInstallments(undefined,{...context,defaultDueDate:'2026-12-08'}),
    [{numero:1,dias:30,vencimento:'2026-12-08',valor:1000,forma:'',obs:''}]);
  assert.deepEqual(normalizeInstallments([],context).length,1);
  assert.deepEqual(normalizeInstallments([{vencimento:'2026-12-08',valor:1}],{...context,balanceCents:0}),[]);
});

test('parcelas: a última é sempre o saldo restante, como no Bling',()=>{
  const rows=normalizeInstallments([
    {vencimento:'2026-11-08',valor:500,forma:'ted',obs:' NF   4521 '},
    {vencimento:'2026-12-08',valor:300.25,forma:'TED'},
    {vencimento:'2027-01-07',valor:1,forma:'PIX'}
  ],context);
  assert.deepEqual(rows.map(row=>[row.numero,row.dias,row.vencimento,row.valor,row.forma,row.obs]),[
    [1,0,'2026-11-08',500,'TED','NF 4521'],
    [2,30,'2026-12-08',300.25,'TED',''],
    [3,60,'2027-01-07',199.75,'PIX','']
  ]);
  assert.equal(normalizeInstallments([{vencimento:'2026-11-20',valor:5}],context)[0].valor,1000);
});

test('parcelas: recusa soma acima do saldo, data antes da compra, forma desconhecida e excesso de parcelas',()=>{
  rejects(()=>normalizeInstallments([{vencimento:'2026-11-08',valor:600},{vencimento:'2026-12-08',valor:400},{vencimento:'2027-01-08'}],context),'INSTALLMENTS_TOTAL_MISMATCH');
  assert.equal(normalizeInstallments([{vencimento:'2026-11-07',valor:10},{vencimento:'2026-12-08'}],context)[0].dias,-1,'pedido antigo com vencimento anterior à compra continua editável');
  rejects(()=>normalizeInstallments([{vencimento:'2026-13-01',valor:10},{vencimento:'2026-12-08'}],context),'INVALID_INSTALLMENT_DATE');
  rejects(()=>normalizeInstallments([{vencimento:'2026-11-09',valor:10,forma:'Bitcoin'},{vencimento:'2026-12-08'}],context),'INVALID_INSTALLMENT_FORM');
  rejects(()=>normalizeInstallments([{vencimento:'2026-11-09',valor:0},{vencimento:'2026-12-08'}],context),'INVALID_INSTALLMENT_VALUE');
  rejects(()=>normalizeInstallments([{vencimento:'2026-11-09',valor:10.005},{vencimento:'2026-12-08'}],context),'INVALID_INSTALLMENT_VALUE');
  rejects(()=>normalizeInstallments(Array.from({length:37},()=>({vencimento:'2026-12-08',valor:1})),context),'TOO_MANY_INSTALLMENTS');
  rejects(()=>normalizeInstallments({vencimento:'2026-12-08'},context),'INVALID_INSTALLMENTS');
});

test('parcelas: cada parcela vira uma conta a pagar separada',()=>{
  assert.deepEqual(installmentPayableIds('T900',1),['CPPO_T900']);
  assert.deepEqual(installmentPayableIds('T900',3),['CPPO_T900-1','CPPO_T900-2','CPPO_T900-3']);
  assert.equal(isInstallmentPayableId('T900','CPPO_T900-2'),true);
  assert.equal(isInstallmentPayableId('T900','CPPO_T9000-2'),false);
  const installments=normalizeInstallments([{vencimento:'2026-11-08',valor:400,forma:'TED',obs:'NF 77'},{vencimento:'2026-12-08'}],context);
  const payables=installmentPayables({ticketNo:'T900',supplierCode:'F1',supplierName:'JOAO',descriptionName:'JOAO',purchaseDate:'2026-11-08',installments});
  assert.deepEqual(payables.map(row=>[row.id,row.desc,row.venc,row.valor,row.status,row.formaPrevista,row.parcela,row.parcelas,row.obs]),[
    ['CPPO_T900-1','Compra de Sucata — JOAO — T900 — parcela 1/2','08/11/2026',400,'Pendente','TED',1,2,'NF 77'],
    ['CPPO_T900-2','Compra de Sucata — JOAO — T900 — parcela 2/2','08/12/2026',600,'Pendente',undefined,2,2,'Gerado automaticamente — Pedido T900']
  ]);
  const single=installmentPayables({ticketNo:'T901',supplierCode:'F1',supplierName:'JOAO',descriptionName:'JOAO',purchaseDate:'2026-11-08',
    installments:normalizeInstallments(null,context)});
  assert.equal(single[0].id,'CPPO_T901');
  assert.equal(single[0].desc,'Compra de Sucata — JOAO — T901');
  assert.equal('parcela' in single[0],false);
  assert.notEqual(installmentSignature(installments),installmentSignature(normalizeInstallments(null,context)));
});

let srv,db,app,mod={};
const viaSdk=async path=>(await db.ref(path).get()).val();
const lockPaths=()=>['erpFinancePayableTicketLocks','erpFinanceAdvanceLocks','erpFinancePayableLocks']
  .flatMap(root=>Object.keys(srv.read(root)||{}).map(key=>root+'/'+key));
const baseData=()=>({erp:{
  fornecedores:{f1:{cod:'F1',nome:'TESTE NAO APAGAR',ativo:true},f2:{cod:'F2',nome:'FORNECEDOR CERTO',ativo:true},f9:{cod:'F9',nome:'INATIVO',ativo:false}},
  bancos:{b1:{cod:'B1',banco:'Conta Principal'}},
  tickets:{},contasPagar:{},adiantamentos:{},_ts:1
}});
function purchaseTicket(no,qty,price,parcelas){
  const total=Math.round(qty*price*100)/100;
  return {ticket:no,fornecedorCod:'F1',fornecedor:'TESTE NAO APAGAR',fornecedorNome:'TESTE NAO APAGAR',
    itens:[{mat:'COBRE',pesoLiq:qty,quantidade:qty,preco:price,total}],totalProdutos:total,totalGeral:total,
    descontoCompra:0,freteCompra:0,dataCompra:today,vencimentoSaldo:today,status:'Pendente',_consolidado:true,
    _purchaseOperationId:'x',...(parcelas?{parcelas}:{})};
}
const create=(ticket,advanceCodes=[])=>mod.createPurchaseOrder(identity,{operationId:randomUUID(),ticketNo:ticket.ticket,fornecedorCod:'F1',
  ticket,advanceCodes,chequeIds:[],useLegacyCredit:false,sourceTicketKeys:[]},{db});
async function edit(ticketNo,change){
  const expectedTicket=await viaSdk('erp/tickets/'+ticketNo);
  const next=structuredClone(expectedTicket);
  change(next);
  return mod.editPurchaseOrder(identity,{operationId:randomUUID(),ticketNo,expectedTicket,ticket:next},{db});
}
const setPrice=(next,qty,price)=>{
  const total=Math.round(qty*price*100)/100;
  next.itens[0].preco=price;next.itens[0].total=total;next.totalProdutos=total;next.totalGeral=total;
};
const payables=ticketNo=>Object.values(srv.read('erp/contasPagar')||{}).filter(row=>row.ticket===ticketNo)
  .sort((a,b)=>a.id.localeCompare(b.id)).map(row=>[row.id,row.valor,row.venc,row.status]);

before(async()=>{
  srv=await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS='true';
  process.env.FIREBASE_PROJECT_ID='demo-erp-test';
  process.env.FIREBASE_DATABASE_URL=srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST=srv.host;
  process.env.FIREBASE_STORAGE_BUCKET='demo-erp-test.appspot.com';
  delete process.env.APP_ENV;delete process.env.VERCEL_ENV;
  const admin=await import('../server/shared/firebase/firebase-admin.js');
  ({app,db}=admin.getFirebaseAdmin());
  mod={
    ...(await import('../server/modules/purchases/application/create-purchase-order.js')),
    ...(await import('../server/modules/purchases/application/edit-purchase-order.js')),
    ...(await import('../server/modules/purchases/application/delete-purchase-order.js')),
    ...(await import('../server/modules/advances/application/advances.js')),
    ...(await import('../server/modules/payables/application/payables.js'))
  };
});
after(async()=>{
  try{await app?.delete();}catch{}
  await srv?.close();
});

const plan=[
  {vencimento:'2026-11-08',valor:2000,forma:'TED',obs:'NF 4521'},
  {vencimento:'2026-12-08',valor:3000,forma:'TED'},
  {vencimento:'2027-01-07',valor:0,forma:'PIX'}
];

test('compra com 3 parcelas gera 3 contas a pagar; Elaine paga cada uma separadamente',async()=>{
  srv.reset(baseData());
  const created=await create(purchaseTicket('T500',100,100,plan));
  assert.deepEqual(created.payables.map(row=>row.id),['CPPO_T500-1','CPPO_T500-2','CPPO_T500-3']);
  assert.equal(created.payable.id,'CPPO_T500-1');
  assert.deepEqual(payables('T500'),[
    ['CPPO_T500-1',2000,'08/11/2026','Pendente'],['CPPO_T500-2',3000,'08/12/2026','Pendente'],['CPPO_T500-3',5000,'07/01/2027','Pendente']
  ]);
  const ticket=await viaSdk('erp/tickets/T500');
  assert.equal(ticket.vencimentoSaldo,'2026-11-08');
  assert.deepEqual(ticket.parcelas.map(row=>[row.valor,row.forma,row.obs,row.dias]),[[2000,'TED','NF 4521',0],[3000,'TED','',30],[5000,'PIX','',60]]);
  assert.equal(srv.read('erp/contasPagar/CPPO_T500-1').formaPrevista,'TED');
  assert.equal(srv.read('erp/contasPagar/CPPO_T500-3').desc,'Compra de Sucata — TESTE NAO APAGAR — T500 — parcela 3/3');
  assert.deepEqual(lockPaths(),[]);

  const paid=await mod.payPayable(identity,{payableId:'CPPO_T500-1',operationId:randomUUID(),bankCode:'B1',date:today,amount:2000,
    expected:{valor:2000,status:'Pendente',paymentsCount:0}},{db});
  assert.equal(paid.payable.status,'Pago');
  assert.equal(srv.read('erp/tickets/T500').saldoPagar,8000);
  assert.equal(srv.read('erp/tickets/T500').status,'Parcial');
  const inspected=await mod.inspectPayablePayment(identity,{payableId:'CPPO_T500-1'},{db});
  assert.equal(inspected.state,'confirmed');
  assert.equal((await mod.inspectPayablePayment(identity,{payableId:'CPPO_T500-2'},{db})).state,'pending');

  await assert.rejects(edit('T500',next=>setPrice(next,100,90)),{code:'INSTALLMENTS_HAVE_PAYMENTS'});
  await assert.rejects(edit('T500',next=>{next.parcelas=[{vencimento:'2026-11-08',valor:2000},{vencimento:'2026-12-20'}];}),{code:'INSTALLMENTS_HAVE_PAYMENTS'});
  await assert.rejects(mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T500',expectedTotal:10000,expectedSupplier:'F1'},{db}),{code:'PURCHASE_HAS_FINANCE'});
  assert.deepEqual(lockPaths(),[]);

  for(const [id,amount] of [['CPPO_T500-2',3000],['CPPO_T500-3',5000]]){
    await mod.payPayable(identity,{payableId:id,operationId:randomUUID(),bankCode:'B1',date:today,amount,
      expected:{valor:amount,status:'Pendente',paymentsCount:0}},{db});
  }
  assert.equal(srv.read('erp/tickets/T500').saldoPagar,0);
  assert.equal(srv.read('erp/tickets/T500').status,'Pago');
  assert.equal((await mod.inspectPayablePayment(identity,{payableId:'CPPO_T500-3'},{db})).state,'confirmed');
});

test('editar parcelas sem pagamento refaz as contas: 3 → 2 → 1 → 3 e exclusão remove todas',async()=>{
  srv.reset(baseData());
  await create(purchaseTicket('T501',100,100,plan));
  const two=await edit('T501',next=>{setPrice(next,100,120);next.parcelas=[{vencimento:'2026-11-10',valor:4000,forma:'Boleto'},{vencimento:'2026-12-10',valor:0}];});
  assert.deepEqual(two.payables.map(row=>[row.id,row.valor]),[['CPPO_T501-1',4000],['CPPO_T501-2',8000]]);
  assert.deepEqual(two.removedPayableIds,['CPPO_T501-3']);
  assert.deepEqual(payables('T501'),[['CPPO_T501-1',4000,'10/11/2026','Pendente'],['CPPO_T501-2',8000,'10/12/2026','Pendente']]);
  assert.equal(srv.read('erp/tickets/T501').saldoPagar,12000);
  assert.equal(srv.read('erp/tickets/T501').vencimentoSaldo,'2026-11-10');
  assert.equal(srv.read('erp/contasPagarDeleted/CPPO_T501-3'),null);

  const one=await edit('T501',next=>{next.parcelas=[{vencimento:'2026-11-30',valor:1,forma:'PIX'}];});
  assert.deepEqual(one.payables.map(row=>[row.id,row.valor,row.formaPrevista]),[['CPPO_T501',12000,'PIX']]);
  assert.deepEqual(payables('T501'),[['CPPO_T501',12000,'30/11/2026','Pendente']]);

  const three=await edit('T501',next=>{next.parcelas=plan;});
  assert.deepEqual(three.payables.map(row=>[row.id,row.valor]),[['CPPO_T501-1',2000],['CPPO_T501-2',3000],['CPPO_T501-3',7000]]);
  assert.deepEqual(payables('T501').map(row=>row[0]),['CPPO_T501-1','CPPO_T501-2','CPPO_T501-3']);
  assert.deepEqual(lockPaths(),[]);

  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T501',expectedTotal:12000,expectedSupplier:'F1'},{db});
  assert.equal(removed.status,'CONFIRMED');
  assert.deepEqual(removed.deletedPayableIds.sort(),['CPPO_T501-1','CPPO_T501-2','CPPO_T501-3']);
  assert.deepEqual(payables('T501'),[]);
  assert.equal(srv.read('erp/tickets/T501'),null);
  assert.deepEqual(lockPaths(),[]);
});

test('mudar só a data ou a forma da parcela única atualiza a conta a pagar existente',async()=>{
  srv.reset(baseData());
  await create(purchaseTicket('T502',10,50));
  assert.deepEqual(payables('T502'),[['CPPO_T502',500,'08/11/2026','Pendente']]);
  const result=await edit('T502',next=>{next.parcelas=[{vencimento:'2026-11-25',valor:500,forma:'TED',obs:'NF 9'}];next.vencimentoSaldo='2026-11-25';});
  assert.equal(result.payable.id,'CPPO_T502');
  assert.equal(result.payable.venc,'25/11/2026');
  assert.equal(result.payable.formaPrevista,'TED');
  assert.deepEqual(payables('T502'),[['CPPO_T502',500,'25/11/2026','Pendente']]);
  assert.equal(srv.read('erp/tickets/T502').parcelas[0].obs,'NF 9');
  assert.deepEqual(lockPaths(),[]);
});

test('compra parcelada com adiantamento: reduzir abaixo do adiantamento devolve a diferença e apaga as parcelas',async()=>{
  srv.reset(baseData());
  const advance=await mod.createAdvance(identity,{fornCod:'F1',data:today,valor:150,forma:'PIX',bancoCod:'B1',empresa:'Manuela',ticket:'',obs:'',operationId:randomUUID()},{db});
  const created=await create(purchaseTicket('T503',3,100,[{vencimento:'2026-11-20',valor:100},{vencimento:'2026-12-20',valor:0}]),[advance.advance.cod]);
  assert.deepEqual(created.payables.map(row=>[row.id,row.valor]),[['CPPO_T503-1',100],['CPPO_T503-2',50]]);
  const reduced=await edit('T503',next=>{setPrice(next,3,40);next.parcelas=[];});
  assert.equal(reduced.advanceRefund.valor,30);
  assert.deepEqual(reduced.removedPayableIds.sort(),['CPPO_T503-1','CPPO_T503-2']);
  assert.deepEqual(payables('T503'),[]);
  const ticket=srv.read('erp/tickets/T503');
  assert.equal(ticket.saldoPagar,0);assert.equal(ticket.status,'Pago');assert.equal(ticket.adiantamento,120);
  assert.equal('parcelas' in ticket,false);
  const ledger=Object.values(srv.read('erp/adiantamentos/F1')||{}).find(row=>row.cod===advance.advance.cod);
  assert.equal(ledger.valorDisponivel,30);assert.equal(ledger.status,'Pendente');
  assert.deepEqual(lockPaths(),[]);
});

test('compra já quitada não aceita dividir a diferença em parcelas',async()=>{
  srv.reset(baseData());
  await create(purchaseTicket('T504',10,50));
  await mod.payPayable(identity,{payableId:'CPPO_T504',operationId:randomUUID(),bankCode:'B1',date:today,amount:500,
    expected:{valor:500,status:'Pendente',paymentsCount:0}},{db});
  await assert.rejects(edit('T504',next=>{setPrice(next,10,60);next.parcelas=[{vencimento:'2026-11-20',valor:50},{vencimento:'2026-12-20',valor:0}];}),
    {code:'INSTALLMENTS_AFTER_PAYMENT'});
  assert.deepEqual(lockPaths(),[]);
});

const changeSupplier=(next,code,name)=>{next.fornecedorCod=code;next.fornecedor=name;next.fornecedorNome=name;};

test('trocar o fornecedor mantém o número do pedido e refaz as contas no nome do novo fornecedor',async()=>{
  srv.reset(baseData());
  await create(purchaseTicket('T510',100,100,[{vencimento:'2026-11-20',valor:4000,forma:'TED'},{vencimento:'2026-11-20',valor:0}]));
  const edited=await edit('T510',next=>changeSupplier(next,'F2','FORNECEDOR CERTO'));
  assert.equal(edited.ticket.ticket,'T510');
  assert.equal(edited.ticket.fornecedorCod,'F2');
  assert.equal(edited.ticket.fornecedor,'FORNECEDOR CERTO');
  const rows=Object.values(srv.read('erp/contasPagar')).filter(row=>row.ticket==='T510').sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(rows.map(row=>[row.id,row.fornCod,row.cred,row.valor,row.formaPrevista||'']),[
    ['CPPO_T510-1','F2','FORNECEDOR CERTO',4000,'TED'],['CPPO_T510-2','F2','FORNECEDOR CERTO',6000,'']
  ]);
  assert.match(rows[0].desc,/FORNECEDOR CERTO — T510 — parcela 1\/2/);
  const removed=await mod.deletePurchaseOrder(identity,{operationId:randomUUID(),ticketNo:'T510',expectedTotal:10000,expectedSupplier:'F2'},{db});
  assert.equal(removed.status,'CONFIRMED');
  assert.deepEqual(lockPaths(),[]);

  await create(purchaseTicket('T511',10,50));
  const single=await edit('T511',next=>changeSupplier(next,'F2','FORNECEDOR CERTO'));
  assert.equal(single.payable.id,'CPPO_T511');
  assert.equal(srv.read('erp/contasPagar/CPPO_T511').fornCod,'F2');
  assert.equal(srv.read('erp/contasPagar/CPPO_T511').valor,500);
  assert.deepEqual(lockPaths(),[]);
});

test('não troca fornecedor de compra com adiantamento, com pagamento ou para fornecedor inativo',async()=>{
  srv.reset(baseData());
  const advance=await mod.createAdvance(identity,{fornCod:'F1',data:today,valor:100,forma:'PIX',bancoCod:'B1',empresa:'Manuela',ticket:'',obs:'',operationId:randomUUID()},{db});
  await create(purchaseTicket('T520',3,100),[advance.advance.cod]);
  await assert.rejects(edit('T520',next=>changeSupplier(next,'F2','FORNECEDOR CERTO')),{code:'SUPPLIER_CHANGE_BLOCKED'});
  await create(purchaseTicket('T521',10,50));
  await mod.payPayable(identity,{payableId:'CPPO_T521',operationId:randomUUID(),bankCode:'B1',date:today,amount:100,
    expected:{valor:500,status:'Pendente',paymentsCount:0}},{db});
  await assert.rejects(edit('T521',next=>changeSupplier(next,'F2','FORNECEDOR CERTO')),{code:'SUPPLIER_CHANGE_BLOCKED'});
  await create(purchaseTicket('T522',10,50));
  await assert.rejects(edit('T522',next=>changeSupplier(next,'F9','INATIVO')),{code:'SUPPLIER_NOT_FOUND'});
  await assert.rejects(edit('T522',next=>changeSupplier(next,'F404','NAO EXISTE')),{code:'SUPPLIER_NOT_FOUND'});
  assert.equal(srv.read('erp/tickets/T522').fornecedorCod,'F1');
  assert.deepEqual(lockPaths(),[]);
});

const ui=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
function uiHelpers(){
  const start=ui.indexOf('const INSTALLMENT_FORMS=');
  const end=ui.indexOf('function installmentFormOptions(',start);
  assert.ok(start>0&&end>start);
  const ctx={document:{getElementById:()=>null},
    today:()=> '2026-11-08',money:n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
  runInNewContext(ui.slice(start,end)+';this.api={parsePaymentCondition,generateInstallments,balanceInstallments,validateInstallments,installmentPayload,syncInstallments,addDaysISO};',ctx);
  return ctx.api;
}

test('tela: condição de pagamento entende "30 60 90", "3x", "à vista" e recusa texto inválido',()=>{
  const api=uiHelpers();
  const plain=value=>JSON.parse(JSON.stringify(api.parsePaymentCondition(value)));
  assert.deepEqual(plain('30 60 90'),{days:[30,60,90]});
  assert.deepEqual(plain('0/30/60'),{days:[0,30,60]});
  assert.deepEqual(plain('3x'),{count:3});
  assert.deepEqual(plain('5 parcelas'),{count:5});
  assert.deepEqual(plain('à vista'),{days:[0]});
  assert.deepEqual(plain('28 dias'),{days:[28]});
  assert.equal(api.parsePaymentCondition('abc'),null);
  assert.equal(api.parsePaymentCondition('40x'),null);
  assert.equal(api.parsePaymentCondition(''),null);
});

test('tela: gerar parcelas divide o saldo e a última fecha o total; editar uma recalcula a última',()=>{
  const api=uiHelpers();
  const sameDay=JSON.parse(JSON.stringify(api.generateInstallments({count:3},1000,'2026-11-08',[],'2026-11-20')));
  assert.deepEqual(sameDay.map(row=>row.date),['2026-11-20','2026-11-20','2026-11-20'],'3x: todas no mesmo dia');
  assert.deepEqual(sameDay.map(row=>row.value),[333.33,333.33,333.34]);
  const rows=api.generateInstallments({days:[0,30,60]},1000,'2026-11-08',[{form:'TED',obs:'NF 1'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)),[
    {date:'2026-11-08',value:333.33,form:'TED',obs:'NF 1'},{date:'2026-12-08',value:333.33,form:'TED',obs:''},{date:'2027-01-07',value:333.34,form:'TED',obs:''}
  ]);
  rows[0].value=500;
  api.balanceInstallments(rows,1000);
  assert.equal(rows[2].value,166.67);
  const state={purchaseDate:'2026-11-08',installments:rows};
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateInstallments(state,1000))),[
    {vencimento:'2026-11-08',valor:500,forma:'TED',obs:'NF 1'},{vencimento:'2026-12-08',valor:333.33,forma:'TED',obs:''},{vencimento:'2027-01-07',valor:166.67,forma:'TED',obs:''}
  ]);
  rows[0].value=900;api.balanceInstallments(rows,1000);
  assert.throws(()=>api.validateInstallments(state,1000),/passa do saldo a pagar/);
  assert.equal(api.validateInstallments({purchaseDate:'2026-11-09',installments:[{date:'2026-11-08',value:1000}]},1000)[0].vencimento,'2026-11-08');
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateInstallments({purchaseDate:'2026-11-08',installments:[]},0))),[]);
});

test('tela: sem parcelas cria a parcela única com o saldo e mantém o vencimento no campo antigo',()=>{
  const hidden={value:''};
  const start=ui.indexOf('const INSTALLMENT_FORMS=');
  const end=ui.indexOf('function installmentFormOptions(',start);
  const ctx={document:{getElementById:id=>id==='cs-lanc-venc'?hidden:null},today:()=> '2026-11-08',money:String};
  runInNewContext(ui.slice(start,end)+';this.syncInstallments=syncInstallments;',ctx);
  const state={dueDate:'2026-11-20',installments:[]};
  ctx.syncInstallments(state,750);
  assert.deepEqual(JSON.parse(JSON.stringify(state.installments)),[{date:'2026-11-20',value:750,form:'',obs:''}]);
  assert.equal(hidden.value,'2026-11-20');
  state.installments[0].date='2026-11-25';
  ctx.syncInstallments(state,800);
  assert.equal(state.installments[0].value,800);
  assert.equal(hidden.value,'2026-11-25');
  const locked={dueDate:'2026-11-20',installments:[{date:'2026-11-20',value:100}],installmentsLocked:true};
  ctx.syncInstallments(locked,900);
  assert.equal(locked.installments[0].value,100);
});

function printHtml(ticket,payables=[]){
  let html='';
  const ctx={
    document:{addEventListener(){},getElementById(){return null;}},
    setTimeout(){return 0;},clearTimeout(){},getFornAtivos(){return [];},
    FORNECEDORES:[{cod:'F1',nome:'Fornecedor de teste'}],TICKETS_DB:{TK:ticket},CONTAS_PAGAR:payables,ADT_POR_FORN:{},CHEQUES_POR_FORN:{},
    _empresaPrincipalLabel(){return 'Manuela Metais';},_empresaPrincipalRazao(){return 'Manuela Metais LTDA';},_empresaPrincipalInfo(){return {};},
    window:{location:{href:'https://erp.exemplo.com/app'},open(){return {document:{write(value){html+=value;},close(){}}};}}
  };
  ctx.window.window=ctx.window;
  runInNewContext(ui,ctx);
  ctx.window.phase4PurchasePrint('TK');
  return html;
}
const sectionRows=(html,title)=>{
  const start=html.indexOf('<h2>'+title+'</h2>');
  const section=html.slice(start,html.indexOf('</section>',start));
  return [...section.matchAll(/<tr><td[^>]*>([\s\S]*?)<\/td><\/tr>/g)]
    .map(match=>match[1].split(/<\/td><td[^>]*>/).map(cell=>cell.replace(/<[^>]+>/g,'').trim()));
};

test('notinha lista as parcelas com dias, vencimento, valor, forma e observação',()=>{
  const ticket={ticket:'T600',fornecedor:'Fornecedor de teste',fornecedorCod:'F1',dataCompra:'2026-11-08',vencimentoSaldo:'2026-11-08',
    itens:[{mat:'COBRE',quantidade:100,preco:100}],totalProdutos:10000,totalGeral:10000,adiantamento:0,saldoPagar:8000,
    parcelas:[{vencimento:'2026-11-08',valor:2000,forma:'TED',obs:'NF 4521'},{vencimento:'2026-12-08',valor:3000,forma:'TED',obs:''},{vencimento:'2027-01-07',valor:5000,forma:'',obs:''}]};
  const html=printHtml(ticket,[{id:'CPPO_T600-1',ticket:'T600',valor:2000,status:'Pago',pagamentos:[{data:'08/11/2026',valor:2000}]},
    {id:'CPPO_T600-2',ticket:'T600',valor:3000,status:'Pendente'},{id:'CPPO_T600-3',ticket:'T600',valor:5000,status:'Pendente'}]);
  assert.match(html,/<th>Dias<\/th><th>Data Vencimento<\/th><th>Valor<\/th><th>Forma<\/th><th>Observações<\/th>/);
  assert.deepEqual(sectionRows(html,'Parcelas'),[
    ['0','08/11/2026','R$ 2.000,00','TED','NF 4521 · Paga'],
    ['30','08/12/2026','R$ 3.000,00','TED','—'],
    ['60','07/01/2027','R$ 5.000,00','—','—']
  ]);
});

test('notinha não mostra códigos internos de adiantamento; cheque aparece pelo número',()=>{
  const ticket={ticket:'T601',fornecedor:'Fornecedor de teste',fornecedorCod:'F1',dataCompra:'2026-11-08',vencimentoSaldo:'2026-11-08',
    itens:[{mat:'COBRE',quantidade:10,preco:100}],totalProdutos:1000,totalGeral:1000,adiantamento:1000,saldoPagar:0,
    reciboFinanceiro:{versao:2,total:1000,adiantamentos:[{cod:'ADTMW9KNLL7E91539D1',data:'2026-11-01',forma:'PIX',valorOriginal:20010.25,valorAplicado:600,valorPendente:19410.25}],
      cheques:[{id:'CHQ-INTERNO-1',num:'000123',bomPara:'2026-11-05',valorOriginal:400,valorAplicado:400}]}};
  const html=printHtml(ticket);
  assert.doesNotMatch(html,/ADTMW9KNLL7E91539D1|CHQ-INTERNO-1/);
  assert.match(html,/<th>Data<\/th><th>Origem<\/th><th>Forma<\/th><th>Valor do adiantamento<\/th><th>Valor aplicado<\/th>/);
  assert.deepEqual(sectionRows(html,'Adiantamentos e abatimentos desta compra'),[
    ['01/11/2026','Adiantamento','PIX','R$ 20.010,25','R$ 600,00'],['05/11/2026','Cheque','Cheque nº 000123','R$ 400,00','R$ 400,00']
  ]);
});

test('histórico: botão de baixa abre a próxima parcela em aberto da compra',()=>{
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  const start=core.indexOf('function abrirBaixaCompraNoFinanceiro(');
  const source=core.slice(start,core.indexOf('function marcarCompraPaga(',start));
  const calls=[],messages=[];
  const env={CONTAS_PAGAR:[
    {id:'CPPO_T700-1',ticket:'T700',valor:100,status:'Pago',parcela:1,parcelas:3},
    {id:'CPPO_T700-3',ticket:'T700',valor:300,status:'Pendente',parcela:3,parcelas:3},
    {id:'CPPO_T700-2',ticket:'T700',valor:200,status:'Pendente',parcela:2,parcelas:3}
  ],pagarContaRapido:(idx,id)=>calls.push({idx,id}),showToast:message=>messages.push(message)};
  runInNewContext(source+';abrirBaixaCompraNoFinanceiro("T700");',env);
  assert.deepEqual(calls,[{idx:2,id:'CPPO_T700-2'}]);
  assert.match(messages[0],/parcela 2\/3/);
});
