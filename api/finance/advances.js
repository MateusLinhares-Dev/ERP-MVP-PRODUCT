import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/shared/http/http.js';
import {createAdvance} from '../../server/modules/advances/application/advances.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:65536});
    const identity=await requireIdentity(req);
    return res.status(200).json(await createAdvance(identity,req.body));
  }catch(error){return sendError(res,error);}
}
