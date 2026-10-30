import '../../server/config/load-local-env.js';
import { getFirebaseAdmin } from '../../server/infrastructure/firebase-admin.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders, assertJsonBody, assertSameOrigin, sendError } from '../../server/http/http.js';
import { validateArticle,validateArticleId,newArticleId } from '../../server/domain/help-article.js';
import { firebaseArticleTransport, mutateHelpArticle } from '../../server/application/help-article-mutation.js';
import { AuditRepository } from '../../server/infrastructure/audit-repository.js';
const fail=(message,status=400,code='HELP_ERROR')=>Object.assign(new Error(message),{status,code});
const list=v=>Object.entries(v&&typeof v==='object'&&!Array.isArray(v)?v:{}).map(([id,a])=>({...(a||{}),id}));
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
    const expected=Number(b.revision||0);
    if(!Number.isSafeInteger(expected)||expected<0)throw fail('Revisão inválida.');
    const doc=action==='save'?validateArticle(b.article):null;
    const transport=await firebaseArticleTransport({
      app:getFirebaseAdmin().app,projectId:process.env.FIREBASE_PROJECT_ID,
      databaseUrl:process.env.FIREBASE_DATABASE_URL
    });
    const result=await mutateHelpArticle(transport,{action,id,existing:!!b.id,revision:expected,article:doc,actor:actor.erpUser});
    if(result.outcome==='conflict')throw fail('Este artigo foi alterado em outra sessão. Atualize a lista para continuar.',409,'REVISION_CONFLICT');
    if(result.outcome==='not_found')throw fail('O artigo realmente não existe no Firebase. Atualize a lista e selecione novamente.',404,'ARTICLE_NOT_FOUND');
    try{await new AuditRepository().record({actorUid:actor.uid,actorLogin:actor.erpUser,action:action==='delete'?'help_deleted':'help_saved',module:'help_center',entityType:'article',entityId:id});}
    catch(err){console.error('Help article saved, audit failed:',err?.code||'audit_failure');}
    return res.status(200).json({ok:true,id,article:result.article});
  }catch(e){return sendError(res,e);}
}
