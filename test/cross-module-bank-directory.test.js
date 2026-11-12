import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildSecurityClaims} from '../server/modules/access/domain/access-claims.js';
import {listPaymentBanks} from '../server/modules/payables/application/payables.js';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules.erp;
const section=core.slice(core.indexOf('const _erpBankDirectory='),core.indexOf('let _camDest=',core.indexOf('const _erpBankDirectory=')));
const decode=text=>text.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');

function select(id,value=''){
  let html='';
  let selected=value;
  const el={id,tagName:'SELECT',dataset:{},disabled:false,closest:()=>null,
    get value(){return selected;},set value(v){selected=String(v);},
    get innerHTML(){return html;},
    set innerHTML(input){
      html=String(input);
      const options=Array.from(html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g),match=>({value:decode(match[1]),textContent:decode(match[2])}));
      this.options=options;
      selected=options[0]?.value||'';
    },options:[]};
  return el;
}
function setup(){
  let currentUser={uid:'erp:thais',getIdToken:async()=> 'token-1'},calls=0;
  const nodes=new Map(),alerts=[],callbacks=[];
  const response={banks:[{cod:'BC-03',banco:'Banco & Cia',saldo:9999,conta:'secreto',pix:'sigilo'},{cod:'BC-04',banco:'Banco Gratus'}]};
  const ctx={window:{},Set,Map,Array,Date,console,
    MutationObserver:class{constructor(callback){callbacks.push(callback);}observe(){}},
    document:{body:{},getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>Array.from(nodes.values())},
    firebase:{auth:()=>({currentUser,onAuthStateChanged:()=>{}})},
    esc:text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    showToast:text=>alerts.push(String(text)),
    fetch:async(url,options)=>{
      calls++;
      assert.equal(url,'/api/finance/bank-options');
      assert.equal(options.headers.Authorization,'Bearer token-'+(currentUser.uid.endsWith('thais')?'1':'2'));
      return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>response};
    },
    _cfgChequeBankNames:()=>['Banco & Cia','Cheque de terceiro'],
    _adtCarregarContasPermitidas:()=>Promise.resolve(true),
  };
  runInNewContext(section+';this.directory={scan:_erpBankDirectoryScan,load:_erpBankDirectoryLoad,render:_erpBankDirectoryApply,populate:_populateBancosSelects};',ctx);
  return {ctx,nodes,alerts,callbacks,add(id,value=''){const el=select(id,value);nodes.set(id,el);return el;},setUser(uid){currentUser={uid,getIdToken:async()=>uid.endsWith('thais')?'token-1':'token-2'};},get calls(){return calls;}};
}
function db(){return {ref(path){assert.equal(path,'erp/bancos');return {get:async()=>({val:()=>({a:{cod:'BC-03',banco:'Banco & Cia',saldo:109000,conta:'0001',pix:'PIX'},b:{cod:'BC-04',banco:'Banco Gratus'}})})};}};}

test('lista de bancos é permitida aos módulos que utilizam seletores, sem liberar Bancos',async()=>{
  for(const tab of ['contas_pagar','contas_receber','adiantamentos','fin_clientes','clientes','fornecedores','compra_sucata','vendas','cheques','contratos','viagem_motorista','despesas_grupo']){
    const claims=buildSecurityClaims({tabs:[tab]});
    const identity={uid:'erp:test',erpAccess:true,...claims};
    assert.equal(claims.canBanking,false,tab);
    const result=await listPaymentBanks(identity,{db:db()});
    assert.deepEqual(result,{banks:[{cod:'BC-03',banco:'Banco & Cia'},{cod:'BC-04',banco:'Banco Gratus'}]},tab);
  }
  for(const tab of ['chat','ponto','usuarios','afazeres']){
    const claims=buildSecurityClaims({tabs:[tab]});
    await assert.rejects(()=>listPaymentBanks({erpAccess:true,...claims},{db:db()}),{status:403},tab);
  }
  assert.equal(rules.bancos['.read'].includes('canBanking'),true);
  assert.equal(rules.bancos['.read'].includes('canPayables'),false);
  assert.equal(rules.lancBanco['.read'].includes('canBanking'),true);
});

test('novo Contas a Pagar e edição recebem códigos e nomes sem dados privados',async()=>{
  const env=setup();
  const novo=env.add('cp-banco'),editar=env.add('ecp-banco');
  editar.dataset.erpBankDesired='BC-04';
  env.ctx.directory.scan();
  assert.equal(novo.disabled,true);
  await env.ctx.directory.load();
  assert.equal(novo.disabled,false);
  assert.equal(editar.value,'BC-04');
  assert.deepEqual(novo.options.map(x=>x.value),['','BC-03','BC-04']);
  assert.equal(novo.options[1].textContent,'Banco & Cia — BC-03');
  assert.doesNotMatch(novo.innerHTML,/secreto|PIX|109000|saldo|conta/);
  assert.equal(env.calls,1);
  env.ctx.directory.scan();
  assert.equal(env.calls,1);
});

test('seletores novos e existentes em outros módulos recebem lista pelo mesmo cache',async()=>{
  const env=setup();
  const cp=env.add('cp-banco');
  await env.ctx.directory.load();
  const cheque=env.add('cheq-banco');
  const recebimento=env.add('rcr-banco');
  const contrato=env.add('ct-banco');
  const fornecedor=env.add('ffla-banco');
  const venda=env.add('adtcli-banco');
  const seq=env.add('adt-seq-banco');
  const expense=env.add('f-banco');
  env.ctx.directory.scan();
  for(const item of [cheque,recebimento,contrato,fornecedor,venda,seq,expense]){
    assert.equal(item.disabled,false,item.id);
    assert.ok(item.options.length>=3,item.id);
  }
  assert.equal(recebimento.options[1].value,'BC-03','baixa de conta a receber manda o código do banco para o servidor');
  assert.equal(cheque.options.some(item=>item.value==='Cheque de terceiro'),true);
  assert.equal(seq.options.some(item=>item.value==='Cheque de terceiro'),true);
  assert.equal(venda.options[1].value,'BC-03');
  assert.equal(env.calls,1);
  const previously=cp.innerHTML;
  env.ctx.directory.scan();
  assert.equal(cp.innerHTML,previously);
});

test('troca de sessão invalida cache e não apresenta as opções do usuário anterior',async()=>{
  const env=setup();
  const cp=env.add('cp-banco');
  await env.ctx.directory.load();
  cp.value='BC-03';
  env.setUser('erp:outro');
  env.ctx.directory.scan();
  assert.equal(cp.disabled,true);
  assert.equal(cp.value,'');
  await env.ctx.directory.load();
  assert.equal(cp.disabled,false);
  assert.equal(cp.value,'');
  assert.equal(env.calls,2);
});

test('falha de acesso bloqueia o seletor, sem simular banco cadastrado',async()=>{
  const env=setup(),cp=env.add('cp-banco');
  env.ctx.fetch=async()=>({ok:false,status:403,headers:{get:()=> 'application/json'},json:async()=>({message:'Acesso negado'})});
  assert.equal(await env.ctx.directory.load(),false);
  assert.equal(cp.disabled,true);
  assert.match(cp.options[0].textContent,/perfil ainda não possui autorização/);
  assert.equal(env.alerts.length,1);
});

test('formulário aberto depois do carregamento recebe bancos pelo observador',async()=>{
  const env=setup();
  env.add('cp-banco');
  await env.ctx.directory.load();
  const edit=env.add('ecp-banco');
  edit.dataset.erpBankDesired='BC-04';
  assert.equal(env.callbacks.length,1);
  env.callbacks[0]([{target:{matches:()=>false},addedNodes:[{nodeType:1,matches:()=>true}]}]);
  assert.equal(edit.value,'BC-04');
  assert.equal(edit.disabled,false);
  assert.equal(env.calls,1);
});

test('edição preserva banco antigo quando o cadastro atual não inclui mais a conta',async()=>{
  const env=setup();
  const edit=env.add('ecr-banco');
  edit.dataset.erpBankDesired='Banco removido (histórico)';
  await env.ctx.directory.load();
  assert.equal(edit.value,'Banco removido (histórico)');
  assert.match(edit.options.at(-1).textContent,/registro anterior/);
  assert.equal(edit.disabled,false);
});
