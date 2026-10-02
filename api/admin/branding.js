import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';
const fields=['nome','razaoSocial','cnpj','ie','endereco','enderecoCurto','financeiro','escritorio','compras','email','responsavel'];
const brandFields=['logoPrefix','logoAccent','tagline','title'];
function clean(raw,keys){
  const out={};for(const key of keys){
    const v=raw?.[key];if(typeof v!=='string'||v.length>256||/[\u0000-\u001f<>]/.test(v)){
      const e=new Error('Campo inválido: '+key);e.status=400;throw e;
    }
    out[key]=v.trim();
  }
  return out;
}
export default async function handler(req,res){
  applyApiSecurityHeaders(res);
  try{
    assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:4608});
    const session=await requireIdentity(req,{admin:true});
    if(session.erpUser!=='elaine'){const e=new Error('Somente Elaine pode alterar os dados institucionais.');e.status=403;throw e;}
    const {db}=getFirebaseAdmin();
    const cfg=(await db.ref('erp/config').get()).val()||{};
    const companies=cfg.companies||{};
    const primary=cfg.primaryCompanyKey||Object.keys(companies)[0];
    if(!primary||!companies[primary]){const e=new Error('Empresa principal não configurada no Firebase.');e.status=409;throw e;}
    const company={...companies[primary],...clean(req.body.company,fields)};
    const branding={...(cfg.branding||{}),...clean(req.body.branding,brandFields)};
    if(!company.nome||!company.razaoSocial){const e=new Error('Informe o nome fantasia e a razão social.');e.status=400;throw e;}
    await db.ref('erp/config').update({[`companies/${primary}`]:company,branding});
    await db.ref('erpAudit').push({action:'company-branding-updated',module:'config',actorLogin:session.erpUser,at:new Date().toISOString()});
    return res.status(200).json({ok:true});
  }catch(e){return sendError(res,e);}
}
