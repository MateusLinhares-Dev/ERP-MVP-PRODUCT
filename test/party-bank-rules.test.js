import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildSecurityClaims} from '../server/domain/access.js';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const rules=read('database.rules.json').rules.erp;
const candidate=read('docs/database.rules.candidate.json').rules.erp;
const bankRules=rules.partyBanks;
const fields=bankRules.$partyKey.$index;
const claimSet=(tabs,admin=false)=>({erpAccess:true,...buildSecurityClaims({tabs},{admin})});
const allowed=(expression,claims,key)=>Boolean(runInNewContext(expression.replaceAll('.beginsWith(','.startsWith('),{auth:{uid:'test',token:claims},$partyKey:key}));
const node=value=>({exists:()=>value!==undefined&&value!==null,isString:()=>typeof value==='string',val:()=>value});
const fieldValid=(field,value)=>Boolean(runInNewContext(fields[field]['.validate'],{newData:node(value)}));
const rowValid=(row,index='0')=>Boolean(runInNewContext(fields['.validate'],{$index:{matches:r=>r.test(index)},newData:{hasChild:key=>Object.hasOwn(row,key),child:key=>node(row[key])}}));

test('formulário de fornecedor aceita os oito campos e mantém os campos desconhecidos bloqueados',()=>{
  const expected=['bank','country','accountType','agency','account','pix','holderName','holderDocument'];
  for(const field of expected)assert.equal(typeof fields[field]?.['.validate'],'string',field);
  assert.equal(fields.$other['.validate'],false);
  const account={bank:'Nubank',country:'BR',accountType:'Corrente',agency:'0260',account:'98656845-7',pix:'conta@example.com',holderName:'NOME DO TITULAR',holderDocument:'90120345900'};
  assert.equal(rowValid(account),true);
  for(const [field,value] of Object.entries(account))assert.equal(fieldValid(field,value),true,field);
  assert.equal(fieldValid('holderName','A'.repeat(151)),false);
  assert.equal(fieldValid('bank','B'.repeat(121)),false);
  assert.equal(fieldValid('account','1'.repeat(81)),false);
  assert.equal(fieldValid('country','INVALIDO'),false);
  assert.equal(fieldValid('accountType','Desconhecida'),false);
  assert.equal(rowValid({},'0'),false);
  assert.equal(rowValid(account,'identificador'),false);
});

test('edição exige a permissão do cadastro correto e nunca exige acesso ao módulo Bancos',()=>{
  const write=bankRules.$partyKey['.write'];
  const supplier=claimSet(['fornecedores']);
  const customer=claimSet(['clientes']);
  const payable=claimSet(['contas_pagar']);
  const admin=claimSet([],true);
  assert.equal(supplier.canBanking,false);
  assert.equal(customer.canBanking,false);
  assert.equal(allowed(write,supplier,'fornecedor-F670'),true);
  assert.equal(allowed(write,supplier,'cliente-C100'),false);
  assert.equal(allowed(write,customer,'cliente-C100'),true);
  assert.equal(allowed(write,customer,'fornecedor-F670'),false);
  assert.equal(allowed(write,payable,'fornecedor-F670'),false);
  assert.equal(allowed(write,payable,'cliente-C100'),false);
  assert.equal(allowed(write,admin,'fornecedor-F670'),true);
  assert.equal(allowed(write,admin,'cliente-C100'),true);
  assert.equal(allowed(write,supplier,'bancos-123'),false);
  assert.equal(allowed(bankRules['.read'],supplier,'fornecedor-F670'),true);
  assert.equal(allowed(bankRules['.read'],claimSet(['chat']),'fornecedor-F670'),false);
});

test('regra específica não libera bancos ou extratos da empresa e coincide com a candidata',()=>{
  assert.deepEqual(bankRules,candidate.partyBanks);
  assert.match(rules.bancos['.read'],/canBanking == true/);
  assert.match(rules.lancBanco['.read'],/canBanking == true/);
  assert.match(rules.lancBanco['.write'],/canBanking == true/);
  assert.equal(allowed(rules.bancos['.read'],claimSet(['fornecedores']),'fornecedor-F670'),false);
  assert.equal(allowed(rules.lancBanco['.read'],claimSet(['clientes']),'cliente-C100'),false);
});
