import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('public/legacy/firebase-sync.js');
const match=/const _ERP_NOS_SINCRONIZADOS\s*=\s*\[([\s\S]*?)\];/.exec(source);
const nodes=[...match[1].matchAll(/'([^']+)'/g)].map(item=>item[1]);
const current=JSON.parse(read('database.rules.json'));
const hardened=JSON.parse(read('docs/database.rules.candidate.json'));
const check=(expr,claims=null)=>Boolean(runInNewContext(expr,{auth:claims?{uid:'test',token:{erpAccess:true,...claims}}:null}));

test('regra candidata mantém negação global e remove wildcard permissivo',()=>{
  assert.equal(hardened.rules['.read'],false);
  assert.equal(hardened.rules['.write'],false);
  assert.equal(hardened.rules.erp.$node,undefined);
  assert.equal(hardened.rules.erpAuth['.read'],false);
  assert.equal(hardened.rules.erpAuth['.write'],false);
  assert.equal(hardened.rules.security['.write'],false);
});

test('cada um dos 99 nós sincronizados tem regra explícita',()=>{
  assert.equal(nodes.length,99);
  for(const node of nodes){
    assert.equal(typeof hardened.rules.erp[node]?.['.read'],'string',node+' read');
    assert.notEqual(hardened.rules.erp[node]?.['.write'],undefined,node+' write');
  }
  assert.deepEqual(current.rules.erp.chat,hardened.rules.erp.chat);
  assert.deepEqual(current.rules.erp.chatRead,hardened.rules.erp.chatRead);
});

test('perfil sem claims não lê módulos financeiros, folha ou frota',()=>{
  for(const key of ['contasPagar','lancBanco','folha','viagem','tickets','clientes']){
    assert.equal(check(hardened.rules.erp[key]['.read'],{}),false,key);
    assert.equal(check(hardened.rules.erp[key]['.write'],{}),false,key);
  }
});

test('claims por domínio permitem apenas o domínio correspondente',()=>{
  assert.equal(check(hardened.rules.erp.tickets['.read'],{canPurchasing:true}),true);
  assert.equal(check(hardened.rules.erp.tickets['.write'],{canPurchasing:true}),true);
  assert.equal(check(hardened.rules.erp.lancBanco['.read'],{canPurchasing:true}),false);
  assert.equal(check(hardened.rules.erp.lancBanco['.read'],{canBanking:true}),true);
  assert.equal(check(hardened.rules.erp.folha['.read'],{canHR:true}),false);
  assert.equal(check(hardened.rules.erp.folha['.write'],{canPayroll:true}),true);
});

test('fiscal distingue leitura de alteração e metadados respeitam sessão',()=>{
  assert.equal(check(hardened.rules.erp.fiscal['.read'],{canFiscalRead:true}),true);
  assert.equal(check(hardened.rules.erp.fiscal['.write'],{canFiscalRead:true}),false);
  assert.equal(check(hardened.rules.erp.fiscal['.write'],{canFiscalWrite:true}),true);
  assert.equal(check(hardened.rules.erp._appBuild['.write'],{admin:false}),false);
  assert.equal(check(hardened.rules.erp._appBuild['.write'],{admin:true}),true);
});

test('Storage mantém limites e requer claims por categoria',()=>{
  const storage=read('storage.rules');
  assert.match(storage,/request\.resource\.size\s*<=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(storage,/request\.resource\.size\s*<=\s*5\s*\*\s*1024\s*\*\s*1024/);
  for(const claim of ['canEmployeeDocs','canBusinessDocs','canFleetDocs','canChat'])assert.match(storage,new RegExp(claim));
  assert.match(storage,/request\.auth\.uid == uid/);
  assert.doesNotMatch(storage,/allow\s+(read|write)\s*:\s*if\s+true/);
});

test('arquivo ativo corresponde à política granular candidata e não contém wildcard',()=>{
  assert.deepEqual(current,hardened);
  assert.equal(current.rules.erp.$node,undefined);
  const policy=JSON.parse(read('public/app/rtdb-collection-policy.json'));
  assert.equal(Object.keys(policy.nodes).length,nodes.length);
  assert.deepEqual(policy.nodes.tickets.write,{mode:'claims',claims:['canPurchasing']});
  assert.equal(policy.nodes.users.write.mode,'none');
});
