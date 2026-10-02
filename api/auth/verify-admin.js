import '../../server/config/load-local-env.js';
import { requireIdentity } from '../../server/http/auth.js';
import { FirebaseUserRepository } from '../../server/infrastructure/user-repository.js';
import { verifyPassword } from '../../server/infrastructure/password-hasher.js';
import { applyApiSecurityHeaders, assertJsonBody, assertMethod, assertSameOrigin, sendError } from '../../server/http/http.js';
export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res); assertMethod(req,'POST'); assertSameOrigin(req,{required:true}); assertJsonBody(req,{maxBytes:2048}); await requireIdentity(req);
    const password=String(req.body?.password||'');
    const all=await new FirebaseUserRepository().listSecureUsers();
    const adminEntry=Object.entries(all).find(([,record])=>record?.admin===true && record?.active!==false);
    if(!adminEntry || !(await verifyPassword(password,adminEntry[1].passwordHash))){const e=new Error('Senha incorreta.');e.status=401;throw e;}
    return res.status(200).json({ok:true});
  }catch(error){return sendError(res,error);}
}
