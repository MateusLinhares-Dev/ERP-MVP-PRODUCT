import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/shared/http/http.js';
import {executeReconciliation} from '../../server/modules/banking/application/reconciliation.js';
export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);assertMethod(req,'POST');assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:32768});const identity=await requireIdentity(req);
    const result=await executeReconciliation(identity,req.body||{});
    return res.status(200).json(result);
  }catch(e){return sendError(res,e);}
}
