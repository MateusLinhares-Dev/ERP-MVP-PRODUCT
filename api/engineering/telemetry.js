import '../../server/config/load-local-env.js';
import { getFirebaseAdmin } from '../../server/infrastructure/firebase-admin.js';
import { requireIdentity } from '../../server/http/auth.js';
import { applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError } from '../../server/http/http.js';
import { AuditRepository } from '../../server/infrastructure/audit-repository.js';
import { createHash } from 'node:crypto';
const clean=(x,n)=>String(x||'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n);
export default async function handler(req,res){
 applyApiSecurityHeaders(res,req);
 try{
  assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:4096});
  const user=await requireIdentity(req);
  const input=req.body||{};
  const allowed=['js_error','unhandled_rejection','api_failure','permission_denied'];
  if(!allowed.includes(input.kind))return res.status(400).json({code:'INVALID_EVENT',message:'Tipo de evento inválido.'});
  // Um único nó por usuário evita crescimento ilimitado do rate limiter.
  const ref=getFirebaseAdmin().db.ref('erpTelemetryRate').child(createHash('sha256').update(user.uid).digest('hex'));
  const now=Date.now();
  const tx=await ref.transaction(v=>{
    const start=Number(v?.start)||0;
    if(now-start>=60000||start>now)return {start:now,count:1};
    if(Number(v.count)>=12)return;
    return {start,count:Number(v.count||0)+1};
  },undefined,false);
  if(!tx.committed)return res.status(429).json({code:'LOG_RATE_LIMIT',message:'Limite de eventos atingido.'});
  // Não persistir stack, URL com query-string, mensagem bruta, corpo de requisição ou tokens.
  await new AuditRepository().record({actorUid:user.uid,actorLogin:user.erpUser,
    action:input.kind,module:clean(input.module,40)||'frontend',entityType:'error',
    entityId:clean(input.code,50),scope:clean(input.path,100),outcome:'failed'});
  return res.status(200).json({ok:true});
 }catch(e){return sendError(res,e);}
}
