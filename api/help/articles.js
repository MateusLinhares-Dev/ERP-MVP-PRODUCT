import '../../server/config/load-local-env.js';
import { getFirebaseAdmin } from '../../server/infrastructure/firebase-admin.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders, assertJsonBody, assertSameOrigin, sendError } from '../../server/http/http.js';
import { validateArticle,validateArticleId,newArticleId,assertRevision } from '../../server/domain/help-article.js';
import { AuditRepository } from '../../server/infrastructure/audit-repository.js';
const fail=(message,status=400,code='HELP_ERROR')=>Object.assign(new Error(message),{status,code});
const list=v=>Object.values(v&&typeof v==='object'&&!Array.isArray(v)?v:{});
export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  try{
    if(req.method!=='GET'&&req.method!=='POST')throw fail('Método inválido',405);
    const actor=await requireIdentity(req);
    if(req.method==='POST'||actor.engineer===true)await requireIdentity(req,{engineer:true});
    const root=getFirebaseAdmin().db.ref('erpHelp/articles');
    if(req.method==='GET'){
      const editor=actor.engineer===true&&actor.erpUser==='engadministrator';
      // Retorno público somente de artigos publicados, sem dados de autor sensíveis.
      const all=list((await root.get()).val()).filter(a=>a&&typeof a==='object');
      return res.status(200).json({articles:all.filter(a=>editor||a.status==='published')
        .map(a=>({...a,createdBy:editor?a.createdBy:undefined,updatedBy:editor?a.updatedBy:undefined}))
        .sort((a,b)=>String(a.title).localeCompare(String(b.title),'pt-BR')),editor});
    }
    assertSameOrigin(req,{required:true}); assertJsonBody(req,{maxBytes:24000});
    const b=req.body,action=String(b.action||'');
    if(!['save','delete'].includes(action))throw fail('Ação inválida.');
    const id=b.id?validateArticleId(b.id):newArticleId();
    if(action==='delete'&&!b.id)throw fail('Selecione o artigo.');
    const ref=root.child(id);
    const expected=Number(b.revision||0);
    if(!Number.isSafeInteger(expected)||expected<0)throw fail('Revisão inválida.');
    const doc=action==='save'?validateArticle(b.article):null;
    let conflict=false,notFound=false;
    const outcome=await ref.transaction(current=>{
      if(action==='delete'){
        if(!current){notFound=true;return;}
        if(current.revision!==expected){conflict=true;return;}
        return null;
      }
      if(!current && b.id){notFound=true;return;}
      if(current&&current.revision!==expected){conflict=true;return;}
      const now=Date.now();
      return {...doc,id,revision:(current?.revision||0)+1,createdAt:current?.createdAt||now,createdBy:current?.createdBy||actor.erpUser,
        updatedAt:now,updatedBy:actor.erpUser};
    },undefined,false);
    if(!outcome.committed){if(conflict)assertRevision({revision:-1},expected);throw fail(notFound?'Artigo não encontrado.':'Não foi possível atualizar o artigo.',notFound?404:409);}
    try{await new AuditRepository().record({actorUid:actor.uid,actorLogin:actor.erpUser,action:action==='delete'?'help_deleted':'help_saved',module:'help_center',entityType:'article',entityId:id});}
    catch(err){console.error('Help article saved, audit failed:',err?.code||'audit_failure');}
    return res.status(200).json({ok:true,id,article:outcome.snapshot.val()});
  }catch(e){return sendError(res,e);}
}
