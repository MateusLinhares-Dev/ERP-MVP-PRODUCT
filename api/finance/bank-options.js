import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/http/http.js';
import {listPaymentBanks} from '../../server/application/finance-payment.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');
    const identity=await requireIdentity(req);
    return res.status(200).json(await listPaymentBanks(identity));
  }catch(error){return sendError(res,error);}
}
