import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildSecurityClaims} from '../server/domain/access.js';

const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const rules=JSON.parse(read('database.rules.json')).rules;
const policy=JSON.parse(read('public/app/rtdb-collection-policy.json'));
const sync=read('public/legacy/firebase-sync.js');

function browserPermit(node,mode,claims){
  const item=policy.nodes[node]?.[mode];
  if(!item||claims.erpAccess!==true)return false;
  if(item.mode==='none')return false;
  if(item.mode==='admin')return claims.admin===true;
  if(item.mode==='erp')return true;
  if(item.mode==='claims')return item.claims.some(key=>claims[key]===true);
  throw new Error('Invalid policy mode');
}
function serverPermit(node,mode,claims){
  const expression=rules.erp[node]?.['.'+mode];
  if(expression===false||expression===undefined)return false;
  return Boolean(runInNewContext(expression,{
    auth:{uid:'erp:test',token:claims}
  }));
}
const profiles=[
  {},
  {tabs:['compra_sucata']},
  {tabs:['clientes']},
  {tabs:['contas_pagar']},
  {tabs:['folha_pagamento']},
  {tabs:['viagem_motorista']},
  {tabs:['fiscal']},
  {tabs:['lista_compras']},
  {tabs:['cheques_compensar']},
  {tabs:['vendas']},
  {tabs:['afazeres']},
];

test('99 coleções compartilhadas têm políticas equivalentes no frontend e no servidor',()=>{
  const nodes=Object.keys(policy.nodes);
  assert.equal(nodes.length,99);
  for(const profile of profiles){
    const claims={erpAccess:true,admin:false,erpUser:'operator',...buildSecurityClaims(profile)};
    for(const node of nodes){
      for(const mode of ['read','write']){
        assert.equal(browserPermit(node,mode,claims),serverPermit(node,mode,claims),
          `${JSON.stringify(profile.tabs||[])}: ${node} ${mode}`);
      }
    }
  }
});

test('regras ativas bloqueiam qualquer coleção desconhecida',()=>{
  assert.equal(rules.erp.$node,undefined);
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(rules.erpAuth['.write'],false);
  assert.equal(rules.erp.security,undefined);
  assert.equal(rules.erp.randomUnexpectedNode,undefined);
});

test('operações diretas continuam declaradas e separadas por domínio',()=>{
  for(const node of ['listaCompras','chequesControle','chequesControle_del','ticketsDeletedV2','advanceBackups']){
    assert.equal(typeof rules.erp[node]?.['.read'],'string',node);
    assert.equal(typeof rules.erp[node]?.['.write'],'string',node);
  }
  assert.equal(serverPermit('listaCompras','read',{erpAccess:true,...buildSecurityClaims({tabs:['lista_compras']})}),true);
  assert.equal(serverPermit('chequesControle','write',{erpAccess:true,...buildSecurityClaims({tabs:['lista_compras']})}),false);
  assert.equal(serverPermit('chequesControle','write',{erpAccess:true,...buildSecurityClaims({tabs:['cheques_compensar']})}),true);
  assert.equal(serverPermit('advanceBackups','write',{erpAccess:true,admin:false}),false);
  assert.equal(serverPermit('advanceBackups','write',{erpAccess:true,admin:true}),true);
});

test('categorias de documentos possuem leitura e escrita limitadas a canBusinessDocs',()=>{
  const category=rules.erp.documentCategories;
  assert.equal(typeof category['.read'],'string');
  assert.match(category['.read'],/canBusinessDocs == true/);
  assert.match(category.$categoryId['.write'],/canBusinessDocs == true/);
  assert.equal(serverPermit('documentCategories','read',{erpAccess:true,canBusinessDocs:true}),true);
  assert.equal(serverPermit('documentCategories','read',{erpAccess:true,canSales:true}),false);
});

test('metadados impedem falsificação de autoria e backups sem administrador',()=>{
  assert.match(rules.erp._user['.validate'],/auth\.token\.erpUser/);
  assert.match(rules.erp._ts['.validate'],/newData\.isNumber/);
  assert.match(rules.erp._untomb['.write'],/auth\.token\.admin/);
  const core=read('public/legacy/app-core.js');
  assert.match(core,/async function zerarTodosAdiantamentos/);
  assert.match(core,/await window\._fbDB\.ref\('erp\/advanceBackups\//);
  assert.match(core,/Nenhum adiantamento foi apagado/);
});

test('sincronizador filtra leituras e gravações pelo token e aplica política obrigatória',()=>{
  assert.match(sync,/_rtdbPodeAcessar\(no,'read',claims\)/);
  assert.match(sync,/_rtdbFiltrarGravacao\(dados\)/);
  assert.match(sync,/_rtdbPodeAcessar\(no,'write',claims\)/);
  assert.match(sync,/_rtdbPodeAcessar\('tickets','read'/);
  assert.match(sync,/_rtdbPodeAcessar\('fiscal','read'/);
  const boot=read('public/app/bootstrap.js');
  assert.match(boot,/rtdb-collection-policy\.json/);
  assert.match(boot,/__ERP_RTD_COLLECTION_POLICY__/);
});
