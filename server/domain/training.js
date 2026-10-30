// Validation and calendar logic for the training matrix. No browser or Firebase dependencies.
const invalid=(message,status=400)=>Object.assign(new Error(message),{status,code:'TRAINING_VALIDATION'});
export const textField=(value,max=160)=>{
  const text=String(value??'').trim();
  if(!text||text.length>max)throw invalid(`Texto obrigatório, até ${max} caracteres.`);
  return text;
};
export const optionalText=(value,max=500)=>String(value??'').trim().slice(0,max);
export const safeId=id=>{if(!/^[A-Za-z0-9_-]{4,100}$/.test(String(id||'')))throw invalid('Identificador inválido.');return id;};
export const validDate=value=>{
  const v=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw invalid('Informe uma data válida.');return v;
};
export const optionalDate=value=>value?validDate(value):'';
export const yearMonthDelta=(iso,months)=>{
  const date=new Date(validDate(iso)+'T12:00:00Z');
  const n=Number(months);if(!Number.isInteger(n)||n<0||n>240)throw invalid('Periodicidade deve ficar entre 0 e 240 meses.');
  const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+n);
  const monthEnd=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,monthEnd));return date.toISOString().slice(0,10);
};
export const coursePayload=(raw)=>{
  const months=Number(raw?.renewalMonths||0);if(!Number.isInteger(months)||months<0||months>240)throw invalid('Intervalo de renovação inválido.');
  const noticeDays=Number(raw?.noticeDays??30);if(!Number.isInteger(noticeDays)||noticeDays<0||noticeDays>365)throw invalid('Antecedência do aviso inválida.');
  return {title:textField(raw?.title,120),category:optionalText(raw?.category,60),description:optionalText(raw?.description,500),renewalMonths:months,noticeDays,mandatory:Boolean(raw?.mandatory),active:raw?.active!==false};
};
export const enrollmentPayload=(raw)=>{
  const courseId=safeId(raw?.courseId),employeeId=safeId(raw?.employeeId);
  const status=String(raw?.status||'planejado');if(!['planejado','agendado','concluido','dispensado'].includes(status))throw invalid('Status de curso inválido.');
  const completedAt=optionalDate(raw?.completedAt),scheduledAt=optionalDate(raw?.scheduledAt),expiresAt=optionalDate(raw?.expiresAt);
  if(status==='concluido'&&!completedAt)throw invalid('Informe a conclusão do curso.');
  return {courseId,employeeId,employeeLogin:optionalText(raw?.employeeLogin,80).toLowerCase(),status,completedAt,scheduledAt,expiresAt,notes:optionalText(raw?.notes,500),notifyAt:optionalDate(raw?.notifyAt),notifyEnabled:Boolean(raw?.notifyEnabled)};
};
export const courseState=(entry,course,asOf=new Date().toISOString().slice(0,10))=>{
  const expires=entry.expiresAt||(entry.completedAt&&course.renewalMonths?yearMonthDelta(entry.completedAt,course.renewalMonths):'');
  const days=expires?Math.round((new Date(expires+'T12:00:00Z')-new Date(asOf+'T12:00:00Z'))/86400000):null;
  const status=entry.status!=='concluido'?entry.status:days===null?'sem-vencimento':days<0?'vencido':days<=course.noticeDays?'a-vencer':'em-dia';
  return {...entry,expiresAt:expires,daysRemaining:days,displayStatus:status};
};
export const visibleNotice=(assignment,course,login,asOf)=>{
  const state=courseState(assignment,course,asOf);
  return assignment.notifyEnabled&&String(assignment.employeeLogin||'').toLowerCase()===String(login||'').toLowerCase()&&(!assignment.notifyAt||assignment.notifyAt<=asOf)&&
    (state.displayStatus==='vencido'||state.displayStatus==='a-vencer'||state.displayStatus==='planejado'||state.displayStatus==='agendado');
};
