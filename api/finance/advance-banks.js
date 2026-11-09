import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/shared/http/http.js';
import {listAdvanceBankOptions} from '../../server/modules/advances/application/advances.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');
    const identity=await requireIdentity(req);
    return res.status(200).json(await listAdvanceBankOptions(identity));
  }catch(error){return sendError(res,error);}
}
