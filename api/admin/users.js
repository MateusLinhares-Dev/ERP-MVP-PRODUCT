import '../../server/config/load-local-env.js';
import { manageUser } from '../../server/application/manage-user.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders, assertJsonBody, assertMethod, assertSameOrigin, clientIp, sendError } from '../../server/http/http.js';
import { AuditRepository } from '../../server/infrastructure/audit-repository.js';
export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST'); assertSameOrigin(req,{required:true}); assertJsonBody(req,{maxBytes:32768});
    const identity=await requireIdentity(req,{admin:true});
    const input=req.body||{};
    const result=await manageUser(input);
    try{ await new AuditRepository().record({actorUid:identity.uid,actorLogin:identity.erpUser,action:'user_'+String(input.action||'unknown'),module:'usuarios',entityType:'usuario',entityId:result?.login||String(input.login||''),ip:clientIp(req)}); }catch(_){}
    return res.status(200).json(result);
  }
  catch(error){return sendError(res,error);}
}
