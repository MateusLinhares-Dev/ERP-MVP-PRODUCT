import '../../server/config/load-local-env.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertMethod,assertSameOrigin,assertJsonBody,sendError} from '../../server/http/http.js';
import {uploadQuickAttachment,readQuickAttachment} from '../../server/application/quick-entry.js';

// POST: envia foto/PDF (base64, até 3 MB). GET ?dono=&id=: devolve o arquivo ao usuário autorizado.
export default async function handler(req,res){
  try{
    applyApiSecurityHeaders(res,req);
    if(req.method==='GET'){
      assertSameOrigin(req);
      const identity=await requireIdentity(req);
      const file=await readQuickAttachment(identity,{dono:req.query?.dono,id:req.query?.id});
      res.setHeader('Content-Type',file.tipo);
      res.setHeader('Content-Disposition','inline; filename="'+encodeURIComponent(file.nome)+'"');
      return res.status(200).send(file.buffer);
    }
    assertMethod(req,'POST');assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:4400000});
    const identity=await requireIdentity(req);
    return res.status(200).json(await uploadQuickAttachment(identity,req.body));
  }catch(error){return sendError(res,error);}
}
