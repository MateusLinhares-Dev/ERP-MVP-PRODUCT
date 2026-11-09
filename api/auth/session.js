import '../../server/shared/config/load-local-env.js';
import { requireIdentity } from '../../server/shared/http/auth.js';
import { FirebaseUserRepository } from '../../server/modules/access/infrastructure/user-repository.js';
import { applyApiSecurityHeaders, assertMethod, sendError } from '../../server/shared/http/http.js';
export default async function handler(req,res){
  try{ applyApiSecurityHeaders(res,req); assertMethod(req,'GET'); const identity=await requireIdentity(req);if(identity.engineer===true)await requireIdentity(req,{engineer:true}); const profile=await new FirebaseUserRepository().getProfile(identity.erpUser); if(!profile){const e=new Error('Usuário não encontrado.');e.status=404;throw e;} return res.status(200).json({username:identity.erpUser,profile:{...profile,admin:identity.admin===true,engineer:identity.engineer===true&&identity.erpUser==='engadministrator'}}); }
  catch(error){return sendError(res,error);}
}
