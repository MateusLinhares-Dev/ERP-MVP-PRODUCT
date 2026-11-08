import '../../server/config/load-local-env.js';
import {getFirebaseAdmin} from '../../server/infrastructure/firebase-admin.js';
import {runTransaction} from '../../server/infrastructure/rtdb-transaction.js';
import {loginFromStorageKey} from '../../server/domain/user.js';
import {requireIdentity} from '../../server/http/auth.js';
import {applyApiSecurityHeaders,assertSameOrigin,assertJsonBody,sendError} from '../../server/http/http.js';
import {safeId,coursePayload,enrollmentPayload,courseState,visibleNotice,textField,yearMonthDelta} from '../../server/domain/training.js';

const err=(message,status=400)=>Object.assign(new Error(message),{status,code:status===403?'TRAINING_FORBIDDEN':'TRAINING_ERROR'});
const manager=i=>i.admin===true&&(String(i.erpUser||'').toLowerCase()==='elaine'||(i.engineer===true&&i.erpUser==='engadministrator'));
const now=()=>new Date().toISOString();
const records=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
// Matrículas curtas (ex.: '1' ou 'F1') devem continuar válidas como chaves do ERP.
const employeeKey=mat=>{const v=String(mat??'').trim().replace(/[^A-Za-z0-9_-]/g,'');return v.length>=4?v:'EMP_'+v;};
const employeeRecords=value=>(Array.isArray(value)?value:Object.values(records(value))).filter(f=>f&&f.mat!=null&&String(f.mat).trim()&&f.nome);
const userRecords=value=>Object.entries(records(value)).map(([key,user])=>{
  if(!user||typeof user!=='object')return null;
  const login=String(user.login||user.profile?.login||loginFromStorageKey(key)).trim().toLowerCase();
  if(!/^[a-z0-9._@-]{1,80}$/.test(login))return null;
  return {login,name:String(user.profile?.name||user.name||login).slice(0,120)};
}).filter(Boolean);
function id(){return 'TM'+crypto.randomUUID().replace(/-/g,'').slice(0,24);}
export default async function handler(req,res){
  applyApiSecurityHeaders(res,req);
  try{
    if(!['GET','POST'].includes(req.method))throw err('Método não permitido.',405);
    const identity=await requireIdentity(req),isManager=manager(identity);
    const {db,storage}=getFirebaseAdmin(),root=db.ref('erpTraining');
    if(req.method==='GET'){
      if(req.query?.view==='mine'){
        const snapshot=await root.get(),v=records(snapshot.val());const courses=records(v.courses),enrollments=records(v.enrollments);
        const login=String(identity.erpUser||'').toLowerCase(),day=now().slice(0,10);
        const notices=Object.values(enrollments).filter(x=>x&&courses[x.courseId]&&visibleNotice(x,courses[x.courseId],login,day)).map(x=>({id:x.id,course:courses[x.courseId].title,scheduledAt:x.scheduledAt,expiresAt:courseState(x,courses[x.courseId],day).expiresAt,status:courseState(x,courses[x.courseId],day).displayStatus}));
        return res.status(200).json({notices});
      }
      if(!isManager)throw err('Gestão reservada à Elaine.',403);
      const [train,staff,usersSnap]=await Promise.all([root.get(),db.ref('erp/funcEdit').get(),db.ref('erpAuth/users').get()]);
      const v=records(train.val());
      const employees=employeeRecords(staff.val()).map(f=>({id:employeeKey(f.mat),name:String(f.nome).slice(0,120),mat:String(f.mat),active:f.ativo!==false&&!['inativo','desligado','demitido'].includes(String(f.status||'').toLowerCase())}));
      return res.status(200).json({courses:records(v.courses),enrollments:records(v.enrollments),documents:records(v.documents),employees,erpUsers:userRecords(usersSnap.val()),history: Object.values(records(v.audit)).slice(-120)});
    }
    assertSameOrigin(req,{required:true});assertJsonBody(req,{maxBytes:14000});
    if(!isManager)throw err('Somente Elaine pode alterar a matriz.',403);
    const b=req.body,action=String(b.action||''),who=String(identity.erpUser);
    let result={},auditKey=root.child('audit').push().key;
    const commit=async changes=>root.update({...changes,['audit/'+auditKey]:{action,recordId:result.id,actor:who,uid:identity.uid,createdAt:now()}});
    if(action==='course'){
      const v=coursePayload(b),key=b.id?safeId(b.id):id();
      // Editar um curso inativo não deve reativá-lo implicitamente.
      const original=b.id?(await root.child('courses/'+key).get()).val():null;
      if(b.id&&!original)throw err('Curso não encontrado para edição.',404);
      const duplicate=Object.values(records((await root.child('courses').get()).val())).some(c=>c&&c.id!==key&&String(c.title||'').trim().toLowerCase()===v.title.toLowerCase());
      if(duplicate)throw err('Este curso já está cadastrado. Use Editar no catálogo.',409);
      result={id:key};await commit({['courses/'+key]:{...v,active:original?original.active!==false:true,id:key,updatedAt:now(),updatedBy:who}});
    }else if(action==='enroll'){
      const entry=enrollmentPayload(b),key=b.id?safeId(b.id):id();
      const [courseSnap,employeeSnap,usersSnap,enrollSnap]=await Promise.all([root.child('courses/'+entry.courseId).get(),db.ref('erp/funcEdit').get(),db.ref('erpAuth/users').get(),root.child('enrollments').get()]);
      const course=courseSnap.val(),recordsNow=Object.values(records(enrollSnap.val()));
      const previous=b.id?records(enrollSnap.val())[key]:null;
      if(b.id&&!previous)throw err('Vínculo não encontrado para edição.',404);
      if(!course||(course.active===false&&(!previous||previous.courseId!==entry.courseId)))throw err('Curso não encontrado ou inativo.');
      if(!employeeRecords(employeeSnap.val()).some(f=>employeeKey(f.mat)===entry.employeeId))throw err('Funcionário não cadastrado no RH. Atualize a matriz e selecione novamente.');
      if(entry.notifyEnabled&&!entry.employeeLogin)throw err('Selecione o usuário do ERP que receberá o aviso ou desmarque os avisos.');
      if(entry.employeeLogin&&!userRecords(usersSnap.val()).some(u=>u.login===entry.employeeLogin))throw err('Usuário do ERP não encontrado para os avisos.');
      if(entry.status==='concluido'&&course.renewalMonths&&entry.completedAt&&!entry.expiresAt)entry.expiresAt=yearMonthDelta(entry.completedAt,course.renewalMonths);
      const duplicate=recordsNow.find(e=>e&&e.id!==key&&e.employeeId===entry.employeeId&&e.courseId===entry.courseId&&e.status!=='dispensado');
      if(duplicate&&!previous)throw err('Esse funcionário já possui vínculo ativo com este curso. Edite o vínculo existente ou exclua o duplicado.',409);
      // Transação de reserva protege duas sessões criando o mesmo par simultaneamente.
      const pairKey=entry.employeeId+'_'+entry.courseId;
      const lock=root.child('enrollmentLocks/'+pairKey);
      let reserved=false;
      if(!previous){
        const enrollmentsNow=records(enrollSnap.val());
        const tx=await runTransaction(lock,current=>{
          if(current===null||current===key)return key;
          // Índice órfão (vínculo excluído, dispensado ou movido para outro par)
          // não pode bloquear um novo cadastro do mesmo funcionário/curso.
          const holder=enrollmentsNow[String(current)];
          if(!holder||holder.status==='dispensado'||(String(holder.employeeId||'')+'_'+String(holder.courseId||''))!==pairKey)return key;
          return undefined;
        });
        if(!tx.committed)throw err('Já existe cadastro deste curso para o funcionário. Atualize a matriz.',409);
        reserved=true;
      }
      try{
        result={id:key};await commit({['enrollments/'+key]:{...entry,id:key,updatedAt:now(),updatedBy:who}});
      }catch(error){
        if(reserved)try{await runTransaction(lock,current=>current==null||current===key?null:undefined);}catch(_){console.warn('[Matriz] Liberação do índice após falha:',_?.message);}
        throw error;
      }
    }else if(action==='removeEnrollment'){
      const key=safeId(b.id),snapshot=await root.child('enrollments/'+key).get(),item=snapshot.val();
      if(!item)throw err('Vínculo não encontrado.',404);
      const documentSnap=await root.child('documents').get();
      if(Object.values(records(documentSnap.val())).some(d=>d&&d.enrollmentId===key))throw err('Esse vínculo possui certificado. Exclua o certificado primeiro ou mantenha o vínculo no histórico.',409);
      // Exclusão e limpeza do índice do par na MESMA gravação (antes a limpeza
      // abortava com cache frio e impedia recadastrar o mesmo curso).
      const pairPath='enrollmentLocks/'+item.employeeId+'_'+item.courseId;
      const indexed=(await root.child(pairPath).get()).val();
      result={id:key};await commit({['enrollments/'+key]:null,...(indexed===key?{[pairPath]:null}:{})});
    }else if(action==='activate'){
      const key=safeId(b.id),snapshot=await root.child('courses/'+key).get();
      if(!snapshot.exists())throw err('Curso não encontrado.',404);
      result={id:key};await commit({['courses/'+key+'/active']:true,['courses/'+key+'/updatedAt']:now(),['courses/'+key+'/updatedBy']:who});
    }else if(action==='archive'){
      const key=safeId(b.id),kind=String(b.kind);
      if(!['courses','enrollments'].includes(kind))throw err('Tipo inválido.');
      const snap=await root.child(kind+'/'+key).get();if(!snap.exists())throw err('Registro não encontrado.',404);
      result={id:key};const changes={};const fields=kind==='courses'?{active:false,updatedAt:now(),updatedBy:who}:{status:'dispensado',notifyEnabled:false,updatedAt:now(),updatedBy:who};Object.entries(fields).forEach(([k,v])=>changes[kind+'/'+key+'/'+k]=v);await commit(changes);
    }else if(action==='document'){
      const enrollmentId=safeId(b.enrollmentId),docId=safeId(b.id);const extension=String(b.extension||'');
      if(!['pdf','png','jpg','webp'].includes(extension))throw err('Formato inválido.');
      const path=`erp-files/training/${enrollmentId}/${docId}.${extension}`;
      const documentRef=root.child('documents/'+docId);
      // Idempotência: requisições repetidas retornam o registro já salvo.
      const previous=await documentRef.get();
      if(previous.exists()){
        const saved=previous.val();
        if(saved?.enrollmentId!==enrollmentId||saved?.path!==path)throw err('Identificador já utilizado em outro documento.',409);
        return res.status(200).json({ok:true,id:docId,document:saved,alreadyExists:true});
      }
      if(!(await root.child('enrollments/'+enrollmentId).get()).exists())throw err('Vínculo inexistente.',404);
      const bucket=storage.bucket(),file=bucket.file(path),[exists]=await file.exists();
      if(!exists)throw err('Anexo ainda não foi enviado.',409);
      const [meta]=await file.getMetadata();
      if(Number(meta.size)<1||Number(meta.size)>10*1024*1024)throw err('Anexo fora do limite de 10 MB.');
      const allowedMime={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
      if(meta.contentType!==allowedMime[extension])throw err('O tipo do arquivo não corresponde à extensão.',400);
      const document={id:docId,enrollmentId,name:textField(b.name,140),path,createdAt:now(),createdBy:who};
      // A transação create-only impede a duplicação inclusive entre abas/dispositivos.
      const transaction=await runTransaction(documentRef,current=>current===null?document:undefined);
      const saved=transaction.snapshot.val();
      if(saved?.enrollmentId!==enrollmentId||saved?.path!==path)throw err('Identificador já utilizado em outro documento.',409);
      if(transaction.committed){
        try{
          await root.child('audit').child('document_'+docId).set({action,recordId:docId,actor:who,uid:identity.uid,createdAt:now()});
        }catch(auditError){
          // Não informar falha de salvamento após a transação já ter sido confirmada.
          console.error('[Matriz] Documento salvo, mas o registro de auditoria falhou.',auditError);
        }
      }
      return res.status(200).json({ok:true,id:docId,document:saved,alreadyExists:!transaction.committed});
    }else if(action==='removeDocument'){
      const key=safeId(b.id),snapshot=await root.child('documents/'+key).get(),v=snapshot.val();
      if(!v)throw err('Documento não encontrado.',404);
      if(!String(v.path||'').startsWith('erp-files/training/'))throw err('Caminho inválido.');
      result={id:key};await commit({['documents/'+key]:null});await storage.bucket().file(v.path).delete({ignoreNotFound:true});
    }else throw err('Ação desconhecida.');
    return res.status(200).json({ok:true,...result});
  }catch(e){return sendError(res,e);}
}
