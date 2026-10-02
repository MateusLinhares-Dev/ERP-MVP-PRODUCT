import '../../server/config/load-local-env.js';
import { getFirebaseAdmin } from '../../server/infrastructure/firebase-admin.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders, assertJsonBody, assertMethod, assertSameOrigin, sendError } from '../../server/http/http.js';
import {createSnapshot,restoreSnapshot,isValidSnapshotKey,BUSINESS_SNAPSHOT_NODES} from '../../server/application/snapshot-service.js';
export default async function handler(req,res){
  applyApiSecurityHeaders(res);
  try{
    assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:1536});
    const session=await requireIdentity(req,{admin:true});
    if(session.erpUser!=='elaine'){const e=new Error('A restauração fica restrita à Elaine.');e.status=403;throw e;}
    const {db}=getFirebaseAdmin();
    const action=String(req.body.action||'');
    if(action==='snapshot'){
      const key=String(req.body.key||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(key)&&!/^manual-\d{13}$/.test(key)){const e=new Error('Data inválida.');e.status=400;throw e;}
      return res.status(200).json(await createSnapshot(db,{key,operator:session.erpUser}));
    }
    if(action==='restore'){
      const key=String(req.body.key||'');
      if(!isValidSnapshotKey(key)||req.body.confirmation!=='RESTAURAR'){
        const e=new Error('Confirmação ou identificador inválido.');e.status=400;throw e;
      }
      const result=await restoreSnapshot(db,{key,operator:session.erpUser});
      return res.status(200).json({ok:true,...result,restoredNodes:BUSINESS_SNAPSHOT_NODES.length});
    }
    const e=new Error('Ação inválida.');e.status=400;throw e;
  }catch(error){return sendError(res,error);}
}
