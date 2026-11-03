import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/http/http.js';
import {listAdvanceBankOptions} from '../../server/application/finance-advances.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');
    const identity=await requireIdentity(req);
    return res.status(200).json(await listAdvanceBankOptions(identity));
  }catch(error){return sendError(res,error);}
}
