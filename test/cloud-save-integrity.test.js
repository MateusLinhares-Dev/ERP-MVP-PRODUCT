import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const feedback=readFileSync(new URL('../public/legacy/persistence-feedback.js',import.meta.url),'utf8');
const bootstrap=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
function extract(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Trecho de código encontrado: '+start);
 return src.slice(a,b);
}
function ticketContext(current={},synced={}){
 const c={TICKETS_DB:current,_ticketsSnapJSON:synced,_fbEnviadoOk:{},
    _ticketsAtualizarSnapshot(){throw new Error('Não pode marcar todos como confirmados em leitura parcial.');}};
 const code=extract('function _fbTicketSnapshotConfirmado','function _fbTicketConfirmarLote')
          +extract('function _fbTicketConfirmarLote','function _fbSetStatus');
 runInNewContext(code+';this.remote=_fbTicketSnapshotConfirmado;this.ack=_fbTicketConfirmarLote;',c);
 return c;
}
test('lote anterior não marca ticket criado enquanto gravava como confirmado',()=>{
 const t={T040:{ticket:'T040',totalGeral:100},T049:{ticket:'T049',totalGeral:46946.70}};
 const c=ticketContext(t,{});
 c.ack({T040:JSON.stringify(t.T040)},[]);
 assert.equal(c._ticketsSnapJSON.T040,JSON.stringify(t.T040));
 assert.equal(c._ticketsSnapJSON.T049,undefined);
});
test('edição posterior à captura do lote não é marcada como enviada',()=>{
 const c=ticketContext({T049:{ticket:'T049',totalGeral:600}},{T049:'old'});
 c.ack({T049:JSON.stringify({ticket:'T049',totalGeral:400})},[]);
 assert.equal(c._ticketsSnapJSON.T049,'old');
});
test('leitura parcial preserva ticket local ainda não confirmado e invalida cache',()=>{
 const local={T040:{ticket:'T040',totalGeral:1},T049:{ticket:'T049',totalGeral:46946.70}};
 const c=ticketContext(local,{T049:JSON.stringify(local.T049)});
 c._fbEnviadoOk['tickets/T040']='stale';
 c.remote({T040:local.T040},false);
 assert.equal(c._ticketsSnapJSON.T040,JSON.stringify(local.T040));
 assert.equal(c._ticketsSnapJSON.T049,undefined);
 assert.equal(c._fbEnviadoOk['tickets/T040'],undefined);
});
test('salvamento genérico é serializado mesmo com dois pedidos simultâneos',async()=>{
 const code=extract('async function _fbSalvarAgora(){','async function _fbSalvarAgoraInterno()');
 let calls=0,resolveFirst;
 const ctx={_fbSalvamentoEmAndamento:null,_fbSalvarOutraVez:false,_fbTimer:null,
   setTimeout(fn){ctx.queued=fn;return 1},clearTimeout(){},
   _fbSalvarAgoraInterno(){calls++;return calls===1?new Promise(resolve=>resolveFirst=resolve):Promise.resolve();}};
 runInNewContext(code+';this.save=_fbSalvarAgora;',ctx);
 const a=ctx.save(),b=ctx.save();
 assert.equal(calls,1);
 resolveFirst();await Promise.all([a,b]);
 assert.equal(typeof ctx.queued,'function');
 await ctx.queued();
 assert.equal(calls,2);
});
test('avisos de sucesso legados aguardam recibo do servidor',()=>{
 const emitted=[];
 const listeners={};
 const state={requested:3,confirmed:2,pending:true,error:null};
 const doc={body:{appendChild(){}},getElementById(){return {style:{},textContent:'',setAttribute(){}};},
  addEventListener(name,fn){listeners[name]=fn;},createElement(){return {style:{},setAttribute(){},textContent:''};}};
 const win={__ERP_CLOUD_SAVE_STATE__:state,showToast:(...x)=>emitted.push(x)};
 runInNewContext(feedback,{window:win,document:doc,setTimeout(){return 1},clearTimeout(){},Date,console});
 win.showToast('Pedido salvo!','success');
 assert.equal(emitted.some(x=>x[0]==='Pedido salvo!'&&x[1]==='success'),false);
 state.confirmed=3;state.pending=false;
 listeners['erp:cloud-save-state']({detail:{...state}});
 assert.equal(emitted.some(x=>x[0]==='Pedido salvo!'&&x[1]==='success'),true);
});
test('a interface de recibo carrega depois do núcleo e antes dos módulos',()=>{
 assert.ok(bootstrap.indexOf("loadClassic('/legacy/app-core.js')")<bootstrap.indexOf("loadClassic('/legacy/persistence-feedback.js')"));
 assert.ok(bootstrap.indexOf("loadClassic('/legacy/persistence-feedback.js')")<bootstrap.indexOf("loadClassic('/modules/phase1/phase1-purchase.js')"));
 assert.match(src,/_fbPublicarRecibo\(\{pending:true,error:_msgErro\}\)/);
 assert.match(src,/_fbTicketConfirmarLote\(_ticketsEnviadosJson,_ticketsRemovidosNoLote\)/);
 assert.doesNotMatch(src,/\} _ticketsAtualizarSnapshot\(\); _funcEditAtualizarSnapshot\(\)/);
 assert.match(purchase,/\b_ticketsSnapJSON\[id\]=JSON\.stringify\(saved\)/);
});

test('calendário não altera compromisso local antes da confirmação no repositório',()=>{
  const calendar=readFileSync(new URL('../public/modules/phase3/phase3-homologation.js',import.meta.url),'utf8');
  assert.match(calendar,/await store\.save\('calendarEvents',id,e\);\s*calendarEvents\[id\]=e;/);
  assert.match(calendar,/await store\.save\('calendarEvents',id,next\);calendarEvents\[id\]=next;/);
  assert.match(calendar,/await store\.remove\('calendarEvents',id\);delete calendarEvents\[id\];/);
  assert.match(calendar,/await store\.save\('fiscalLinks',String\(id\),link\);fiscalLinks\[String\(id\)\]=link/);
});
test('fluxo legado de Contas da Dona somente altera a memória após Firebase confirmar',()=>{
  const phase2=readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
  assert.match(phase2,/await store\.save\('ownerBills',id,item\);ownerBills\[id\]=item;/);
  assert.match(phase2,/await store\.save\('ownerBills',id,changed\);ownerBills\[id\]=changed;/);
});
test('erro central mantém alterações como pendentes e não apresenta confirmação falsa',()=>{
  assert.match(src,/function _fbSalvarAgoraInterno\(/);
  assert.match(src,/function _fbTicketSnapshotConfirmado\(/);
  assert.match(src,/_fbPublicarRecibo\(\{pending:true,error:_msgErro\}\)/);
  assert.match(feedback,/Aguardando confirmação|aguardando confirmação/i);
});
