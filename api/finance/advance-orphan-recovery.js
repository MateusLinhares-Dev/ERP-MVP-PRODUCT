import '../../server/shared/config/load-local-env.js';
import {requireIdentity} from '../../server/shared/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/shared/http/http.js';
import {previewOrphanAdvance,recoverOrphanAdvance,recordVerifiedOrphanTransfer} from '../../server/modules/advances/application/orphan-recovery.js';

export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:4096});
    const identity=await requireIdentity(req);
    const action=req.body?.action;
    if(action==='preview')return res.status(200).json(await previewOrphanAdvance(identity,req.body));
    if(action==='confirm')return res.status(200).json(await recoverOrphanAdvance(identity,req.body));
    if(action==='record-bank-transfer')return res.status(200).json(await recordVerifiedOrphanTransfer(identity,req.body));
    const error=new Error('Ação desconhecida.');error.status=422;error.code='INVALID_ACTION';throw error;
  }catch(error){return sendError(res,error);}
}
