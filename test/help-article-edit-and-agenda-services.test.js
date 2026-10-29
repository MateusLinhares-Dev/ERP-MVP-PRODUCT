import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mutateHelpArticle } from '../server/application/help-article-mutation.js';
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
test('artigo já existente pode ser editado mesmo com cache inicial vazio',async()=>{
 const id='h_'+'a'.repeat(32),ref=fakeRef(id,{id,title:'Antes',revision:1,createdAt:100,createdBy:'engadministrator'});
 const result=await mutateHelpArticle(ref,{action:'save',id,revision:1,article:{title:'Depois'},actor:'engadministrator'});
 assert.equal(result.outcome,'ok');assert.equal(result.article.title,'Depois');assert.equal(result.article.revision,2);assert.equal(ref.stats().writes,1);assert.equal(ref.stats().reads,1);
});
test('exclusão de artigo existente confirma gravação; versão antiga não sobrescreve',async()=>{
 const id='h_'+'b'.repeat(32),ref=fakeRef(id,{id,title:'T',revision:3});
 const mismatch=await mutateHelpArticle(ref,{action:'save',id,revision:2,article:{title:'Indevido'},actor:'engadministrator'});
 assert.equal(mismatch.outcome,'conflict');assert.equal(ref.stats().writes,0);
 const removed=await mutateHelpArticle(ref,{action:'delete',id,revision:3,actor:'engadministrator'});
 assert.equal(removed.outcome,'ok');assert.equal(ref.stats().value,null);
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
test('API de ajuda lê filho antes de transação; serviço exige permissão e regras privadas',()=>{
 const help=source('api/help/articles.js');
 assert.match(help,/mutateHelpArticle/);assert.match(help,/Object.entries/);
 const api=source('api/agenda/services.js');assert.match(api,/canDeliveryAgenda/);assert.match(api,/assertSameOrigin/);
 const rules=JSON.parse(source('database.rules.json')).rules.erpAgendaServices;
 assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
 const front=source('public/modules/phase1/phase1-agenda.js');
 assert.match(front,/Gerenciar/);assert.match(front,/api\/agenda\/services/);
});
