import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const actions=readFileSync(new URL('../public/modules/finance/advance-actions.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const sample={cod:'ADT124',status:'Pendente',valor:124,bancoCod:'BC-005',movBancoId:'LB-ORPHAN'};

function setup({canBanking=false,withButton=true,code='BANK_LEDGER_CHANGED'}={}){
  const children=[],alerts=[],requests=[];
  const parent={children,querySelector:()=>children[0]||null,appendChild:child=>children.push(child)};
  const button=withButton?{dataset:{cod:'ADT124',forn:'Teste'},parentElement:parent,textContent:'Excluir',isConnected:true}:null;
  const ctx={
    ADT_POR_FORN:{F675:[{...sample}]},FORNECEDORES:[{cod:'F675',nome:'Teste'}],console,
    confirm:()=>true,showToast:(message)=>alerts.push(message),
    firebase:{auth:()=>({currentUser:{getIdTokenResult:async()=>({claims:{canAdvances:true,canBanking}}),getIdToken:async()=> 'token'}})},
    document:{createElement:()=>({dataset:{},style:{},addEventListener(name,cb){this.handler=cb;},remove(){this.removed=true;}})},
    _adtCommitTransacional:async()=>{const error=new Error('O movimento bancário deste adiantamento está divergente (ausente).');error.code=code;error.status=409;throw error;},
    fetch:async(url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>({eligible:true,signature:'a'.repeat(64),amount:124,missingMovementId:'LB-ORPHAN'})};},
    alert:msg=>alerts.push(msg),
  };
  ctx.window=ctx;
  runInNewContext(actions,ctx);
  return {ctx,alerts,children,button,requests};
}

test('divergência bancária mostra mensagem amigável e não repete exclusão',async()=>{
  const {ctx,alerts,children,button,requests}=setup({canBanking:false});
  const result=await ctx.ERPAdvanceActions.deleteAdvance('F675','ADT124',button);
  assert.equal(result,false);
  assert.equal(ctx.ADT_POR_FORN.F675.length,1);
  assert.equal(children.length,0);
  assert.equal(requests.length,0);
  assert.ok(alerts.some(message=>/conferência com o extrato/.test(message)));
  assert.ok(alerts.every(message=>!message.includes('BANK_LEDGER_CHANGED')&&!message.includes('divergente (ausente)')));
});

test('responsável financeiro recebe ação guiada de conferir pagamento sem exclusão automática',async()=>{
  const {ctx,children,button,requests,alerts}=setup({canBanking:true});
  const result=await ctx.ERPAdvanceActions.deleteAdvance('F675','ADT124',button);
  assert.equal(result,false);
  assert.equal(children.length,1);
  assert.equal(children[0].textContent,'Conferir pagamento');
  assert.ok(alerts.some(msg=>msg.includes('Conferir pagamento')));
  assert.equal(requests.length,0);
  assert.equal(ctx.ADT_POR_FORN.F675.length,1);
  await ctx.ERPAdvanceActions.deleteAdvance('F675','ADT124',button);
  assert.equal(children.length,1,'não duplica botão de revisão');
});

test('código estruturado do backend é preservado no erro da API',async()=>{
  const start=core.indexOf('async function _adtCommitTransacional(');
  const end=core.indexOf('async function salvarEditAdiantamento(',start);
  assert.ok(start>0&&end>start);
  const ctx={
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token'}})},
    fetch:async()=>({ok:false,status:409,json:async()=>({code:'BANK_LEDGER_CHANGED',message:'Movimento ausente.'})}),
    crypto:{randomUUID:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},window:{},
  };
  runInNewContext(core.slice(start,end),ctx);
  await assert.rejects(ctx.window._adtCommitTransacional({action:'delete',fornCod:'F675',adtCod:'ADT124'}),error=>
    error.code==='BANK_LEDGER_CHANGED'&&error.status===409);
});
