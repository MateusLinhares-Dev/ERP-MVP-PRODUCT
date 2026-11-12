import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSecurityClaims} from '../server/modules/access/domain/access-claims.js';
import {listPaymentBanks,payPayable} from '../server/modules/payables/application/payables.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const rules=JSON.parse(read('database.rules.json')).rules.erp;
const storage=read('storage.rules');
const core=read('public/legacy/app-core.js');
const supplier=read('public/legacy/supplier-compat.js');
const input={operationId:'d6ed9199-3565-4f6c-bae4-7e7e34876e91',payableId:'CP-100',date:'2026-11-04',bankCode:'BC-2',amount:200,advanceAmount:0,expected:{valor:300,status:'Pendente',paymentsCount:0}};
function fakeDB(){
  const state={erp:{bancos:{b1:{cod:'BC-2',banco:'Banco Gratus',saldo:99000,agencia:'0099',conta:'5001',pix:'secret'}},contasPagar:{'CP-100':{id:'CP-100',valor:300,cred:'Keni',desc:'Compra Sucata',status:'Pendente',ticket:'T10',fornCod:'F100'}},adiantamentos:{F100:[{cod:'ADT-1',valor:50,status:'Pendente'}]},tickets:{T10:{saldoPagar:300,status:'Pendente'}}}};
  let updates=0,fail=false;
  const get=p=>p.split('/').filter(Boolean).reduce((obj,k)=>obj?.[k],state);
  const put=(p,v)=>{const parts=p.split('/').filter(Boolean),key=parts.pop();let obj=state;for(const part of parts)obj=obj[part]??={};if(v===null)delete obj[key];else obj[key]=structuredClone(v);};
  return {state,get updates(){return updates;},failOnce(){fail=true;},ref(p){return {
    async get(){return {val:()=>structuredClone(get(p)??null)};},
    async transaction(fn){const previous=structuredClone(get(p)??null),next=fn(previous);if(next===undefined)return {committed:false,snapshot:{val:()=>previous}};put(p,next);return {committed:true,snapshot:{val:()=>next}};},
    async update(changes){if(fail){fail=false;throw new Error('permission_denied');}for(const [k,v] of Object.entries(changes))put((p?p+'/':'')+k,v);updates++;}
  };}};
}
const thais={uid:'erp:thais',erpUser:'thais',erpAccess:true,canPayables:true,canFinance:true,canBanking:false};

test('perfil Contas a Pagar não herda acesso ao módulo Bancos',()=>{
  const claims=buildSecurityClaims({tabs:['contas_pagar']});
  assert.equal(claims.canPayables,true);
  assert.equal(claims.canBanking,false);
  assert.equal(buildSecurityClaims({tabs:['clientes']}).canPayables,false);
  assert.equal(buildSecurityClaims({tabs:['contas_receber']}).canPayables,false);
  assert.equal(buildSecurityClaims({tabs:['adiantamentos']}).canPayables,false);
});

test('consulta devolve somente código e nome sem dados bancários',async()=>{
  const db=fakeDB();
  assert.deepEqual(await listPaymentBanks(thais,{db}),{banks:[{cod:'BC-2',banco:'Banco Gratus'}]});
  await assert.rejects(()=>listPaymentBanks({erpAccess:true,canChat:true},{db}),{status:403});
  assert.match(rules.bancos['.read'],/canBanking/);
  assert.doesNotMatch(rules.bancos['.read'],/canPayables|canFinance/);
  assert.match(rules.lancBanco['.write'],/canBanking/);
});

test('pagamento cria movimento bancário e atualiza título/ticket em um update',async()=>{
  const db=fakeDB();
  const result=await payPayable(thais,input,{db,uuid:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',now:()=>100000});
  assert.equal(db.updates,1);
  assert.equal(result.payable.valor,100);
  assert.equal(result.payable.status,'Pendente');
  assert.equal(db.state.erp.tickets.T10.saldoPagar,100);
  assert.equal(db.state.erp.lancBanco[result.bankMovement.id].valor,200);
  assert.equal(db.state.erp.contasPagar['CP-100'].pagamentos[0].movBancoId,result.bankMovement.id);
  assert.equal(await payPayable(thais,input,{db}).then(r=>r.alreadyCommitted),true);
  assert.equal(db.updates,1);
});

test('compensação parcial usa adiantamento e baixa conta no mesmo update',async()=>{
  const db=fakeDB();
  const result=await payPayable(thais,{...input,amount:250,advanceAmount:50},{db});
  assert.equal(result.payable.status,'Pago');
  assert.equal(result.payable.valor,300);
  assert.equal(result.payable.adtCompensado,50);
  assert.equal(db.state.erp.adiantamentos.F100[0].status,'Quitado');
  assert.equal(db.state.erp.tickets.T10.saldoPagar,0);
  assert.equal(db.updates,1);
});

test('falha ou concorrência rejeita sem duplicar a baixa',async()=>{
  const db=fakeDB();db.failOnce();
  await assert.rejects(()=>payPayable(thais,input,{db}),/permission_denied/);
  assert.equal(db.updates,0);
  assert.equal(db.state.erp.lancBanco,undefined);
  await assert.rejects(()=>payPayable(thais,{...input,expected:{valor:10,status:'Pendente',paymentsCount:0}},{db}),{code:'PAYABLE_CHANGED'});
  await assert.rejects(()=>payPayable({...thais,canPayables:false},input,{db}),{status:403});
  assert.equal(db.state.erp.contasPagar['CP-100'].valor,300);
});

test('exclusões comuns seguem acesso do módulo, não papel administrativo',()=>{
  assert.match(core,/function _usuarioPodeOperarModulo\(tab\)/);
  for(const tab of ['clientes','lista_compras','rod_balanca','compra_sucata'])assert.ok(core.includes("_usuarioPodeOperarModulo('"+tab+"')"),tab);
  assert.match(readFileSync(new URL('../web/erp/suppliers.tsx',import.meta.url),'utf8'),/_usuarioPodeOperarModulo\?\.\(TAB\)/);
  assert.match(rules.clientesDeletedV2['.write'],/canCustomers/);
  assert.equal(rules.fornecedoresDeletedV2['.write'],false);
  assert.equal(rules.fornecedores['.write'],false);
  assert.equal(rules.fornDeleted['.write'],false);
  assert.match(rules.fornecedores['.read'],/canSuppliers/);
  assert.doesNotMatch(rules.clientesDeletedV2['.write'],/auth\.token\.admin/);
  assert.match(storage,/allow delete: if authenticated\(\)\s*&& request\.auth\.token\.canBusinessDocs == true/);
  assert.match(rules.advanceBackups['.write'],/auth\.token\.admin/);
});

test('exclusão de cliente só altera a lista após confirmação do Firebase',async()=>{
  const {runInNewContext}=await import('node:vm');
  const section=core.slice(core.indexOf('const _erpExclusoesEmAndamento='),core.indexOf('function esc(',core.indexOf('const _erpExclusoesEmAndamento=')));
  const local=[{id:'CL-1',cod:'C001',nome:'Cliente Um'}],updates=[];
  let failure=true,history=0;
  const context={CLIENTES:local,Set,CustomEvent:class{constructor(name,payload){this.type=name;this.detail=payload.detail;}},
    _usuarioPodeOperarModulo:()=>true,confirm:()=>true,alert(){},showToast(){},
    _syncClientes:{remover(idx){local.splice(idx,1);},paraObjeto(){return {'CL-1':local[0]};}},
    window:{_fbDB:{ref(path){return {once:async()=>({val:()=>local[0]}),update:async data=>{if(failure)throw Error('permission_denied');updates.push(data);}};}}},
    firebase:{auth:()=>({currentUser:{uid:'erp:thais'}})},
    document:{dispatchEvent(){}},localStorage:{setItem(){}},renderClientes(){},populatePrecosCliSel(){},registrarHistorico(){history++;}
  };
  runInNewContext(section+';this.deleteCustomer=excluirCliente;',context);
  await context.deleteCustomer(0);
  assert.equal(local.length,1);
  assert.equal(updates.length,0);
  assert.equal(history,0);
  failure=false;
  await context.deleteCustomer(0);
  assert.equal(local.length,0);
  assert.equal(updates.length,1);
  assert.equal(updates[0]['clientes/CL-1'],null);
  assert.equal(updates[0]['clientesDeleted/CL-1'],true);
  assert.equal(history,1);
});

test('exclusão de fornecedor só some da lista depois que o servidor confirma',async()=>{
  const {runInNewContext}=await import('node:vm');
  const hidden=new Set(),calls=[];
  let deny=true;
  const context={Set,JSON,Object,Array,String,Promise,FORNECEDORES:[{cod:'F670',nome:'Keni'},{cod:'F671',nome:'Outro'}],FORN_DELETED:hidden,
    _usuarioPodeOperarModulo:()=>true,confirm:()=>true,alert(){},showToast(){},CustomEvent:class{},
    crypto:{randomUUID:()=>'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},
    fetch:async(url,init)=>{calls.push([url,JSON.parse(init.body)]);return deny
      ?{ok:false,json:async()=>({code:'SUPPLIER_HAS_OPEN_FINANCE',message:'Não dá para excluir fornecedor com pendência financeira.'})}
      :{ok:true,json:async()=>({action:'delete',deleted:['F670']})};},
    firebase:{auth:()=>({currentUser:{uid:'erp:thais',getIdToken:async()=>'t'}})},
    localStorage:{setItem(){}},renderTabelaFornecedores(){},populateFornSelects(){},atualizarBtnExcluir(){},
    document:{getElementById:()=>null,dispatchEvent(){}}
  };
  context.window=context;
  const pick=(from,to)=>core.slice(core.indexOf(from),core.indexOf(to,core.indexOf(from)));
  runInNewContext(pick('const _erpExclusoesEmAndamento=','async function excluirCliente(')+
    pick('function _fornAplicarResultado(result){','let TICKETS_DELETED')+
    pick('async function _fornApi(payload){','window.erpSupplierRequest=_fornApi;')+';this.deleteSupplier=cod=>_fornApi({action:"delete",codes:[cod]}).catch(()=>false);',context);
  await context.deleteSupplier('F670');
  assert.equal(hidden.size,0);
  deny=false;
  await context.deleteSupplier('F670');
  assert.equal(hidden.has('F670'),true);
  assert.deepEqual(calls.map(([url,body])=>[url,body.action,body.codes]),[['/api/master-data/suppliers','delete',['F670']],['/api/master-data/suppliers','delete',['F670']]]);
});
