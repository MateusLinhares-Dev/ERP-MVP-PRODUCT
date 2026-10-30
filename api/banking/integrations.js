import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/http/http.js';
import {handleBankIntegration} from '../../server/application/bank-integrations.js';
export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);assertMethod(req,'POST');assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:8192});
    const identity=await requireIdentity(req);
    return res.status(200).json(await handleBankIntegration(identity,req.body||{}));
  }catch(error){return sendError(res,error);}
}
