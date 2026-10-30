import { randomUUID } from 'node:crypto';
const bad=(message,code='INVALID_HELP_ARTICLE',status=400)=>Object.assign(new Error(message),{code,status});
const clean=(v,max,required=false)=>{
  const x=String(v??'').trim();
  if(x.length>max||/[\u0000-\u001f\u007f]/.test(x)||(required&&!x))throw bad(`Campo inválido (máximo ${max} caracteres).`);
  return x;
};
const CATEGORIES=['compras','comercial','fiscal','financeiro','estoque','pessoas','gestao','seguranca'];
export function validateArticle(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw bad('Artigo inválido.');
  const category=clean(value.category,40,true);
  if(!CATEGORIES.includes(category))throw bad('Categoria inválida.');
  const steps=value.steps;
  if(!Array.isArray(steps)||steps.length>20)throw bad('Informe até 20 passos.');
  const doc={title:clean(value.title,130,true),summary:clean(value.summary,300,true),category,
    keywords:clean(value.keywords,260),steps:steps.map(v=>clean(v,500,true)),
    warning:clean(value.warning,500),status:value.status==='published'?'published':'draft',
    module:clean(value.module,60)};
  if(doc.status==='published'&&doc.steps.length===0)throw bad('Para publicar, inclua ao menos um passo.');
  return doc;
}
export function newArticleId(){return 'h_'+randomUUID().replace(/-/g,'');}
export function validateArticleId(id){
  if(!/^h_[a-f0-9]{32}$/.test(String(id||'')))throw bad('Identificador inválido.');
  return id;
}
export function assertRevision(current,expected){
  if(current && current.revision!==expected)throw bad('Outro usuário atualizou o artigo. Recarregue antes de salvar.','REVISION_CONFLICT',409);
}
export function categoryOptions(){return [...CATEGORIES];}
