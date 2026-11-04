import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';

export function normalizeEmployeeCompanies(values){
  const out=[];
  const seen=new Set();
  for(const value of Array.isArray(values)?values:[]){
    const name=String(value||'').trim().replace(/\s+/g,' ');
    const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(name&&!seen.has(key)){seen.add(key);out.push(name);}
  }
  return out;
}

export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  try{
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:512});
    await requireIdentity(req,{admin:true});
    const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
    if(!name||name.length>80||/[<>\u0000-\u001f]/.test(name)){
      const error=new Error('Informe um nome de empresa válido, com até 80 caracteres.');error.status=400;throw error;
    }
    const {db}=getFirebaseAdmin();
    const ref=db.ref('erp/config/employeeCompanies');
    const result=await ref.transaction(current=>{
      const list=normalizeEmployeeCompanies(current);
      if(list.length>=100&&!list.some(item=>item.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))return;
      return normalizeEmployeeCompanies([...list,name]);
    });
    if(!result.committed){const error=new Error('Limite de empresas atingido.');error.status=409;throw error;}
    return res.status(200).json({ok:true,companies:normalizeEmployeeCompanies(result.snapshot.val())});
  }catch(error){return sendError(res,error);}
}
