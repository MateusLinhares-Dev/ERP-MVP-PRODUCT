import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bankIntegrationKey,encryptCredentials,decryptCredentials,centsFromProvider,normalizeProviderTransaction,handleBankIntegration} from '../server/application/bank-integrations.js';

const key=Buffer.alloc(32,41);
const oldKey=process.env.BANK_INTEGRATION_ENCRYPTION_KEY;
process.env.BANK_INTEGRATION_ENCRYPTION_KEY=key.toString('hex');
process.on('exit',()=>{if(oldKey===undefined)delete process.env.BANK_INTEGRATION_ENCRYPTION_KEY;else process.env.BANK_INTEGRATION_ENCRYPTION_KEY=oldKey;});
const admin={uid:'ADM-UID',erpUser:'elaine',erpAccess:true,canBanking:true,admin:true};
const clerk={uid:'OP-UID',erpUser:'operador',erpAccess:true,canBanking:true,admin:false};
function fakeDb(){
 const data={erp:{bancos:{BANK_1:{cod:'BANK-1',banco:'Itaú'}},bankReconciliationImports:{}},erpBankIntegrationPrivate:{},erpBankIntegrationAudit:{}};
 const get=path=>path.split('/').reduce((part,k)=>part?.[k],data);
 const set=(path,value)=>{const segments=path.split('/'),last=segments.pop();let target=data;for(const key of segments)target=target[key]??={};target[last]=value;};
 return {data,ref:path=>({async get(){return {val:()=>get(path)??null};},async update(values){set(path,{...(get(path)||{}),...values});},async transaction(fn){const before=get(path)??null,after=fn(before);if(after===undefined)return {committed:false,snapshot:{val:()=>before}};set(path,after);return {committed:true,snapshot:{val:()=>after}};},async push(record){set(path+'/log-'+Object.keys(get(path)||{}).length,record);}})};
}
function mockFetch(){
 const calls=[];
 const fetcher=async (url,options={})=>{
  const location=new URL(url);calls.push([location.pathname,location.search,options.method]);
  let result={};
  if(location.pathname==='/auth')result={apiKey:'SAMPLE-KEY'};
  else if(location.pathname==='/connect_token')result={accessToken:'LIMITED-ACCESS-TOKEN'};
  else if(location.pathname==='/accounts')result={results:[{id:'ACCOUNT_1',name:'Conta corrente',number:'12345678',type:'BANK'}]};
  else if(location.pathname==='/v2/transactions')result=location.searchParams.get('after')?
   {results:[{id:'TX_2',date:'2026-10-26',description:'PIX Cliente',amount:321.23,status:'POSTED'}],next:null}:
   {results:[{id:'TX_1',date:'2026-10-25',description:'PIX Fornecedor',amount:-1500,status:'POSTED'},{id:'TX_PEND',date:'2026-10-25',description:'Agendado',amount:-123,status:'PENDING'}],next:'?accountId=ACCOUNT_1&after=NEXT'};
  else throw Error('Unrecognized URL '+url);
  return {ok:true,status:200,async json(){return result}};
 };
 return {fetcher,calls};
}
test('segredo tem 32 bytes, é AES-GCM e não aparece em texto puro',()=>{
 assert.equal(bankIntegrationKey().length,32);
 const encrypted=encryptCredentials({clientId:'CLIENT',clientSecret:'VERY-SECRET'},key);
 assert.equal(encrypted.v,1);
 assert.doesNotMatch(JSON.stringify(encrypted),/VERY-SECRET/);
 assert.deepEqual(decryptCredentials(encrypted,key),{clientId:'CLIENT',clientSecret:'VERY-SECRET'});
 assert.throws(()=>decryptCredentials({...encrypted,tag:'AAAA'},key));
});
test('centavos importados arredondam corretamente e rejeitam números não decimais',()=>{
 assert.equal(centsFromProvider('-1500'),'-150000');assert.equal(centsFromProvider('500.20'),'50020');
 assert.equal(centsFromProvider('0.005'),'1');assert.equal(centsFromProvider('0.004'),'0');
 assert.throws(()=>centsFromProvider('1e99'));assert.throws(()=>centsFromProvider('NaN'));
 const entry=normalizeProviderTransaction({id:'TX_1',date:'2026-10-25',amount:-1500,description:'Fornecedor ABC'},'BANK-1',admin,'ACCOUNT_1');
 assert.equal(entry.amountCents,'-150000');assert.equal(entry.source,'pluggy');
 assert.equal(entry.bankCode,'BANK-1');
});
test('a tela pode consultar o estado sem expor credenciais; somente admin altera',async()=>{
 const db=fakeDb(),{fetcher}=mockFetch();
 const initial=await handleBankIntegration(clerk,{bankCode:'BANK-1',action:'status'},{db,fetcher});
 assert.equal(initial.canConfigure,false);assert.equal(initial.config.configured,false);
 await assert.rejects(()=>handleBankIntegration(clerk,{bankCode:'BANK-1',action:'save',clientId:'CLIENT',clientSecret:'SECRET'},{db,fetcher}),{status:403});
 const result=await handleBankIntegration(admin,{bankCode:'BANK-1',action:'save',clientId:'CLIENT',clientSecret:'SECRET'},{db,fetcher});
 assert.equal(result.config.configured,true);assert.equal(result.config.connected,false);
 assert.doesNotMatch(JSON.stringify(result),/SECRET|CLIENT/);
 assert.doesNotMatch(JSON.stringify(db.data),/"clientSecret":"SECRET"/);
 const status=await handleBankIntegration(clerk,{bankCode:'BANK-1',action:'status'},{db,fetcher});
 assert.equal(status.config.configured,true);
});
test('conexão Pluggy, escolha de conta e importação idempotente com paginação por cursor',async()=>{
 const db=fakeDb(),{fetcher,calls}=mockFetch(),params={db,fetcher};
 const invoke=(action,extra={})=>handleBankIntegration(admin,{bankCode:'BANK-1',action,...extra},params);
 await invoke('save',{clientId:'CLIENT',clientSecret:'SECRET'});
 assert.equal((await invoke('test')).success,true);
 assert.equal((await invoke('connect-token')).accessToken,'LIMITED-ACCESS-TOKEN');
 const linked=await invoke('link',{itemId:'ITEM_123'});
 assert.equal(linked.accounts.length,1);assert.equal(linked.config.connected,true);
 await assert.rejects(()=>invoke('select-account',{accountId:'OTHER_ACCOUNT'}),{status:422});
 const chosen=await invoke('select-account',{accountId:'ACCOUNT_1'});
 assert.equal(chosen.config.accountId,'ACCOUNT_1');
 const once=await invoke('sync');assert.equal(once.created,2);assert.equal(once.duplicates,0);
 assert.equal(once.processed,2);
 const twice=await invoke('sync');assert.equal(twice.created,0);assert.equal(twice.duplicates,2);
 assert.equal(Object.keys(db.data.erp.bankReconciliationImports['BANK-1']).length,2);
 assert.equal(db.data.erp.lancBanco,undefined); // importar não movimenta saldo
 assert.ok(calls.some(call=>call[0]==='/v2/transactions'&&call[1].includes('after=NEXT')));
 assert.equal(Object.keys(db.data.erpBankIntegrationAudit['BANK-1']).length,2);
 const disconnected=await invoke('disconnect');assert.equal(disconnected.config.connected,false);
 assert.equal(Object.keys(db.data.erp.bankReconciliationImports['BANK-1']).length,2);
});
test('integração só usa backend autenticado e não publica dados privados no RTDB do navegador',()=>{
 const endpoint=readFileSync(new URL('../api/banking/integrations.js',import.meta.url),'utf8');
 assert.match(endpoint,/requireIdentity/);assert.match(endpoint,/assertSameOrigin/);
 const frontend=readFileSync(new URL('../public/modules/banking/bank-integrations-ui.js',import.meta.url),'utf8');
 assert.match(frontend,/root\.firebase\?\.auth/);
 assert.match(frontend,/Bearer /);
 assert.doesNotMatch(frontend,/localStorage|sessionStorage/);
 const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
 assert.equal(rules['.read'],false);
 assert.equal(rules['.write'],false);
 assert.equal(rules.erp['.read'],undefined);
 assert.equal(rules.erpBankIntegrationPrivate,undefined);
});
test('tela de conciliação mantém títulos financeiros e esconde controles especiais por padrão',()=>{
 const js=readFileSync(new URL('../public/modules/banking/reconciliation-ui.js',import.meta.url),'utf8');
 assert.match(js,/Correspondências sugeridas/);
 assert.match(js,/state\.advancedOpen/);
 assert.match(js,/Mais ações/);
 assert.match(js,/data-integration-open/);
 assert.match(js,/\[data-quick-undo\]/);
 const boot=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
 assert.match(boot,/bank-integrations-ui\.js/);
});
