import '../../server/config/load-local-env.js';
import { requireIdentity } from '../../server/http/auth.js';
import { FirebaseUserRepository } from '../../server/infrastructure/user-repository.js';
import { applyApiSecurityHeaders, assertMethod, sendError } from '../../server/http/http.js';
export default async function handler(req,res){
  try{ applyApiSecurityHeaders(res); assertMethod(req,'GET'); const identity=await requireIdentity(req); const profile=await new FirebaseUserRepository().getProfile(identity.erpUser); if(!profile){const e=new Error('Usuário não encontrado.');e.status=404;throw e;} return res.status(200).json({username:identity.erpUser,profile:{...profile,admin:identity.admin===true}}); }
  catch(error){return sendError(res,error);}
}
