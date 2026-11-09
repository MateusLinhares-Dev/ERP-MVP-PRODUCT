import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {listAdvanceBankOptions} from '../server/modules/advances/application/advances.js';

const finance={uid:'u-1',erpAccess:true,canAdvances:true,canBanking:false};
const source=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');

function database(values){
  return {ref(path){return {async get(){return {val:()=>values[path]??null};}};}};
}
function functionSource(name){
  const first=source.indexOf('function '+name+'(');
  assert.ok(first>=0,name+' deve existir');
  const last=source.indexOf('\n}\n',first);
  assert.ok(last>first,name+' deve fechar');
  return source.slice(first,last+2);
}
function browser(suppliers,local=[]){
  const elements={};
  const document={
    body:{appendChild(el){elements[el.id]=el;}},
    getElementById(id){return elements[id]||null;},
    createElement(tag){return {tagName:tag.toUpperCase(),id:'',innerHTML:''};}
  };
  for(const id of ['adt-forn-busca','adt-forn','ea-forn-busca','ea-forn']){
    elements[id]={id,value:'',attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  }
  const context={document,
    window:{__ERP_ADVANCE_SUPPLIER_OPTIONS__:suppliers,__ERP_ADVANCE_BANK_OPTIONS_UID__:'u-1',__ERP_ADVANCE_BANK_OPTIONS_LOADED__:true},
    firebase:{auth:()=>({currentUser:{uid:'u-1'}})},
    getFornAtivos:()=>local,
    esc:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
  };
  vm.createContext(context);
  for(const name of ['_fornNomeNormalizado','_fornRotuloOpcao','_fornBuscaResolverCod','_adtPopularFornecedoresPermitidos']){
    vm.runInContext(functionSource(name),context);
  }
  context._adtPopularFornecedoresPermitidos();
  return {context,elements};
}

test('API de adiantamentos respeita exclusões por código e por ID, inclusive tombstones V2',async()=>{
  const db=database({
    'erp/bancos':{b1:{cod:'BC-001',banco:'Conta A'}},
    'erp/fornecedores':{
      r1:{id:'FR1',cod:'F007',nome:'GAUCHO'},
      r2:{id:'FR2',cod:'F300',nome:'GAUCHO'},
      r3:{id:'FR3',cod:'F301',nome:'GAUCHO'},
      r4:{id:'FR4',cod:'F302',nome:'REMOVIDO V2'},
      r5:{id:'FR5',cod:'F303',nome:'OUTRO FORNECEDOR'},
      r6:{id:'FR6',cod:'F304',nome:'INATIVO',status:'Inativo'},
      r7:{id:'FR7',cod:'F305',nome:'EXCLUIDO',excluido:true},
      r8:{id:'FR8',cod:'F007',nome:'GAUCHO'}
    },
    'erp/fornDeleted':{F300:true},
    'erp/fornDeletedV2':{F999:true},
    'erp/fornecedoresDeleted':{FR3:true},
    'erp/fornecedoresDeletedV2':{FR4:true}
  });
  const out=await listAdvanceBankOptions(finance,{db});
  assert.deepEqual(out.suppliers,[{cod:'F007',nome:'GAUCHO'},{cod:'F303',nome:'OUTRO FORNECEDOR'}]);
  assert.deepEqual(out.banks,[{cod:'BC-001',banco:'Conta A'}]);
});

test('API também reconhece tombstone legada em array',async()=>{
  const db=database({
    'erp/fornecedores':{r1:{cod:'F007',nome:'GAUCHO'},r2:{cod:'F008',nome:'GAUCHO'}},
    'erp/fornDeleted':['F008']
  });
  assert.deepEqual((await listAdvanceBankOptions(finance,{db})).suppliers,[{cod:'F007',nome:'GAUCHO'}]);
});

test('autocompletar não mostra um fornecedor excluído e aponta GAUCHO ao código correto',()=>{
  const {context,elements}=browser([{cod:'F007',nome:'GAUCHO'}],[{cod:'F300',nome:'GAUCHO'}]);
  assert.match(elements['dlist-forn-adiantamentos'].innerHTML,/value="GAUCHO"/);
  assert.doesNotMatch(elements['dlist-forn-adiantamentos'].innerHTML,/F300/);
  elements['adt-forn-busca'].value='GAUCHO';
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'F007');
});

test('nomes realmente iguais em códigos distintos são diferenciados e nunca selecionados arbitrariamente',()=>{
  const {context,elements}=browser([{cod:'F007',nome:'GAUCHO'},{cod:'F099',nome:'GÁUCHO'}]);
  const rendered=elements['dlist-forn-adiantamentos'].innerHTML;
  assert.match(rendered,/GAUCHO — F007/);
  assert.match(rendered,/GÁUCHO — F099/);
  elements['adt-forn-busca'].value='GAUCHO';
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'');
  elements['adt-forn-busca'].value='GAUCHO — F007';
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'F007');
  elements['adt-forn-busca'].value='GÁUCHO — F099';
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'F099');
});

test('a troca de sessão não mantém selecionado um fornecedor do usuário anterior',()=>{
  const {context,elements}=browser([{cod:'F007',nome:'GAUCHO'}],[{cod:'F300',nome:'OUTRO'}]);
  elements['adt-forn-busca'].value='GAUCHO';
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'F007');
  context.firebase.auth=()=>({currentUser:{uid:'u-2'}});
  context._fornBuscaResolverCod('adt-forn-busca','adt-forn');
  assert.equal(elements['adt-forn'].value,'');
});
