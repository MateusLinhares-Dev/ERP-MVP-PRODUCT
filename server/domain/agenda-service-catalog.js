import { randomUUID } from 'node:crypto';

const BASE = [
  ['base_entrega', 'ENTREGA DE MATERIAL'],
  ['base_retirada', 'RETIRADA DE MATERIAL'],
  ['base_coleta', 'COLETA DE MATERIAL'],
  ['base_atendimento', 'ATENDIMENTO'],
];
const makeError=(message,status=400)=>Object.assign(new Error(message),{status,code:'AGENDA_SERVICE_INVALID'});
export const defaultAgendaServices=()=>BASE.map(([id,name])=>({id,name}));
export const agendaServiceCatalog=(raw)=>Array.isArray(raw?.items)?raw.items:defaultAgendaServices();
export function normalizeAgendaServiceName(raw){
  if(typeof raw!=='string')throw makeError('Informe o nome do serviço.');
  const name=raw.trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
  if(name.length<3||name.length>80||/[<>\u0000-\u001f\u007f]/.test(name))throw makeError('O serviço deve conter de 3 a 80 caracteres válidos.');
  return name;
}
export function validateAgendaServiceId(raw){
  if(typeof raw!=='string'||!(/^(?:base_(?:entrega|retirada|coleta|atendimento)|srv_[a-f0-9]{32})$/).test(raw))throw makeError('Identificador de serviço inválido.');
  return raw;
}
export async function mutateAgendaServiceCatalog(ref,{action,name,id,actor}){
  // Prime the RTDB client cache before transaction. An initial provisional null
  // must not accidentally replace a catalog saved by another session.
  await ref.get();
  let change='none';
  const tx=await ref.transaction(current=>{
    const items=agendaServiceCatalog(current);
    if(action==='add'){
      if(items.some(item=>item.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')===name.normalize('NFD').replace(/[\u0300-\u036f]/g,''))){change='exists';return;}
      if(items.length>=100)throw makeError('Limite de 100 serviços cadastrados atingido.');
      change='added';
      return {revision:(current?.revision||0)+1,items:[...items,{id:'srv_'+randomUUID().replace(/-/g,''),name}],updatedAt:Date.now(),updatedBy:actor};
    }
    if(action==='delete'){
      if(!items.some(item=>item.id===id)){change='missing';return;}
      change='deleted';
      return {revision:(current?.revision||0)+1,items:items.filter(item=>item.id!==id),updatedAt:Date.now(),updatedBy:actor};
    }
    throw makeError('Ação inválida.');
  },undefined,false);
  if(!tx.committed&&change!=='exists'&&change!=='missing')throw Object.assign(new Error('Não foi possível registrar o serviço. Atualize e tente novamente.'),{status:409,code:'AGENDA_SERVICE_CONFLICT'});
  return {changed:tx.committed,items:agendaServiceCatalog(tx.committed?tx.snapshot.val():(await ref.get()).val())};
}
