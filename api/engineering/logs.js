import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,sendError} from '../../server/http/http.js';
const str=(v,max=120)=>String(v||'').trim().slice(0,max);
export default async function handler(req,res){
 applyApiSecurityHeaders(res,req);
 try{
  assertMethod(req,'GET'); await requireIdentity(req,{engineer:true});
  const q=req.query||{};
  const size=Math.min(100,Math.max(10,Number.parseInt(q.limit,10)||50));
  const limit=Math.min(300,Math.max(size,size*3));
  const cursor=/^[A-Za-z0-9_-]{4,120}$/.test(String(q.cursor||''))?q.cursor:null;
  const root=getFirebaseAdmin().db.ref('erpAudit');
  let query=root.orderByKey();
  if(cursor)query=query.endAt(cursor);
  const values=(await query.limitToLast(limit+(cursor?2:1)).get()).val()||{};
  let pairs=Object.entries(values).sort(([a],[b])=>b.localeCompare(a));
  if(cursor)pairs=pairs.filter(([id])=>id<cursor);
  const hasMore=pairs.length>limit;
  const page=pairs.slice(0,limit);
  const module=str(q.module,64).toLowerCase(),level=str(q.level,20).toLowerCase(),actor=str(q.actor,80).toLowerCase(),term=str(q.term,80).toLowerCase();
  const from=Number(q.from||0),to=Number(q.to||0);
  const filtered=page.filter(([id,e])=>{
    if(!e||typeof e!=='object')return false;
    const name=str(e.module,64).toLowerCase(),user=str(e.actorLogin,80).toLowerCase();
    const sev=str(e.level|| (e.outcome==='failed'?'error':'info'),20).toLowerCase();
    const timestamp=typeof e.ts==='number'?e.ts:Date.parse(e.at||e.ts||'')||0;
    if(module && !name.includes(module))return false;
    if(level && sev!==level)return false;
    if(actor && !user.includes(actor))return false;
    if(Number.isFinite(from)&&from>0&&timestamp<from)return false;
    if(Number.isFinite(to)&&to>0&&timestamp>to)return false;
    return !term || [e.action,e.entityType,e.entityId,e.scope,e.code,e.module,e.event].some(v=>str(v,240).toLowerCase().includes(term));
  }).slice(0,size).map(([id,e])=>({id,ts:e.ts||e.at||0,actorLogin:str(e.actorLogin,80),module:str(e.module,64),action:str(e.action,64),
    entityType:str(e.entityType,64),entityId:str(e.entityId,128),scope:str(e.scope,240),source:str(e.source,32),level:str(e.level|| (e.outcome==='failed'?'error':'info'),16),outcome:str(e.outcome||'success',32),code:str(e.code,80)}));
  return res.status(200).json({events:filtered,nextCursor:hasMore?page[page.length-1][0]:null,scanned:page.length,limit:size,filterApplied:!!(module||level||actor||term||from||to)});
 }catch(e){return sendError(res,e);}
}
