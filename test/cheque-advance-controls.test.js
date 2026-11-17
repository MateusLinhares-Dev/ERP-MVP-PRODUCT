import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
function slice(start,end){
  const a=core.indexOf(start),b=core.indexOf(end,a);
  assert.ok(a>=0&&b>a,'trecho não encontrado: '+start);
  return core.slice(a,b);
}
const json=value=>JSON.parse(JSON.stringify(value));
const helpers=slice('function _chqHojeBR(){','function chqInit(){');
const access=slice('function _chqPodeLancarBanco(){','function chqMarcarComp(id){');
const mark=slice('function chqMarcarComp(id){','function chqRemessaDeposito(){');
const batch=slice('function chqRemessaDepConfirmar(){',"window['chqRemessaDeposito']");
const remove=slice('function chqReabrir(id){','function _chqCadastroDestinos(){');

test('compensação: cheque próprio de adiantamento baixa o banco; de terceiro não; legado pergunta',()=>{
  const ctx={ADT_POR_FORN:{F1:[{cod:'ADT1',forma:'Cheque'},{cod:'ADT2',forma:'PIX',movBancoId:'LB-1'}]}};
  runInNewContext(helpers+';this.auto=_chqDescontaBancoAuto;',ctx);
  assert.equal(ctx.auto({advanceCode:'ADT1',fornCod:'F1',tipoCheque:'Cheque'}),true);
  assert.equal(ctx.auto({advanceCode:'ADT1',fornCod:'F1',tipoCheque:'Cheque de Terceiro'}),false);
  assert.equal(ctx.auto({advanceCode:'ADT2',fornCod:'F1',tipoCheque:'Cheque'}),false,'adiantamento que já debitou o banco');
  assert.equal(ctx.auto({n:'123',dc:true}),null,'cheque legado: mantém a pergunta');
});

function chequeContext(cheques,extra={}){
  const calls=[],toasts=[],alerts=[];
  const ctx={CHQ_CTRL:cheques,ADT_POR_FORN:{F1:[{cod:'ADT1'}]},calls,toasts,alerts,
    prompt:()=>'17/11/2026',confirm:()=>true,alert:m=>alerts.push(m),
    showToast:(m,t)=>toasts.push([t,m]),_chqFmt:v=>'R$ '+v,
    _cfgChequeBankCode:name=>name==='Sicredi'?'BC-001':'',
    _bancoApi:async body=>{calls.push(json(body));return extra.reply||{cleared:[],movements:[]};},
    document:{getElementById:()=>({value:'2026-11-17',remove(){}}),querySelectorAll:()=>extra.checks||[],querySelector:()=>null},
    Array,Number,...extra.context};
  runInNewContext(helpers+access+mark+batch+remove,ctx);
  return ctx;
}

test('compensar um cheque manda ao servidor a data, a conta do banco e se desconta',async()=>{
  const ctx=chequeContext({C1:{n:'1',b:'Sicredi',v:10},C2:{n:'2',b:'Sicredi',v:10,dc:true},C3:{n:'3',b:'Itaú',v:10,advanceCode:'ADT1',fornCod:'F1'}},{context:{confirm:()=>false}});
  ctx.chqMarcarComp('C1');ctx.chqMarcarComp('C2');ctx.chqMarcarComp('C3');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ctx.calls.map(c=>c.cheques[0]),[{id:'C1',bankCode:'BC-001',debit:true},{id:'C2',bankCode:'BC-001',debit:false},{id:'C3',bankCode:'',debit:true}]);
  assert.deepEqual(ctx.calls.map(c=>[c.action,c.mode,c.date]),[['clear-cheques','controle','17/11/2026'],['clear-cheques','controle','17/11/2026'],['clear-cheques','controle','17/11/2026']]);
  assert.equal(ctx.CHQ_CTRL.C1.s,undefined,'a tela só muda com a resposta do servidor');
});

test('remessa manda todos os marcados numa chamada só e mostra os avisos do servidor',async()=>{
  const checks=['C1','C2','C9'].map(id=>({dataset:{id}}));
  const ctx=chequeContext({C1:{n:'1',b:'Sicredi',v:10},C2:{n:'2',b:'Sicredi',v:5,dc:true},C9:{n:'9',b:'Sicredi',v:5,s:'C'}},
    {checks,reply:{cleared:[{id:'C1'},{id:'C2'}],movements:[{id:'LB-1'}],warnings:['Cheque nº 2: aviso']}});
  ctx.chqRemessaDepConfirmar();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ctx.calls,[{action:'clear-cheques',mode:'remessa',date:'2026-11-17',cheques:[{id:'C1',bankCode:'BC-001',debit:true},{id:'C2',bankCode:'BC-001',debit:false}]}]);
  assert.deepEqual(ctx.toasts.map(t=>t[0]),['warn','success']);
  assert.match(ctx.toasts[1][1],/2 cheque\(s\) · R\$ 15,00/);
});

test('cheque de adiantamento não é excluído pelo controle; cheque já debitado exige acesso a Bancos',async()=>{
  const adt=chequeContext({C1:{n:'1',b:'Itaú',v:10,advanceCode:'ADT9'}},{context:{cu:{admin:true}}});
  adt.chqExcluir('C1');
  assert.match(adt.alerts.pop(),/pertence ao adiantamento ADT9/);
  const semBanco=chequeContext({C1:{n:'2',b:'Itaú',v:10,movBancoId:'LB-7',s:'C'}},{context:{cu:{tabs:['cheques_compensar']}}});
  semBanco.chqReabrir('C1');semBanco.chqExcluir('C1');
  assert.equal(semBanco.alerts.length,2);
  assert.match(semBanco.alerts[0],/acesso a Bancos/);
  assert.equal(adt.calls.length+semBanco.calls.length,0,'nada vai ao servidor');
  const comBanco=chequeContext({C1:{n:'3',b:'Itaú',v:10,movBancoId:'LB-8',s:'C'},C2:{n:'4',b:'Itaú',v:10}},{context:{cu:{tabs:['contas_banco']}}});
  comBanco.chqReabrir('C1');comBanco.chqExcluir('C2');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(comBanco.calls,[{action:'reopen-cheque',id:'C1'},{action:'delete-cheque',id:'C2'}]);
});

test('a tela não cria nem apaga lançamento do extrato por conta própria',()=>{
  assert.doesNotMatch(core,/function _chqMovBancoCriar/);
  assert.doesNotMatch(core,/function _chqMovBancoRemover/);
  assert.doesNotMatch(core,/function registrarMovBanco/);
  assert.doesNotMatch(core,/LANC_BANCO_DB\.push\(\{id,bancoCod:cod/);
});
