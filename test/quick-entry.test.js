// Lançamento rápido (celular/voz): SDK oficial do Firebase contra o RTDB simulado.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {startFakeRtdb} from './support/fake-rtdb-server.mjs';

let srv,db,app,mod={};
const owner={uid:'erp:mauro',erpUser:'mauro',erpAccess:true,canQuickEntry:true};
const admin={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,admin:true,canPurchasing:true,canPayables:true,canFinance:true};
const stranger={uid:'erp:ana',erpUser:'ana',erpAccess:true,canPurchasing:true};
const today='2026-11-08';
const now=()=>Date.parse(today+'T15:00:00Z');
let seq=0;
const opId=()=>'00000000-0000-4000-8000-'+String(++seq).padStart(12,'0');
const viaSdk=async path=>(await db.ref(path).get()).val();
const keysFromDb=async(database,path)=>Object.keys((await database.ref(path).get()).val()||{});

function baseData(extra={}){
  return {erp:{
    fornecedores:{f1:{cod:'F1',nome:'JOÃO SILVA SUCATAS',ativo:true},f2:{cod:'F2',nome:'FORNECEDOR INATIVO',ativo:false},f3:{cod:'F3',nome:'APAGADO'}},
    fornDeleted:{F3:true},
    clientes:{c1:{id:'c1',cod:'C001',nome:'GERDAU AÇOS LONGOS'},c2:{id:'c2',cod:'C002',nome:'CLIENTE EXCLUÍDO'}},
    clientesDeleted:['c2'],
    metais:['COBRE MEL','LATÃO','FERRO'],
    precosForn:{F1:{'COBRE MEL':42,_datas:{'COBRE MEL':'01/11/2026'}}},
    precosCli:{'GERDAU AÇOS LONGOS':{FERRO:1.2}},
    tickets:{T009:{ticket:'T009',fornecedorCod:'F1',status:'Pago',totalGeral:10}},
    ticketsDeletedV2:{T010:true},
    bancos:{b1:{cod:'B1',banco:'Conta Principal'}},
    _ts:1,...extra
  }};
}
function fakeBucket(){
  const files=new Map();
  return {files,file(path){return {
    async save(buffer,options){files.set(path,{buffer:Buffer.from(buffer),options});},
    async download(){if(!files.has(path))throw new Error('not found');return [files.get(path).buffer];}
  };}};
}
const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,74,70,73,70,0,1]);

before(async()=>{
  srv=await startFakeRtdb({namespace:'demo-quick-test'});
  process.env.USE_FIREBASE_EMULATORS='true';
  process.env.FIREBASE_PROJECT_ID='demo-quick-test';
  process.env.FIREBASE_DATABASE_URL=srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST=srv.host;
  process.env.FIREBASE_STORAGE_BUCKET='demo-quick-test.appspot.com';
  delete process.env.APP_ENV;delete process.env.VERCEL_ENV;delete process.env.ANTHROPIC_API_KEY;
  const firebase=await import('../server/infrastructure/firebase-admin.js');
  ({app,db}=firebase.getFirebaseAdmin());
  mod={...(await import('../server/application/quick-entry.js')),
    ...(await import('../server/application/quick-interpret.js')),
    ...(await import('../server/application/purchase-order-delete.js')),
    ...(await import('../server/application/finance-payment.js'))};
});
after(async()=>{try{await app?.delete();}catch{}await srv?.close();});

test('permissão: claim canQuickEntry vem da aba "lancamento_rapido" (admin sempre tem)',async()=>{
  const {buildSecurityClaims}=await import('../server/domain/access.js');
  assert.equal(buildSecurityClaims({tabs:['lancamento_rapido']}).canQuickEntry,true);
  assert.equal(buildSecurityClaims({tabs:['vendas']}).canQuickEntry,false);
  assert.equal(buildSecurityClaims({tabs:[]},{admin:true}).canQuickEntry,true);
  await assert.rejects(()=>mod.quickEntryOptions(stranger,{db}),{code:'QUICK_ENTRY_FORBIDDEN'});
});

test('opções: só fornecedores/clientes ativos, materiais e tabelas de preço',async()=>{
  srv.reset(baseData());
  const r=await mod.quickEntryOptions(owner,{db,now,env:{}});
  assert.deepEqual(r.suppliers,[{cod:'F1',nome:'JOÃO SILVA SUCATAS'}]);
  assert.deepEqual(r.customers.map(c=>c.nome),['GERDAU AÇOS LONGOS']);
  assert.deepEqual(r.materials,['COBRE MEL','FERRO','LATÃO']);
  assert.deepEqual(r.supplierPrices,{F1:{'COBRE MEL':42}});
  assert.equal(r.customerPrices['GERDAU AÇOS LONGOS'].FERRO,1.2);
  assert.equal(r.today,today);
  assert.equal(r.aiEnabled,false);
});

test('compra: cria pedido, conta a pagar e registro; número pula excluídos; repetir não duplica',async()=>{
  srv.reset(baseData());
  const input={operationId:opId(),fornecedorCod:'F1',data:today,vencimento:'2026-11-20',observacao:'placa ABC',
    textoFalado:'comprei 350 quilos de cobre mel do joão a 42',itens:[{material:'cobre mel',quantidadeKg:350,precoKg:42}]};
  const r=await mod.createQuickPurchase(owner,input,{db,now,listKeys:keysFromDb});
  assert.equal(r.entry.referencia,'T011','T009 existe e T010 foi excluído');
  const ticket=await viaSdk('erp/tickets/T011');
  assert.equal(ticket.fornecedorCod,'F1');
  assert.equal(ticket.totalGeral,14700);
  assert.equal(ticket.saldoPagar,14700);
  assert.equal(ticket.status,'Pendente');
  assert.equal(ticket.itens[0].mat,'COBRE MEL');
  assert.equal(ticket.origemLancamento,'celular');
  assert.equal(ticket._consolidado,true);
  const payable=await viaSdk('erp/contasPagar/CPPO_T011');
  assert.equal(payable.valor,14700);
  assert.equal(payable.venc,'20/11/2026');
  assert.equal(payable.status,'Pendente');
  const entry=await viaSdk('erp/quickEntries/erp_mauro_'+input.operationId);
  assert.equal(entry.tipo,'compra');assert.equal(entry.criadoPor,'mauro');assert.equal(entry.contaPagar,'CPPO_T011');
  assert.equal(srv.read('erpQuickLocks'),null,'trava do lançamento liberada');
  assert.equal(srv.read('erpFinancePayableTicketLocks'),null,'trava da compra liberada');
  const again=await mod.createQuickPurchase(owner,input,{db,now,listKeys:keysFromDb});
  assert.equal(again.alreadyCommitted,true);
  assert.equal(Object.keys(await viaSdk('erp/tickets')).length,2,'nenhum pedido duplicado');
  // Compatível com o ERP: a compra sem baixa pode ser excluída pelo fluxo normal.
  const removed=await mod.deletePurchaseOrder({...admin},{ticketNo:'T011',operationId:opId()},{db,now});
  assert.equal(removed.status,'CONFIRMED');
});

test('compra: número tomado no meio do caminho é renovado (TICKET_EXISTS)',async()=>{
  srv.reset(baseData());
  const stale=async()=>['T009'];
  srv.seed('erp/tickets/T010',{ticket:'T010',fornecedorCod:'F1',status:'Pendente',totalGeral:5});
  srv.seed('erp/ticketsDeletedV2/T010',null);
  const r=await mod.createQuickPurchase(owner,{operationId:opId(),fornecedorCod:'F1',itens:[{material:'FERRO',quantidadeKg:100,precoKg:0.9}]},
    {db,now,listKeys:stale});
  assert.equal(r.entry.referencia,'T011');
  assert.equal((await viaSdk('erp/tickets/T010')).totalGeral,5,'pedido do outro usuário intacto');
});

test('compra paga pelo fluxo normal de Contas a Pagar e aparece como "Pago" no histórico',async()=>{
  srv.reset(baseData());
  const r=await mod.createQuickPurchase(owner,{operationId:opId(),fornecedorCod:'F1',itens:[{material:'LATÃO',quantidadeKg:10,precoKg:30}]},
    {db,now,listKeys:keysFromDb});
  await mod.payPayable({...admin},{payableId:'CPPO_'+r.entry.referencia,operationId:opId(),bankCode:'B1',date:today,amount:300,
    expected:{valor:300,status:'Pendente',paymentsCount:0}},{db,now});
  const list=await mod.listQuickEntries(owner,{db});
  assert.equal(list.entries[0].situacao,'Pago');
});

test('compra: validações em linguagem simples, sem gravar nada',async()=>{
  srv.reset(baseData());
  const base={fornecedorCod:'F1',itens:[{material:'COBRE MEL',quantidadeKg:10,precoKg:42}]};
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...base,operationId:opId(),fornecedorCod:'F2'},{db,now}),{code:'SUPPLIER_NOT_FOUND'});
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...base,operationId:opId(),itens:[{material:'OURO',quantidadeKg:1,precoKg:1}]},{db,now}),{code:'UNKNOWN_MATERIAL'});
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...base,operationId:opId(),itens:[{material:'FERRO',quantidadeKg:10,precoKg:null}]},{db,now}),{code:'INVALID_PRICE',message:/preço por kg da linha 1/});
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...base,operationId:opId(),data:'2026-11-10',vencimento:'2026-11-09'},{db,now}),{code:'INVALID_DUE_DATE'});
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...base,operationId:'nao-e-uuid'},{db,now}),{code:'INVALID_OPERATION'});
  assert.equal(srv.read('erp/quickEntries'),null);
  assert.deepEqual(Object.keys(await viaSdk('erp/tickets')),['T009']);
});

test('venda: venda + conta a receber + registro em um único commit; repetir não duplica',async()=>{
  srv.reset(baseData());
  const input={operationId:opId(),cliente:'gerdau aços longos',nf:'4521',vencimento:'2026-11-20',
    itens:[{material:'FERRO',quantidadeKg:2000,precoKg:1.2},{material:'LATÃO',quantidadeKg:50,precoKg:28.5}]};
  const r=await mod.createQuickSale(owner,input,{db,now});
  const sale=await viaSdk('erp/vendas/'+r.entry.referencia);
  assert.equal(sale.cliente,'GERDAU AÇOS LONGOS');
  assert.equal(sale.total,3825);
  assert.equal(sale.status,'Pendente');
  assert.equal(sale.data,'08/11/2026');
  assert.deepEqual(sale.itens[0],{mat:'FERRO',matBase:'FERRO',ident:'',qt:2000,pr:1.2,total:2400});
  const receivable=await viaSdk('erp/contasReceber/'+r.entry.contaReceber);
  assert.equal(receivable.valor,3825);assert.equal(receivable.vendaId,sale.id);assert.equal(receivable.venc,'20/11/2026');
  const again=await mod.createQuickSale(owner,input,{db,now});
  assert.equal(again.alreadyCommitted,true);
  assert.equal(Object.keys(await viaSdk('erp/vendas')).length,1);
  await assert.rejects(()=>mod.createQuickSale(owner,{...input,operationId:opId(),cliente:'CLIENTE EXCLUÍDO'},{db,now}),{code:'CUSTOMER_NOT_FOUND'});
  await assert.rejects(()=>mod.createQuickPurchase(owner,{...input,fornecedorCod:'F1'},{db,now}),{code:'OPERATION_REUSED'});
});

test('anexos: tipo conferido pelo conteúdo, vinculados ao lançamento e visíveis só ao dono e à administradora',async()=>{
  srv.reset(baseData());
  const bucket=fakeBucket();
  await assert.rejects(()=>mod.uploadQuickAttachment(owner,{nome:'x.pdf',tipo:'application/pdf',conteudo:JPEG.toString('base64')},{db,bucket,now}),{code:'UNSUPPORTED_FILE'});
  const {anexo}=await mod.uploadQuickAttachment(owner,{nome:'ticket.jpg',tipo:'image/jpeg',conteudo:JPEG.toString('base64')},{db,bucket,now});
  assert.equal(bucket.files.size,1);
  const r=await mod.createQuickPurchase(owner,{operationId:opId(),fornecedorCod:'F1',anexos:[anexo.id],
    itens:[{material:'FERRO',quantidadeKg:10,precoKg:1}]},{db,now,listKeys:keysFromDb});
  assert.equal((await viaSdk('erp/tickets/'+r.entry.referencia)).anexosCelular[0].id,anexo.id);
  assert.equal((await viaSdk('erp/quickUploads/mauro/'+anexo.id)).lancamento,r.entry.id);
  const file=await mod.readQuickAttachment(owner,{dono:'mauro',id:anexo.id},{db,bucket});
  assert.deepEqual(file.buffer,JPEG);
  await assert.rejects(()=>mod.readQuickAttachment({...owner,uid:'erp:outro',erpUser:'outro'},{dono:'mauro',id:anexo.id},{db,bucket}),{code:'ATTACHMENT_FORBIDDEN'});
  assert.equal((await mod.readQuickAttachment(admin,{dono:'mauro',id:anexo.id},{db,bucket})).tipo,'image/jpeg');
  await assert.rejects(()=>mod.createQuickPurchase(owner,{operationId:opId(),fornecedorCod:'F1',anexos:['AXinexistente'],
    itens:[{material:'FERRO',quantidadeKg:10,precoKg:1}]},{db,now}),{code:'ATTACHMENT_NOT_FOUND'});
});

test('histórico: cada um vê os seus; administradora vê todos',async()=>{
  srv.reset(baseData());
  await mod.createQuickSale(owner,{operationId:opId(),cliente:'GERDAU AÇOS LONGOS',itens:[{material:'FERRO',quantidadeKg:1,precoKg:1}]},{db,now});
  await mod.createQuickSale({...owner,uid:'erp:outro',erpUser:'outro'},{operationId:opId(),cliente:'GERDAU AÇOS LONGOS',itens:[{material:'FERRO',quantidadeKg:2,precoKg:1}]},{db,now});
  assert.equal((await mod.listQuickEntries(owner,{db})).entries.length,1);
  const all=await mod.listQuickEntries(admin,{db});
  assert.equal(all.entries.length,2);assert.equal(all.viewAll,true);
  assert.equal(all.entries[0].situacao,'A receber');
});

test('IA: só aceita nomes do cadastro; sem chave avisa para usar o interpretador do aparelho',async()=>{
  srv.reset(baseData());
  await assert.rejects(()=>mod.interpretQuickText(owner,{texto:'comprei cobre'},{db,now,env:{}}),{code:'AI_NOT_CONFIGURED'});
  let request=null;
  const client={beta:{messages:{create:async body=>{request=body;return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({
    tipo:'compra',parte:'JOÃO SILVA SUCATAS',itens:[{material:'COBRE MEL',materialFalado:'cobre mel',quantidadeKg:350,precoKg:42},
      {material:'OURO INVENTADO',materialFalado:'ouro',quantidadeKg:1,precoKg:-5}],
    data:'2026-11-08',vencimento:'data ruim',nf:null,observacao:null,duvidas:[]})}]};}}}};
  const r=await mod.interpretQuickText(owner,{texto:'comprei 350 quilos de cobre mel do joão a 42',tipo:'compra'},{db,now,client,env:{}});
  assert.equal(request.model,'claude-opus-5-5');
  assert.equal(request.output_config.format.type,'json_schema');
  assert.equal(request.fallbacks,'default');
  assert.match(request.messages[0].content,/<fala>\ncomprei 350/);
  assert.deepEqual(r.parte,{nome:'JOÃO SILVA SUCATAS',cod:'F1'});
  assert.deepEqual(r.itens[0],{material:'COBRE MEL',materialFalado:'cobre mel',quantidadeKg:350,precoKg:42});
  assert.deepEqual(r.itens[1],{material:null,materialFalado:'ouro',quantidadeKg:1,precoKg:null},'material e preço inválidos descartados');
  assert.equal(r.vencimento,null);
  const refusal={beta:{messages:{create:async()=>({stop_reason:'refusal',content:[]})}}};
  await assert.rejects(()=>mod.interpretQuickText(owner,{texto:'x'},{db,now,client:refusal,env:{}}),{code:'AI_UNAVAILABLE'});
  const unknown=mod.sanitizeInterpretation({tipo:'compra',parte:'FULANO QUALQUER',itens:[]},{suppliers:[{cod:'F1',nome:'JOÃO'}],customers:[],materials:[]});
  assert.equal(unknown.parte,null);
  assert.match(unknown.duvidas.join(' '),/FULANO QUALQUER/);
});

test('interpretador do aparelho: frases reais, sem inventar',async()=>{
  const {interpretarFala,palavrasParaNumeros}=await import('../public/rapido/parser.js');
  const ctx={materiais:['COBRE MEL','COBRE MISTO','LATÃO','ALUMÍNIO LATINHA','FERRO','BATERIA'],
    fornecedores:[{cod:'F1',nome:'JOÃO SILVA SUCATAS'},{cod:'F3',nome:'FERRO VELHO DO ZÉ'}],
    clientes:[{cod:'C1',nome:'GERDAU AÇOS LONGOS'},{cod:'C2',nome:'FUNDIÇÃO TUPY'}],hoje:today};
  assert.equal(palavrasParaNumeros('dois mil e quinhentos quilos a quarenta e dois e cinquenta'),'2500 quilos a 42 e 50');
  let r=interpretarFala('Comprei 350 quilos de cobre mel do João a 42 reais o quilo',ctx);
  assert.equal(r.tipo,'compra');assert.equal(r.parte.cod,'F1');
  assert.deepEqual(r.itens,[{material:'COBRE MEL',materialFalado:'cobre mel',quantidadeKg:350,precoKg:42}]);
  r=interpretarFala('Vendi para a Gerdau 2 toneladas de ferro a 1 real e 20 vence dia 20',ctx);
  assert.equal(r.tipo,'venda');assert.equal(r.parte.nome,'GERDAU AÇOS LONGOS');
  assert.deepEqual(r.itens,[{material:'FERRO',materialFalado:'ferro',quantidadeKg:2000,precoKg:1.2}]);
  assert.equal(r.vencimento,'2026-11-20');
  r=interpretarFala('comprei 500 de bateria a 3 reais do ferro velho do zé para 15 dias',ctx);
  assert.equal(r.parte.cod,'F3');assert.equal(r.itens.length,1,'nome do fornecedor e prazo não viram material/peso');
  assert.equal(r.vencimento,'2026-11-23');
  r=interpretarFala('vendi pra tupy meia tonelada de alumínio latinha a 7.200 a tonelada nota 4521',ctx);
  assert.deepEqual(r.itens,[{material:'ALUMÍNIO LATINHA',materialFalado:'aluminio latinha',quantidadeKg:500,precoKg:7.2}]);
  assert.equal(r.nf,'4521');
  r=interpretarFala('comprei cobre 100 kg a 40 do joão',ctx);
  assert.equal(r.itens[0].material,null,'"cobre" é ambíguo: pergunta em vez de chutar');
  assert.match(r.duvidas.join(' '),/COBRE MEL \/ COBRE MISTO/);
  r=interpretarFala('Comprei 350 quilos de cobre mel do João a 42 reais e 80 quilos de latão a 30 o quilo',ctx);
  assert.deepEqual(r.itens.map(i=>[i.material,i.quantidadeKg,i.precoKg]),[['COBRE MEL',350,42],['LATÃO',80,30]],'o peso do 2º item não é engolido pelo preço do 1º');
  r=interpretarFala('comprei 100 kg de cobre mel do joão por 4000 reais',ctx);
  assert.equal(r.itens[0].precoKg,40,'"por R$ 4000" é o TOTAL do item, não R$ 4000 por kg');
  assert.match(r.duvidas.join(' '),/total de R\$ 4\.000 ÷ 100 kg/);
  r=interpretarFala('comprei cobre mel no valor de r$ 225',ctx);
  assert.equal(r.itens[0].precoKg,null,'sem peso não inventa preço por kg');
  assert.match(r.duvidas.join(' '),/valor total de R\$ 225/);
  r=interpretarFala('comprei 100 kg de latão por 30 o quilo',ctx);
  assert.equal(r.itens[0].precoKg,30,'"por 30 o quilo" continua sendo preço por kg');
  r=interpretarFala('vendi 1 tonelada de ferro pra gerdal a 2 reais',{...ctx,tipo:'venda'});
  assert.equal(r.parte?.nome,'GERDAU AÇOS LONGOS','uma letra trocada pelo reconhecimento de voz');
  r=interpretarFala('comprei 10 kg de latão do joão a 30',{...ctx,tipo:'venda'});
  assert.equal(r.tipoFalado,'compra','a tela troca sozinha para COMPRA');
  r=interpretarFala('comprei 100 quilos de latão',ctx);
  assert.equal(r.parte,null);assert.equal(r.itens[0].precoKg,null,'preço não dito fica vazio');
});

test('ERP: perfil só com "Lançamento rápido" abre direto a tela do celular; ?completo=1 abre o ERP',()=>{
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  const start=core.indexOf('const _TABS_BASICAS_RAPIDO='),end=core.indexOf('window.erpDestinoRapido=',start);
  const run=(perfil,search='')=>{
    const store=new Map();
    const ctx={location:{search},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}};
    runInNewContext(core.slice(start,end)+';this.decide=_erpDeveAbrirRapido;',ctx);
    return ctx.decide(perfil);
  };
  assert.equal(run({tabs:['lancamento_rapido','dashboard']}),true);
  assert.equal(run({tabs:['lancamento_rapido','compra_sucata']}),false,'quem usa o ERP ganha o botão no cabeçalho');
  assert.equal(run({tabs:['lancamento_rapido'],admin:true}),false);
  assert.equal(run({tabs:['lancamento_rapido']},'?completo=1'),false);
  assert.equal(run({tabs:[],admin:true},'?destino=rapido'),true);
  assert.equal(run({tabs:['vendas']},'?destino=rapido'),false);
  assert.match(core,/lancamento_rapido:\s*\{label:'Lançamento rápido/);
});
