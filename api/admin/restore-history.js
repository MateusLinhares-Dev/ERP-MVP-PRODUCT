import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/http/http.js';

export default async function handler(req,res){
  applyApiSecurityHeaders(res,req)
  try{
    assertMethod(req,'GET');
    const user=await requireIdentity(req,{admin:true});
    if(user.erpUser!=='elaine'){const e=new Error('Histórico de restauração restrito à Elaine.');e.status=403;throw e;}
    const {db}=getFirebaseAdmin();

    const actions=new Set(['snapshot-restored','manual-database-backup-imported']);
    const snap=await db.ref('erpAudit').limitToLast(250).get();
    const records=Object.entries(snap.val()||{})
      .map(([id,row])=>({id,...row}))
      .filter(row=>actions.has(String(row.action||'')))
      .sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,30)
      .map(x=>({at:String(x.at||''),action:x.action,actorLogin:String(x.actorLogin||''),snapshotKey:String(x.snapshotKey||''),emergencyKey:String(x.emergencyKey||'')}));
    return res.status(200).json({records});
  }catch(e){return sendError(res,e);}
}
