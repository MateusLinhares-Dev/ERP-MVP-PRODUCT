import '../../server/config/load-local-env.js';
import { authenticateUser } from '../../server/application/authenticate-user.js';
import { applyApiSecurityHeaders, assertJsonBody, assertMethod, assertSameOrigin, clientIp, sendError } from '../../server/http/http.js';
import {
  setRequestActor,
} from '../../server/observability/logger.js';

export default async function handler(req, res) {
  try {
    applyApiSecurityHeaders(res,req); assertMethod(req,'POST'); assertSameOrigin(req,{required:true}); assertJsonBody(req,{maxBytes:2048});
    const password=String(req.body?.password||'');
    if(!password || password.length>128){ const e=new Error('Credencial inválida.');e.status=400;throw e; }
    const result=await authenticateUser({password,ip:clientIp(req)});

    setRequestActor(
      req,
      result.username,
    );
    
    return res.status(200).json(result);
  } catch(error){ return sendError(res,error); }
}
