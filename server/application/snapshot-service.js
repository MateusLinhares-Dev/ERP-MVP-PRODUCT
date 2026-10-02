export const BUSINESS_SNAPSHOT_NODES = Object.freeze([
  'tickets','adiantamentos','cheques','adtCli','chequesCli','bancos','lancBanco',
  'fornecedores','clientes','contasPagar','contasReceber','estoque','historico',
  'funcEdit','folha','vales','ponto','epi','frota','manutencao','viagem',
  'combustivel','agendaEntregas','almoxa','almoxaMov','custosCasa','veicPess','manutPess',
]);
const TOMBSTONE_NODES = Object.freeze([
  'ticketsDeleted','ticketsDeletedV2','fornDeleted','fornDeletedV2',
  'contasPagarDeleted','contasPagarDeletedV2',
  ...['bancos','lancBanco','fornecedores','clientes','contasReceber','vales',
    'ponto','epi','frota','manutencao','viagem','combustivel','agendaEntregas',
    'almoxa','almoxaMov','historico'].flatMap(n=>[n+'Deleted',n+'DeletedV2']),
]);
export function isValidSnapshotKey(key){ return /^\d{4}-\d{2}-\d{2}$/.test(key)||/^antes-restauracao-\d{13}$/.test(key)||/^manual-\d{13}$/.test(key); }
export function normalizeBusinessSnapshot(erp, operator, now=Date.now()) {
  const snapshot={_schema:2,_ts:now,_user:operator};
  BUSINESS_SNAPSHOT_NODES.forEach(k=>{snapshot[k]=Object.prototype.hasOwnProperty.call(erp||{},k)?erp[k]:null;});
  return snapshot;
}
export function buildExactRestorePatch(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)) throw new Error('Snapshot inválido.');
  const patch={};
  BUSINESS_SNAPSHOT_NODES.forEach(k=>{ if(Object.prototype.hasOwnProperty.call(snapshot,k))patch['erp/'+k]=snapshot[k]??null; });

  const aliases={fornDeleted:'fornecedores',fornDeletedV2:'fornecedores',
    ticketsDeleted:'tickets',ticketsDeletedV2:'tickets',
    contasPagarDeleted:'contasPagar',contasPagarDeletedV2:'contasPagar'};
  TOMBSTONE_NODES.forEach(k=>{
    const base=aliases[k]||k.replace(/Deleted(?:V2)?$/,'');
    if(Object.prototype.hasOwnProperty.call(snapshot,base))patch['erp/'+k]=null;
  });
  patch['erp/_ts']=Date.now();
  return patch;
}
export async function createSnapshot(db,{key,operator,overwrite=false}){
  if(!isValidSnapshotKey(key))throw new Error('Identificador de snapshot inválido.');
  const ref=db.ref('erp_snapshots/'+key);
  if(!overwrite&&(await ref.get()).exists())return {key,created:false};
  const source=(await db.ref('erp').get()).val()||{};
  const snap=normalizeBusinessSnapshot(source,operator);
  await ref.set(snap);
  return {key,created:true};
}
export async function restoreSnapshot(db,{key,operator}){
  if(!isValidSnapshotKey(key))throw new Error('Identificador de snapshot inválido.');
  const snap=(await db.ref('erp_snapshots/'+key).get()).val();
  if(!snap){const e=new Error('Snapshot não encontrado.');e.status=404;throw e;}
  const before=(await db.ref('erp').get()).val()||{};
  const emergency='antes-restauracao-'+Date.now();
  await db.ref('erp_snapshots/'+emergency).set(normalizeBusinessSnapshot(before,operator));
  const patch=buildExactRestorePatch(snap);
  try{
    await db.ref().update(patch);
  }catch(error){error.emergency=emergency;throw error;}
  try{await db.ref('erpAudit').push({action:'snapshot-restored',module:'suporte_tecnico',actorLogin:operator,at:new Date().toISOString(),snapshotKey:key,emergencyKey:emergency});}catch(error){console.error('Audit failed AFTER successful restore:',error);}
  return {key,emergency};
}
