import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';

function companyKey(value){
  const key=String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  return key==='gratus metais'?'gratus':key==='manuela metais'?'manuela':key;
}
export function normalizeEmployeeCompanies(values){
  const out=[],seen=new Set();
  for(const value of Array.isArray(values)?values:[]){
    const name=String(value||'').trim().replace(/\s+/g,' '),key=companyKey(name);
    if(name&&!seen.has(key)){seen.add(key);out.push(name);}
  }
  return out;
}
export function changeCompanyConfig(current,action,name,expectedRevision){
  const cfg=current&&typeof current==='object'&&!Array.isArray(current)?{...current}:{};
  const key=companyKey(name);
  const currentRevision=Number(cfg.companyDirectoryRevision)||0;
  if(expectedRevision!==undefined&&currentRevision!==expectedRevision)return null;
  const companies=normalizeEmployeeCompanies(cfg.employeeCompanies);
  const inactive=normalizeEmployeeCompanies(cfg.inactiveCompanies);
  const deleted=normalizeEmployeeCompanies(cfg.deletedCompanies);
  const all=[...companies,...normalizeEmployeeCompanies(cfg.expenseGroups),...normalizeEmployeeCompanies(cfg.financeCompanies),...normalizeEmployeeCompanies(cfg.transferCompanies),...normalizeEmployeeCompanies(cfg.chequeCompanies),...Object.keys(cfg.companies||{})];
  const exists=all.some(item=>companyKey(item)===key)||inactive.some(item=>companyKey(item)===key);
  if(action==='create'){
    if(deleted.some(item=>companyKey(item)===key))return null;
    const alreadyRegistered=companies.some(item=>companyKey(item)===key);
    if(!alreadyRegistered&&companies.length>=100)return null;
    if(!alreadyRegistered)companies.push(name);
    cfg.employeeCompanies=companies;
    cfg.inactiveCompanies=inactive.filter(item=>companyKey(item)!==key);
  }else if(action==='archive'){
    if(!exists)return null;
    if(companyKey(cfg.primaryCompanyKey)===key)return null;
    if(!inactive.some(item=>companyKey(item)===key))inactive.push(name);
    cfg.inactiveCompanies=inactive;
  }else if(action==='restore'){
    if(!exists||deleted.some(item=>companyKey(item)===key))return null;
    cfg.inactiveCompanies=inactive.filter(item=>companyKey(item)!==key);
  }else if(action==='delete'){
    if(!exists||companyKey(cfg.primaryCompanyKey)===key||deleted.some(item=>companyKey(item)===key))return null;
    for(const field of ['employeeCompanies','expenseGroups','financeCompanies','transferCompanies','chequeCompanies']){
      if(Array.isArray(cfg[field]))cfg[field]=cfg[field].filter(item=>companyKey(item)!==key);
    }
    cfg.inactiveCompanies=inactive.filter(item=>companyKey(item)!==key);
    if(cfg.expenseGroupCompanyMap&&typeof cfg.expenseGroupCompanyMap==='object'){
      cfg.expenseGroupCompanyMap=Object.fromEntries(Object.entries(cfg.expenseGroupCompanyMap).filter(([k,v])=>companyKey(k)!==key&&companyKey(v)!==key));
    }
    cfg.deletedCompanies=[...deleted,name];
  }else return null;
  cfg.companyDirectoryRevision=(Number.isSafeInteger(Number(cfg.companyDirectoryRevision))&&Number(cfg.companyDirectoryRevision)>=0?Number(cfg.companyDirectoryRevision):0)+1;
  return cfg;
}
export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method==='GET'){
      await requireIdentity(req,{admin:true});
      const {db}=getFirebaseAdmin();
      const cfg=(await db.ref('erp/config').get()).val()||{};
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ok:true,companies:normalizeEmployeeCompanies(cfg.employeeCompanies),inactiveCompanies:normalizeEmployeeCompanies(cfg.inactiveCompanies),deletedCompanies:normalizeEmployeeCompanies(cfg.deletedCompanies),revision:Number(cfg.companyDirectoryRevision)||0,apiVersion:2});
    }
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:512});
    const actor=await requireIdentity(req,{admin:true});
    const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
    const action=String(req.body?.action||'create');
    if(!name||name.length>80||/[<>\u0000-\u001f]/.test(name)||!['create','archive','restore','delete'].includes(action)){
      const error=new Error('Informe uma empresa e uma operação válidas.');error.status=400;throw error;
    }
    const expectedRevision=req.body?.expectedRevision;
    if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)){
      const error=new Error('Versão do cadastro inválida.');error.status=400;throw error;
    }
    const {db}=getFirebaseAdmin();
    const result=await db.ref('erp/config').transaction(current=>changeCompanyConfig(current,action,name,expectedRevision));
    if(!result.committed){const error=new Error('O cadastro foi alterado em outra sessão ou a empresa já foi excluída. A lista será atualizada; confira e tente novamente.');error.status=409;throw error;}
    const cfg=result.snapshot.val()||{};
    try{await db.ref('erpAudit').push({action:'company-'+action,module:'config',actorLogin:actor.erpUser,company:name,at:new Date().toISOString()});}catch(error){console.error('Falha ao registrar auditoria de empresa',error);}
    return res.status(200).json({ok:true,companies:normalizeEmployeeCompanies(cfg.employeeCompanies),inactiveCompanies:normalizeEmployeeCompanies(cfg.inactiveCompanies),deletedCompanies:normalizeEmployeeCompanies(cfg.deletedCompanies),revision:Number(cfg.companyDirectoryRevision)||0,apiVersion:2});
  }catch(error){return sendError(res,error);}
}
