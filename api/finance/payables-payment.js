import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/http/http.js';
import {payPayable} from '../../server/application/finance-payment.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:16384});
    const identity=await requireIdentity(req);
    return res.status(200).json(await payPayable(identity,req.body));
  }catch(error){return sendError(res,error);}
}
