import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';

const fields=['nome','razaoSocial','cnpj','ie','endereco','enderecoCurto','financeiro','escritorio','compras','email','responsavel'];
const brandFields=['logoPrefix','logoAccent','tagline','title'];

function clean(raw,keys){
  const out={};
  for(const key of keys){
    const v=raw?.[key];
    if(typeof v!=='string'||v.length>256||/[\u0000-\u001f<>]/.test(v)){
      const e=new Error('Campo inválido: '+key);
      e.status=400;
      throw e;
    }
    out[key]=v.trim();
  }
  return out;
}

function companyKey(company){
  return String(company?.nome||company?.razaoSocial||'').trim().slice(0,120);
}

export default async function handler(req,res){
  applyApiSecurityHeaders(res,req)
  try{
    assertMethod(req,'POST');
    assertSameOrigin(req,{required:true});
    assertJsonBody(req,{maxBytes:4608});
    const session=await requireIdentity(req,{admin:true});
    if(session.erpUser!=='elaine'){
      const e=new Error('Somente Elaine pode alterar os dados institucionais.');
      e.status=403;
      throw e;
    }
    const companyInput=clean(req.body.company,fields);
    const brandingInput=clean(req.body.branding,brandFields);
    if(!companyInput.nome||!companyInput.razaoSocial){
      const e=new Error('Informe o nome fantasia e a razão social.');
      e.status=400;
      throw e;
    }
    const {db}=getFirebaseAdmin();
    const cfg=(await db.ref('erp/config').get()).val()||{};
    const companies=cfg.companies&&typeof cfg.companies==='object'?cfg.companies:{};
    const primary=String(cfg.primaryCompanyKey||Object.keys(companies)[0]||companyKey(companyInput)).trim();
    if(!primary){
      const e=new Error('Não foi possível definir a empresa principal.');
      e.status=409;
      throw e;
    }
    const company={...(companies[primary]||{}),...companyInput};
    const branding={...(cfg.branding||{}),...brandingInput};
    const updates={
      primaryCompanyKey:primary,
      [`companies/${primary}`]:company,
      branding
    };
    await db.ref('erp/config').update(updates);
    await db.ref('erpAudit').push({
      action:'company-branding-updated',
      module:'config',
      actorLogin:session.erpUser,
      at:new Date().toISOString()
    });
    return res.status(200).json({ok:true});
  }catch(e){
    return sendError(res,e);
  }
}
