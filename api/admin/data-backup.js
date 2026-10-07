import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertJsonBody,assertMethod,assertSameOrigin,sendError} from '../../server/http/http.js';

export default async function handler(req,res){
  applyApiSecurityHeaders(res,req)
  try{
    assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:2500000});
    const identity=await requireIdentity(req,{admin:true});
    if(identity.erpUser!=='elaine'){const e=new Error('Apenas Elaine pode exportar/restaurar dados.');e.status=403;throw e;}
    const {db}=getFirebaseAdmin();
    if(Buffer.byteLength(JSON.stringify(req.body),'utf8')>2500000){const e=new Error('Arquivo excede o tamanho aceito pela interface.');e.status=413;throw e;}
    if(req.body.action==='export'){
      const erp=(await db.ref('erp').get()).val()||{};
      const payload={format:'MANUELA-ERP-RTDB',schema:1,exportedAt:new Date().toISOString(),
        note:'Banco de dados ERP somente. NÃO inclui arquivos binários do Firebase Storage nem credenciais do Firebase Authentication/erpAuth.',
        erp};
      const raw=JSON.stringify(payload);
      if(Buffer.byteLength(raw,'utf8')>3500000){const e=new Error('O banco ultrapassa o limite de exportação pela interface. Faça o backup de RTDB pelo console/infraestrutura; nenhum backup incompleto foi baixado.');e.status=413;throw e;}
      return res.status(200).json(payload);
    }
    if(req.body.action==='import'){
      if(req.body.confirmation!=='IMPORTAR'||req.body.backup?.format!=='MANUELA-ERP-RTDB'||req.body.backup?.schema!==1){
        const e=new Error('Formato ou confirmação inválidos.');e.status=400;throw e;
      }
      const data=req.body.backup.erp;
      if(!data||typeof data!=='object'||Array.isArray(data)){
        const e=new Error('Nó ERP ausente.');e.status=400;throw e;
      }
      const backupCurrent=(await db.ref('erp').get()).val()||{};
      const emergency='antes-importacao-'+Date.now();
      await db.ref('erpManualBackups/'+emergency).set({erp:backupCurrent,at:new Date().toISOString(),operator:identity.erpUser});
      const restored={...data,_appBuild:backupCurrent._appBuild||data._appBuild};
      await db.ref('erp').set(restored);
      try{await db.ref('erpAudit').push({action:'manual-database-backup-imported',actorLogin:identity.erpUser,module:'suporte_tecnico',at:new Date().toISOString(),emergencyKey:emergency});}catch(error){console.error('Audit failed AFTER successful import:',error);}
      return res.status(200).json({ok:true,emergencyKey:emergency});
    }
    const e=new Error('Ação inválida.');e.status=400;throw e;
  }catch(e){return sendError(res,e);}
}
