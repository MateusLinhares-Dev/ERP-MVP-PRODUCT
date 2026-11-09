import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';
import {quickEntryOptions} from '../../server/application/quick-entry.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');assertSameOrigin(req);
    const identity=await requireIdentity(req);
    return res.status(200).json(await quickEntryOptions(identity));
  }catch(error){return sendError(res,error);}
}
