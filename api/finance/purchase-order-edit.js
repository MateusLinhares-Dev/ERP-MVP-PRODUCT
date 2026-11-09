import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/shared/http/http.js';
import {editPurchaseOrder} from '../../server/modules/purchases/application/edit-purchase-order.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:131072});
    const identity=await requireIdentity(req);
    return res.status(200).json(await editPurchaseOrder(identity,req.body));
  }catch(error){return sendError(res,error);}
}
