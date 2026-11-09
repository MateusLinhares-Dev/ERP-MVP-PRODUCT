import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,getAdvanceOperationStatus} from '../server/modules/advances/application/advances.js';

const code=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const start=code.indexOf('let _adtSalvamentoAtivo=false;');
const end=code.indexOf('function gerarSerieCheques()',start);
const snippet=code.slice(start,end);
const operationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeUI({post,getStatus,storage=new Map(),id=operationId}={}){
  const input={
    'adt-forn-busca':{value:'Fornecedor Um'},'adt-forn':{value:'F-001'},
    'adt-data':{value:'2026-11-05'},'adt-valor':{value:'500,00'},'adt-forma':{value:'PIX'},
    'adt-banco':{value:'BC-003'},'adt-empresa':{value:'Manuela Metais'},'adt-ticket':{value:''},'adt-obs':{value:''}
  };
  const button={disabled:false,dataset:{}};
  const elements=new Map(Object.entries(input));
  const body={appendChild(element){elements.set(element.id,element);element.remove=()=>elements.delete(element.id);}};
  const document={
    body,querySelector:()=>button,getElementById:id=>elements.get(id)||null,
    createElement:()=>({style:{},setAttribute(){},innerHTML:'',textContent:''}),addEventListener(){}
  };
  const messages=[];let posts=0,checks=0,closed=0;
  const ctx={
    document,URLSearchParams,crypto:{randomUUID:()=>id},window:{__ERP_ADVANCE_BANK_OPTIONS_LOADED__:true,
      __ERP_ADVANCE_BANK_OPTIONS__:[{cod:'BC-003',banco:'Conta principal'}],__ERP_ADVANCE_SUPPLIER_OPTIONS__:[]},
    firebase:{auth:()=>({currentUser:{uid:'user1',getIdToken:async()=> 'token'}})},
    _r2:val=>Math.round(val*100)/100,_adtParseVal:v=>Number(String(v).replace(',','.')),
    _fbAdiantamentoConfirmado(){},_adtCarregarContasPermitidas:async()=>true,
    _adtChqLer:()=>[],ADT_POR_FORN:{},LANC_BANCO_DB:[],BANCOS_DB:[],FORNECEDORES:[],
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},showToast:(m,t)=>messages.push([m,t]),
    renderAdiantamentos(){},renderFluxo(){},renderDashboard(){},registrarHistorico(){},
    cm(){closed++;},esc:v=>v,console,
    setTimeout(fn){fn();return 1;},
    fetch:async(url,opts)=>{
      if(String(url).includes('/advance-status?')){
        checks++;const data=await getStatus?.(url,opts);
        return {ok:true,status:200,json:async()=>data||{state:'not_found'}};
      }
      if(url==='/api/finance/advances'){
        posts++;
        return post?.(url,opts)||{ok:true,status:200,json:async()=>({advance:{cod:'ADTX',valor:500,bancoNome:'Conta principal'},entries:[{cod:'ADTX',valor:500}]})};
      }
      throw new Error('Unexpected '+url);
    }
  };
  runInNewContext(snippet,ctx);
  return {ctx,button,elements,messages,input,storage,call:()=>ctx.salvarAdiantamento(),count:()=>({posts,checks,closed})};
}

test('somente um POST é enviado apesar de vários cliques durante gravação lenta; interface é bloqueada e liberada após recibo',async()=>{
  let release;
  const response=new Promise(resolve=>{release=resolve;});
  const ui=makeUI({post:()=>response});
  const first=ui.call();
  assert.equal(ui.elements.has('adt-saving-lock'),true);
  assert.equal(ui.button.disabled,true);
  assert.equal(await ui.call(),false);
  assert.equal(ui.count().posts,1);
  release({ok:true,status:200,json:async()=>({advance:{cod:'ADTX',valor:500,bancoNome:'Conta principal'},entries:[{cod:'ADTX',valor:500}]})});
  assert.equal(await first,true);
  assert.deepEqual(ui.count(),{posts:1,checks:0,closed:1});
  assert.equal(ui.elements.has('adt-saving-lock'),false);
  assert.equal(ui.button.disabled,false);
});

test('HTTP 500 seguido de recibo confirmado recupera o mesmo adiantamento e não faz segundo POST',async()=>{
  const ui=makeUI({post:async()=>({ok:false,status:500,json:async()=>({code:'INTERNAL_ERROR'})}),
    getStatus:async()=>({state:'confirmed',advance:{cod:'ADT500',valor:500,bancoNome:'Conta principal'},entries:[{cod:'ADT500',valor:500}]})});
  assert.equal(await ui.call(),true);
  assert.deepEqual(ui.count(),{posts:1,checks:1,closed:1});
  assert.equal(ui.ctx.ADT_POR_FORN['F-001'][0].cod,'ADT500');
});

test('bloqueio 409 jamais reenvia POST durante o lock e conserva operationId para próxima consulta',async()=>{
  const ui=makeUI({post:async()=>({ok:false,status:409,json:async()=>({code:'ADVANCE_IN_PROGRESS'})}),
    getStatus:async()=>({state:'processing',retryAfterSeconds:45})});
  assert.equal(await ui.call(),false);
  assert.equal(ui.count().posts,1);
  assert.equal(ui.count().checks,6);
  assert.equal(ui.button.dataset.operationId,operationId);
  assert.equal(ui.elements.has('adt-saving-lock'),false);
  assert.equal(await ui.call(),false);
  assert.equal(ui.count().posts,1);
  assert.equal(ui.count().checks,7);
});

test('409 de outra operação já concluída tenta novamente uma única vez com o mesmo UUID e confirma só um adiantamento',async()=>{
  const payloads=[];
  const ui=makeUI({
    post:async(_url,options)=>{
      payloads.push(JSON.parse(options.body));
      if(payloads.length===1)return {ok:false,status:409,json:async()=>({code:'ADVANCE_IN_PROGRESS'})};
      return {ok:true,status:200,json:async()=>({advance:{cod:'ADT2',valor:500,bancoNome:'Conta principal'},entries:[{cod:'ADT2',valor:500}]})};
    },
    getStatus:async()=>({state:'not_found'})
  });
  assert.equal(await ui.call(),true);
  assert.equal(ui.count().posts,2);
  assert.equal(ui.count().checks,1);
  assert.equal(payloads[0].operationId,payloads[1].operationId);
  assert.equal(ui.ctx.ADT_POR_FORN['F-001'].length,1);
  assert.equal(ui.count().closed,1);
});

test('falha incerta jamais permite modificar valores com o mesmo identificador',async()=>{
  const ui=makeUI({post:async()=>({ok:false,status:500,json:async()=>({code:'INTERNAL_ERROR'})}),
    getStatus:async()=>({state:'not_found'})});
  assert.equal(await ui.call(),false);
  ui.input['adt-valor'].value='124,00';
  assert.equal(await ui.call(),false);
  assert.equal(ui.count().posts,1);
  assert.match(ui.messages.at(-1)[0],/não altere o adiantamento/i);
});

test('depois de F5, operação incerta é verificada antes de permitir novo lançamento',async()=>{
  const storage=new Map();
  const old=makeUI({storage,post:async()=>({ok:false,status:500,json:async()=>({code:'INTERNAL_ERROR'})}),
    getStatus:async()=>({state:'not_found'})});
  assert.equal(await old.call(),false);
  assert.equal(storage.size,1);
  const renewed=makeUI({storage,id:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',getStatus:async()=>({state:'confirmed',advance:{cod:'ADT124',valor:124},entries:[{cod:'ADT124',valor:124}]})});
  renewed.input['adt-valor'].value='12,00';
  assert.equal(await renewed.call(),false);
  assert.equal(renewed.count().posts,0);
  assert.equal(renewed.ctx.ADT_POR_FORN['F-001'][0].cod,'ADT124');
  assert.equal(storage.size,0);
  assert.match(renewed.messages.at(-1)[0],/anterior foi confirmado/);
});

test('recarregar tela enquanto trava ativa impede novo envio financeiro',async()=>{
  const storage=new Map();
  storage.set('mm_finance_advance_pending_v1_user1',JSON.stringify({uid:'user1',fornCod:'F-001',operationId:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'}));
  const ui=makeUI({storage,getStatus:async()=>({state:'processing',retryAfterSeconds:25})});
  assert.equal(await ui.call(),false);
  assert.equal(ui.count().posts,0);
  assert.equal(storage.size,1);
});

function fakeDb(){
  const state={erp:{bancos:{b1:{cod:'BC-003',banco:'Conta principal'}},fornecedores:{f1:{cod:'F-001',nome:'Fornecedor Um'}},adiantamentos:{'F-001':[]}}};
  const get=path=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],state);
  const put=(path,value)=>{const parts=path.split('/').filter(Boolean),last=parts.pop();let obj=state;for(const part of parts)obj=obj[part]??={};if(value===null)delete obj[last];else obj[last]=structuredClone(value);};
  return {state,ref:path=>({
    get:async()=>({val:()=>structuredClone(get(path)??null)}),
    update:async values=>{for(const [k,v] of Object.entries(values))put(path+'/'+k,v);},
    transaction:async fn=>{const next=fn(structuredClone(get(path)??null));if(next===undefined)return {committed:false};put(path,next);return {committed:true};}
  })};
}
const actor={erpAccess:true,canAdvances:true,uid:'user1',erpUser:'elaine'};
const input={operationId,fornCod:'F-001',data:'2026-11-05',valor:500,forma:'PIX',bancoCod:'BC-003',empresa:'Manuela Metais',ticket:'',obs:''};

test('API de consulta confirma recibo original sem escrever novamente',async()=>{
  const db=fakeDb();
  const record=await createAdvance(actor,input,{db,now:()=>100000,uuid:()=>operationId});
  const status=await getAdvanceOperationStatus(actor,{operationId,fornCod:'F-001'},{db,now:()=>100000});
  assert.equal(status.state,'confirmed');
  assert.equal(status.advance.cod,record.advance.cod);
  assert.equal(status.bankMovement.id,record.bankMovement.id);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,1);
  await assert.rejects(()=>createAdvance(actor,{...input,valor:124},{db}),{status:409,code:'OPERATION_REUSED'});
  await assert.rejects(()=>getAdvanceOperationStatus(actor,{operationId,fornCod:'F-002'},{db}),{status:409,code:'ADVANCE_SUPPLIER_MISMATCH'});
  const other=await getAdvanceOperationStatus({...actor,uid:'user2'}, {operationId,fornCod:'F-001'},{db});
  assert.equal(other.state,'not_found');
});

test('consulta identifica operação de outro usuário ainda em processamento, sem gravação',async()=>{
  const db=fakeDb();
  db.state.erpFinanceAdvanceLocks={'F-001':{owner:'someoneElse',expiresAt:120000}};
  const status=await getAdvanceOperationStatus(actor,{operationId,fornCod:'F-001'},{db,now:()=>100000});
  assert.equal(status.state,'processing');
  assert.equal(status.retryAfterSeconds,20);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,0);
});
