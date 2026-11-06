import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/http/http.js';
import {createPurchaseOrder} from '../../server/application/purchase-order-create.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:131072});
    const identity=await requireIdentity(req);
    return res.status(200).json(await createPurchaseOrder(identity,req.body));
  }catch(error){return sendError(res,error);}
}
