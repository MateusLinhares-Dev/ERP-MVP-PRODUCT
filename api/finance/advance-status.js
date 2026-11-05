import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';
import {getAdvanceOperationStatus} from '../../server/application/finance-advances.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'GET');
    assertSameOrigin(req);
    const identity=await requireIdentity(req);
    const query=req.query||{};
    return res.status(200).json(await getAdvanceOperationStatus(identity,{
      operationId:query.operationId,fornCod:query.fornCod
    }));
  }catch(error){return sendError(res,error);}
}
