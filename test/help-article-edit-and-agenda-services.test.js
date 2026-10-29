import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firebaseArticleTransport, mutateHelpArticle } from '../server/application/help-article-mutation.js';
import { mutateAgendaServiceCatalog, defaultAgendaServices, normalizeAgendaServiceName, agendaServiceCatalog } from '../server/domain/agenda-service-catalog.js';
const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const copy=(v)=>v==null?v:structuredClone(v);
function fakeRef(key,initial){
 let persisted=copy(initial),cached=null,reads=0,writes=0;
 return {
  key,
  get:async()=>{reads++;cached=copy(persisted);return {val:()=>copy(persisted),exists:()=>persisted!=null};},
  transaction:async fn=>{
    const next=fn(copy(cached));
    if(next===undefined)return {committed:false,snapshot:{val:()=>copy(persisted)}};
    persisted=copy(next);cached=copy(next);writes++;
    return {committed:true,snapshot:{val:()=>copy(persisted)}};
  },
  stats:()=>({reads,writes,value:copy(persisted)})
 };
}
function atomicFake(initial){
 let value=copy(initial),etag=1,writes=0;
 return {
  read:async()=>({value:copy(value),etag:`"etag-${etag}"`}),
  write:async(_id,{action,value:next,etag:expected})=>{
   if(expected!==`"etag-${etag}"`)return {conflict:true};
   value=action==='delete'?null:copy(next);etag++;writes++;return {conflict:false};
  },
  stats:()=>({value:copy(value),writes})
 };
}
test('edição de artigo existente persiste independentemente do cache da SDK',async()=>{
 const id='h_'+'a'.repeat(32);
 const transport=atomicFake({id,title:'Antes',revision:1,createdAt:100,createdBy:'engadministrator'});
 const result=await mutateHelpArticle(transport,{action:'save',id,existing:true,revision:1,article:{title:'Depois'},actor:'engadministrator'});
 assert.equal(result.outcome,'ok');assert.equal(result.article.title,'Depois');assert.equal(result.article.revision,2);
 assert.equal(transport.stats().writes,1);assert.equal(transport.stats().value.title,'Depois');
});
test('exclusão confirma gravação; revisão antiga não sobrescreve; ausência real é 404',async()=>{
 const id='h_'+'b'.repeat(32),transport=atomicFake({id,title:'T',revision:3});
 const mismatch=await mutateHelpArticle(transport,{action:'save',id,revision:2,article:{title:'Indevido'},actor:'engadministrator'});
 assert.equal(mismatch.outcome,'conflict');assert.equal(transport.stats().writes,0);
 const removed=await mutateHelpArticle(transport,{action:'delete',id,revision:3,actor:'engadministrator'});
 assert.equal(removed.outcome,'ok');assert.equal(transport.stats().value,null);
 const missing=await mutateHelpArticle(transport,{action:'delete',id,revision:3,actor:'engadministrator'});
 assert.equal(missing.outcome,'not_found');
});
test('em duas sessões, a segunda gravação concorrente é rejeitada pelo ETag',async()=>{
 const id='h_'+'c'.repeat(32),store=atomicFake({id,title:'Original',revision:1});
 let readValue;
 const first={read:async()=>{readValue=await store.read(id);return readValue;},write:store.write};
 const second={read:async()=>readValue,write:store.write};
 const saved=await mutateHelpArticle(first,{action:'save',id,revision:1,article:{title:'Novo'},actor:'engadministrator'});
 const stale=await mutateHelpArticle(second,{action:'save',id,revision:1,article:{title:'Antigo'},actor:'engadministrator'});
 assert.equal(saved.outcome,'ok');assert.equal(stale.outcome,'conflict');assert.equal(store.stats().value.title,'Novo');
});
test('nova criação cria uma só vez e não sobrescreve um ID existente',async()=>{
 const id='h_'+'d'.repeat(32),store=atomicFake(null);
 const saved=await mutateHelpArticle(store,{action:'save',id,existing:false,revision:0,article:{title:'A'},actor:'engadministrator'});
 assert.equal(saved.outcome,'ok');assert.equal(store.stats().value.revision,1);
 const retry=await mutateHelpArticle(store,{action:'save',id,existing:false,revision:0,article:{title:'Duplicado'},actor:'engadministrator'});
 assert.equal(retry.outcome,'conflict');assert.equal(store.stats().writes,1);
});
test('transporte Firebase usa GET com ETag e PUT/DELETE condicionais',async()=>{
 const calls=[];let server={title:'Antes',revision:1},tag='"etag1"';
 const fetchImpl=async (url,options)=>{
  calls.push({url,method:options.method,headers:options.headers});
  if(options.method==='GET')return {ok:true,status:200,headers:new Headers({etag:tag}),json:async()=>copy(server)};
  assert.equal(options.headers['if-match'],tag);
  server=options.method==='DELETE'?null:JSON.parse(options.body);tag='"etag2"';
  return {ok:true,status:200};
 };
 const transport=await firebaseArticleTransport({
  app:{options:{credential:{getAccessToken:async()=>({access_token:'TEST_ACCESS_TOKEN'})}}},
  projectId:'manuela-metais-hml',databaseUrl:'https://manuela-metais-hml-default-rtdb.firebaseio.com',fetchImpl,
 });
 const id='h_'+'e'.repeat(32);
 const saved=await mutateHelpArticle(transport,{action:'save',id,revision:1,article:{title:'Depois'},actor:'engadministrator'});
 assert.equal(saved.outcome,'ok');assert.equal(server.title,'Depois');assert.equal(calls.length,2);
 assert.equal(calls[0].headers['X-Firebase-ETag'],'true');
 assert.equal(calls[1].headers['if-match'],'"etag1"');
 assert.equal(calls[1].url,`https://manuela-metais-hml-default-rtdb.firebaseio.com/erpHelp/articles/${id}.json`);
 const deleted=await mutateHelpArticle(transport,{action:'delete',id,revision:2,actor:'engadministrator'});
 assert.equal(deleted.outcome,'ok');assert.equal(server,null);assert.equal(calls.at(-1).method,'DELETE');
});
test('transporte não envia token OAuth a hosts que não sejam do projeto Firebase',async()=>{
 await assert.rejects(firebaseArticleTransport({
  app:{options:{credential:{getAccessToken:async()=>({access_token:'SECRET'})}}},projectId:'manuela-metais-hml',
  databaseUrl:'https://another-project-default-rtdb.firebaseio.com',fetchImpl:()=>{throw Error('should not run');}
 }),{status:500});
});
test('catálogo de serviços começa com padrões; adicionar e excluir persiste sem alterar histórico',async()=>{
 const ref=fakeRef('catalog',null);assert.equal(agendaServiceCatalog(null).length,4);
 const name=normalizeAgendaServiceName(' entrega de sucata ');
 const created=await mutateAgendaServiceCatalog(ref,{action:'add',name,actor:'engadministrator'});
 assert.equal(created.items.length,5);assert.equal(created.items.at(-1).name,'ENTREGA DE SUCATA');
 const again=await mutateAgendaServiceCatalog(ref,{action:'add',name,actor:'engadministrator'});
 assert.equal(again.changed,false);assert.equal(ref.stats().writes,1);
 const deleted=await mutateAgendaServiceCatalog(ref,{action:'delete',id:created.items.at(-1).id,actor:'engadministrator'});
 assert.equal(deleted.items.length,4);assert.equal(ref.stats().writes,2);
 const first=defaultAgendaServices()[0];
 const removeDefault=await mutateAgendaServiceCatalog(ref,{action:'delete',id:first.id,actor:'engadministrator'});
 assert.equal(removeDefault.items.some(x=>x.id===first.id),false);
});
test('validações de serviços bloqueiam tags e caracteres inválidos',()=>{
 assert.throws(()=>normalizeAgendaServiceName('<img onerror=x>'));
 assert.throws(()=>normalizeAgendaServiceName('a'));
 assert.equal(normalizeAgendaServiceName('Coleta  de material'),'COLETA DE MATERIAL');
});
test('API de ajuda usa ETag; serviço exige permissão e regras privadas',()=>{
 const help=source('api/help/articles.js');
 assert.match(help,/mutateHelpArticle/);assert.match(help,/firebaseArticleTransport/);
 const api=source('api/agenda/services.js');assert.match(api,/canDeliveryAgenda/);assert.match(api,/assertSameOrigin/);
 const rules=JSON.parse(source('database.rules.json')).rules.erpAgendaServices;
 assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
 const front=source('public/modules/phase1/phase1-agenda.js');
 assert.match(front,/Gerenciar/);assert.match(front,/api\/agenda\/services/);
});
