import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/shared/http/http.js';
import {listAdvanceCheques} from '../../server/modules/advances/application/advances.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');
    const identity=await requireIdentity(req);
    res.setHeader('Cache-Control','no-store, private');
    return res.status(200).json(await listAdvanceCheques(identity));
  }catch(error){return sendError(res,error);}
}
