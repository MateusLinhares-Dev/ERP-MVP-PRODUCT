import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';

function companyKey(value){
  return String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
}
export function normalizeEmployeeCompanies(values){
  const out=[],seen=new Set();
  for(const value of Array.isArray(values)?values:[]){
    const name=String(value||'').trim().replace(/\s+/g,' '),key=companyKey(name);
    if(name&&!seen.has(key)){seen.add(key);out.push(name);}
  }
  return out;
}
export function changeCompanyConfig(current,action,name){
  const cfg=current&&typeof current==='object'&&!Array.isArray(current)?{...current}:{};
  const key=companyKey(name);
  const companies=normalizeEmployeeCompanies(cfg.employeeCompanies);
  const inactive=normalizeEmployeeCompanies(cfg.inactiveCompanies);
  const all=[...companies,...normalizeEmployeeCompanies(cfg.expenseGroups),...normalizeEmployeeCompanies(cfg.financeCompanies),...normalizeEmployeeCompanies(cfg.transferCompanies),...normalizeEmployeeCompanies(cfg.chequeCompanies),...Object.keys(cfg.companies||{})];
  const exists=all.some(item=>companyKey(item)===key);
  if(action==='create'){
    if(!exists&&companies.length>=100)return null;
    if(!exists)companies.push(name);
    cfg.employeeCompanies=companies;
    cfg.inactiveCompanies=inactive.filter(item=>companyKey(item)!==key);
  }else if(action==='archive'){
    if(!exists)return null;
    if(companyKey(cfg.primaryCompanyKey)===key)return null;
    if(!inactive.some(item=>companyKey(item)===key))inactive.push(name);
    cfg.inactiveCompanies=inactive;
  }else if(action==='restore'){
    if(!exists)return null;
    cfg.inactiveCompanies=inactive.filter(item=>companyKey(item)!==key);
  }else return null;
  return cfg;
}
export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  try{
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:512});
    const actor=await requireIdentity(req,{admin:true});
    const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
    const action=String(req.body?.action||'create');
    if(!name||name.length>80||/[<>\u0000-\u001f]/.test(name)||!['create','archive','restore'].includes(action)){
      const error=new Error('Informe uma empresa e uma operação válidas.');error.status=400;throw error;
    }
    const {db}=getFirebaseAdmin();
    const result=await db.ref('erp/config').transaction(current=>changeCompanyConfig(current,action,name));
    if(!result.committed){const error=new Error('Não foi possível alterar esta empresa. Verifique se é a empresa principal ou se o cadastro existe.');error.status=409;throw error;}
    const cfg=result.snapshot.val()||{};
    try{await db.ref('erpAudit').push({action:'company-'+action,module:'config',actorLogin:actor.erpUser,company:name,at:new Date().toISOString()});}catch(error){console.error('Falha ao registrar auditoria de empresa',error);}
    return res.status(200).json({ok:true,companies:normalizeEmployeeCompanies(cfg.employeeCompanies),inactiveCompanies:normalizeEmployeeCompanies(cfg.inactiveCompanies)});
  }catch(error){return sendError(res,error);}
}
