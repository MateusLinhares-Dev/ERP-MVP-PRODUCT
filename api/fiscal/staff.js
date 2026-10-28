import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders, assertMethod, sendError} from '../../server/http/http.js';
import {fiscalStaffPublicView} from '../../server/domain/fiscal-staff.js';

export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  res.setHeader('Cache-Control','no-store');
  try{
    assertMethod(req,'GET');
    const identity=await requireIdentity(req);
    if(identity.canPayroll!==true){
      const error=new Error('Acesso reservado à Folha de Pagamento.');
      error.status=403;
      throw error;
    }
    const {db}=getFirebaseAdmin();
    const snapshot=await db.ref('erp/funcEdit').get();
    return res.status(200).json({staff:fiscalStaffPublicView(snapshot.val())});
  }catch(error){return sendError(res,error);}
}
