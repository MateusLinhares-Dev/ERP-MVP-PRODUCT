import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/shared/http/http.js';
import {listSupplierCashRepasses,summarizeSupplierCashRepasses,changeSupplierCashRepasse} from '../../server/modules/supplier-repasses/application/supplier-cash-repasses.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    const identity=await requireIdentity(req);
    if(req.method==='GET'){
      if(req.query?.scope==='summary')return res.status(200).json(await summarizeSupplierCashRepasses(identity));
      const fornCod=String(req.query?.fornCod||'');
      return res.status(200).json(await listSupplierCashRepasses(identity,fornCod));
    }
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:16384});
    return res.status(200).json(await changeSupplierCashRepasse(identity,req.body));
  }catch(error){return sendError(res,error);}
}
