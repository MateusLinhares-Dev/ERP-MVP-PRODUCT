import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {getCompanyDirectory,transactCompanyDirectory,companyDirectoryResponse} from '../../server/domain/company-directory.js';
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
  res.setHeader('Cache-Control','no-store, max-age=0');
  try{
    if(req.method==='GET'){
      await requireIdentity(req,{admin:true});
      const {db}=getFirebaseAdmin();
      return res.status(200).json(companyDirectoryResponse(await getCompanyDirectory(db)));
    }
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:512});
    const actor=await requireIdentity(req,{admin:true});
    const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
    const action=String(req.body?.action||'create');
    const expectedRevision=req.body?.expectedRevision;
    if(!name||name.length>80||/[<>\u0000-\u001f]/.test(name)||!['create','delete'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0){
      const error=new Error('Informe nome, operação e versão válidos.');error.status=400;throw error;
    }
    const {db}=getFirebaseAdmin();
    const ref=db.ref('erp/companyDirectory');
    const result=await transactCompanyDirectory(db,ref,action,name,expectedRevision);
    if(!result.committed){
      const latest=await getCompanyDirectory(db);
      const changed=latest.revision!==expectedRevision;
      const registered=latest.companies.some(item=>companyKey(item)===companyKey(name));
      const error=new Error(changed?'O cadastro foi atualizado em outra sessão. A lista será recarregada.':action==='create'&&registered?'Esta empresa já está cadastrada.':action==='delete'&&!registered?'Esta empresa já não está no cadastro.':'A operação não foi aceita pelo cadastro de empresas.');
      error.status=409;
      error.code=changed?'COMPANY_REVISION_CONFLICT':'COMPANY_OPERATION_CONFLICT';
      throw error;
    }
    const state=result.snapshot.val();
    try{await db.ref('erpAudit').push({action:'company-'+action,module:'companyDirectory',actorLogin:actor.erpUser,company:name,revision:state.revision,at:new Date().toISOString()});}catch(error){console.error('Falha ao registrar auditoria de empresa',error);}
    return res.status(200).json(companyDirectoryResponse(state));
  }catch(error){return sendError(res,error);}
}
