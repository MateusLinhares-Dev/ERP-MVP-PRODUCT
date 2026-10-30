import '../../server/config/load-local-env.js';
import { getFirebaseAdmin } from '../../server/infrastructure/firebase-admin.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders, assertJsonBody, assertSameOrigin, sendError } from '../../server/http/http.js';
import { agendaServiceCatalog, normalizeAgendaServiceName, validateAgendaServiceId, mutateAgendaServiceCatalog } from '../../server/domain/agenda-service-catalog.js';
import { AuditRepository } from '../../server/infrastructure/audit-repository.js';
export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  try{
    if(req.method!=='GET'&&req.method!=='POST')throw Object.assign(new Error('Método não permitido.'),{status:405});
    const actor=await requireIdentity(req);
    if(!actor.canDeliveryAgenda&&!actor.canCoordination&&!actor.admin)throw Object.assign(new Error('Sem acesso à Agenda de Entregas.'),{status:403,code:'AGENDA_FORBIDDEN'});
    const root=getFirebaseAdmin().db.ref('erpAgendaServices/catalog');
    if(req.method==='GET')return res.status(200).json({services:agendaServiceCatalog((await root.get()).val())});
    assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:2048});
    const action=String(req.body.action||'');
    if(action!=='add'&&action!=='delete')throw Object.assign(new Error('Ação inválida.'),{status:400});
    const name=action==='add'?normalizeAgendaServiceName(req.body.name):null;
    const id=action==='delete'?validateAgendaServiceId(req.body.id):null;
    const result=await mutateAgendaServiceCatalog(root,{action,name,id,actor:actor.erpUser});
    if(result.changed){
      try{await new AuditRepository().record({actorUid:actor.uid,actorLogin:actor.erpUser,action:action==='add'?'agenda_service_created':'agenda_service_deleted',module:'agenda_entregas',entityType:'service',entityId:id||name});}
      catch(err){console.error('Agenda service audit failed:',err?.code||'audit_failure');}
    }
    return res.status(200).json({ok:true,changed:result.changed,services:result.items});
  }catch(e){return sendError(res,e);}
}
