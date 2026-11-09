#!/usr/bin/env node
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SUPPLIER='F675';
const NAME='TESTE NAO APAGAR';
const PROJECT='manuelametaisltda';
const EXPECTED_ADVANCES=new Map([
  ['ADTMW3ZCB9K3E9382B3',{value:100,bank:'BC-012',status:'Quitado'}],
  ['ADTMW5EI8XVDCB9BAE9',{value:35,bank:'BC-005',status:'Quitado'}],
  ['ADTMW5EJE9G02C2C589',{value:25,bank:'BC-005',status:'Pendente'}],
  ['ADTmw5fd5m45869e921',{value:15,bank:'BC-005',status:'Quitado'}],
]);
const EXPECTED_PAYABLES=new Map([
  ['CPPO_T303',{ticket:'T303',paymentCount:1}],
  ['CPPO_T309',{ticket:'T309',paymentCount:4}],
]);
const EXPECTED_MOVEMENTS=new Map([
  ['LB-1793995341766-d9d87583',{value:35,advance:'ADTMW5EI8XVDCB9BAE9'}],
  ['LB-1793995395318-0d760685',{value:100,advance:'ADTMW5EJE9G02C2C589'}],
  ['LB-PG-1793999084675-c53e2681',{value:50,payable:'CPPO_T309'}],
  ['LB-PG-1793999234976-46dd0e59',{value:50,payable:'CPPO_T309'}],
  ['LB-PG-1794001531014-e2fcaf89',{value:50,payable:'CPPO_T309'}],
  ['LB-PG-1794001697320-3f127753',{value:50,payable:'CPPO_T309'}],
]);
const TICKETS=['T275','T284','T296','T303','T309'];
const EXPECTED_LEGACY_BALANCES=new Map([
  ['saldoDevedor',{ticket:'T284',value:200}],
  ['saldos',{ticket:'T284',value:200}],
]);
const text=value=>String(value??'').trim();
const cents=value=>Math.round(Number(value)*100);
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const items=value=>Object.entries(value&&typeof value==='object'?value:{}).filter(([,x])=>x&&typeof x==='object');
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const assert=(condition,message,issues)=>{if(!condition)issues.push(message);};

export function planSupplierTestCleanup(source){
  const erp=source?.erp??source??{};
  const problems=[];
  const advances=items(erp.adiantamentos?.[SUPPLIER]);
  const codes=new Set(advances.map(([,a])=>text(a.cod)));
  assert(advances.length===4,'Quantidade de adiantamentos F675 diferente de 4',problems);
  assert(codes.size===4,'Existem adiantamentos com código repetido',problems);
  for(const [key,a] of advances){
    const want=EXPECTED_ADVANCES.get(text(a.cod));
    assert(!!want,`Adiantamento inesperado em F675 (chave ${key})`,problems);
    if(!want)continue;
    assert(cents(a.valor)===cents(want.value),`Valor divergente: ${a.cod}`,problems);
    assert(text(a.bancoCod)===want.bank,`Banco divergente: ${a.cod}`,problems);
    assert(text(a.status)===want.status,`Status divergente: ${a.cod}`,problems);
    assert(!a.chequeIds?.length,`Adiantamento possui cheques: ${a.cod}`,problems);
  }
  for(const code of EXPECTED_ADVANCES.keys())assert(codes.has(code),`Adiantamento esperado ausente: ${code}`,problems);
  const payableRecords=items(erp.contasPagar).filter(([id,p])=>
    text(p.fornCod)===SUPPLIER||EXPECTED_PAYABLES.has(id));
  assert(payableRecords.length===2,'Número de contas de compra do F675 diferente de 2',problems);
  for(const [id,p] of payableRecords){
    const want=EXPECTED_PAYABLES.get(id);
    assert(!!want,`Conta de compra inesperada para F675: ${id}`,problems);
    if(!want)continue;
    assert(text(p.id||id)===id&&text(p.ticket)===want.ticket&&text(p.fornCod)===SUPPLIER,`Identidade da conta divergente: ${id}`,problems);
    assert(text(p.cred).toLocaleUpperCase('pt-BR')===NAME,`Fornecedor da conta divergente: ${id}`,problems);
    assert(text(p.status)===(id==='CPPO_T303'?'Pago':'Pendente'),`Situação da conta alterada: ${id}`,problems);
    assert(Array.isArray(p.pagamentos)&&p.pagamentos.length===want.paymentCount,`Histórico de pagamentos alterado: ${id}`,problems);
    if(id==='CPPO_T309'){
      assert(cents(p.valor)===5000&&cents(p.valorPago)===20000,'T309 não corresponde a R$ 50/R$ 200 da auditoria',problems);
      assert((p.pagamentos||[]).every(x=>cents(x.valor)===5000&&cents(x.adt||0)===0),'Histórico T309 alterado',problems);
    }
    if(id==='CPPO_T303'){
      assert(cents(p.valor)===0&&cents(p.valorPago||0)===0,'Conta T303 alterada',problems);
      assert((p.pagamentos||[]).length===1&&cents(p.pagamentos[0].adt||0)===5000,'Compensação T303 alterada',problems);
    }
  }
  for(const id of EXPECTED_PAYABLES.keys())assert(payableRecords.some(([key])=>key===id),`Conta esperada ausente: ${id}`,problems);
  const matchedMovements=items(erp.lancBanco).filter(([id,m])=>EXPECTED_MOVEMENTS.has(id)||
    EXPECTED_ADVANCES.has(text(m.advanceCode))||EXPECTED_PAYABLES.has(text(m.payableId))||
    text(m.descricao).toLocaleUpperCase('pt-BR').includes(NAME));
  assert(matchedMovements.length===6,'Número de movimentos ligados aos testes diferente de 6',problems);
  for(const [id,m] of matchedMovements){
    const want=EXPECTED_MOVEMENTS.get(id);
    assert(!!want,`Movimento financeiro extra associado a F675: ${id}`,problems);
    if(!want)continue;
    assert(cents(m.valor)===cents(want.value)&&text(m.tipo).toLowerCase()==='saida'&&text(m.bancoCod)==='BC-005',`Valor/tipo/banco do movimento divergente: ${id}`,problems);
    if(want.advance)assert(text(m.advanceCode)===want.advance,`Vínculo de adiantamento divergente: ${id}`,problems);
    if(want.payable)assert(text(m.payableId)===want.payable,`Vínculo de conta divergente: ${id}`,problems);
  }
  for(const id of EXPECTED_MOVEMENTS.keys())assert(matchedMovements.some(([key])=>key===id),`Movimento esperado ausente: ${id}`,problems);
  const originalT275=advances.find(([,a])=>a.cod==='ADTMW3ZCB9K3E9382B3')?.[1];
  assert(!originalT275?.movBancoId||!erp.lancBanco?.[originalT275.movBancoId],'Movimento antigo do T275 reapareceu',problems);
  for(const [id,t] of items(erp.tickets)){
    if(TICKETS.includes(id)||TICKETS.includes(text(t.ticket||t.numeroPedido))||text(t.fornecedorCod)===SUPPLIER)
      problems.push(`Ticket ativo relacionado ainda existe: ${id}`);
  }
  const legacyBalances=[];
  for(const [collection,want] of EXPECTED_LEGACY_BALANCES){
    const record=erp[collection]?.[SUPPLIER];
    const valid=obj(record);
    const exact=record&&typeof record==='object'&&!Array.isArray(record)&&
      Object.keys(valid).sort().join(',')==='ticket,valor'&&
      text(valid.ticket)===want.ticket&&cents(valid.valor)===cents(want.value);
    assert(exact,`Saldo legado ${collection}/${SUPPLIER} ausente ou divergente do T284 de R$ 200,00`,problems);
    if(exact)legacyBalances.push({collection,ticket:want.ticket,value:want.value});
  }
  const identifiers=[...EXPECTED_ADVANCES.keys(),...EXPECTED_PAYABLES.keys(),...EXPECTED_MOVEMENTS.keys()];
  const referencedTickets=['T275','T284','T296','T303','T309'];
  for(const collection of ['chequesControle','chequesCli','contasReceber','saldoDevedor','saldos','cheques','adtCli']){
    for(const [id,record] of items(erp[collection])){
      if(EXPECTED_LEGACY_BALANCES.has(collection)&&id===SUPPLIER&&
        legacyBalances.some(item=>item.collection===collection))continue;
      const serialized=JSON.stringify(record);
      if(text(record.fornCod)===SUPPLIER||[...identifiers,...referencedTickets].some(value=>serialized.includes('"'+value+'"')))
        problems.push(`Referência em outro módulo ${collection}/${id}; revisão manual necessária`);
    }
  }
  const projection={
    advances:erp.adiantamentos?.[SUPPLIER]??null,
    payables:Object.fromEntries(EXPECTED_PAYABLES.keys().map(id=>[id,erp.contasPagar?.[id]??null])),
    movements:Object.fromEntries(EXPECTED_MOVEMENTS.keys().map(id=>[id,erp.lancBanco?.[id]??null])),
    tickets:Object.fromEntries(TICKETS.map(id=>[id,erp.tickets?.[id]??null])),
    otherRefs:Object.fromEntries(['chequesControle','chequesCli','contasReceber','saldoDevedor','saldos','cheques','adtCli'].map(x=>[x,erp[x]??null])),
    tombstones:{advances:erp.financeAdvanceDeleted?.[SUPPLIER]??null,payables:erp.contasPagarDeleted??null,bank:erp.lancBancoDeleted??null},
    historicalReceipts:{advances:erp.financeAdvanceOperations??null,payables:erp.financePayableOperations??null,orders:erp.purchaseCreateOperations??null},
  };
  return {
    mode:'PREVIEW_ONLY',supplier:SUPPLIER,name:NAME,
    advances:advances.length,payables:payableRecords.length,bankMovements:matchedMovements.length,
    legacyBalances:legacyBalances.length,legacyBalanceEachCents:20000,
    bankMovementsTotalCents:matchedMovements.reduce((total,[,r])=>total+cents(r.valor),0),
    receiptsPreserved:['financeAdvanceOperations','financePayableOperations','purchaseCreateOperations','purchaseEditOperations'],
    blockers:[...new Set(problems)],readyForControlledCleanup:problems.length===0,
    planHash:digest(projection),
  };
}

const inProduction=()=>text(process.env.FIREBASE_PROJECT_ID)===PROJECT&&
  ['production','prod'].includes(text(process.env.APP_ENV||process.env.NODE_ENV||'production'))&&
  text(process.env.USE_FIREBASE_EMULATORS).toLowerCase()!=='true';

function makeUpdates(erp,plan,operationId,now,actor){
  const updates={};
  const supplierData=erp.adiantamentos?.[SUPPLIER];
  if(!supplierData)throw Error('Adiantamentos de teste ausentes.');
  updates[`erp/adiantamentos/${SUPPLIER}`]=null;
  for(const code of EXPECTED_ADVANCES.keys())updates[`erp/financeAdvanceDeleted/${SUPPLIER}/${code}`]={removedCode:code,removedAt:now,reason:'supplier_test_cleanup',cleanupId:operationId};
  for(const id of EXPECTED_PAYABLES.keys()){
    updates[`erp/contasPagar/${id}`]=null;
    updates[`erp/contasPagarDeleted/${id}`]=true;
  }
  for(const collection of EXPECTED_LEGACY_BALANCES.keys())updates[`erp/${collection}/${SUPPLIER}`]=null;
  for(const id of EXPECTED_MOVEMENTS.keys()){
    updates[`erp/lancBanco/${id}`]=null;
    updates[`erp/lancBancoDeletedV2/${id}`]=true;
  }
  updates[`erp/financeTestCleanupOperations/${operationId}`]={
    supplier:SUPPLIER,kind:'exceptional_test_cleanup',actor,createdAt:new Date(now).toISOString(),
    planHash:plan.planHash,advanceCodes:[...EXPECTED_ADVANCES.keys()],payableIds:[...EXPECTED_PAYABLES.keys()],
    movementIds:[...EXPECTED_MOVEMENTS.keys()],legacyBalances:[...EXPECTED_LEGACY_BALANCES.keys()].map(collection=>`${collection}/${SUPPLIER}`),receiptsPreserved:true,noExternalTransferConfirmedByOwner:true,
    note:'Limpeza autorizada de registros de teste; não efetua transferências reais.'
  };
  updates['erp/_ts']=now;
  return updates;
}

async function getLiveDatabase(){
  if(!inProduction())throw Error('Projeto/ambiente não autorizado para este script (exige produção manuelametaisltda e não emulador).');
  const {getFirebaseAdmin}=await import('../server/shared/firebase/firebase-admin.js');
  return getFirebaseAdmin().db;
}

export async function executeControlledCleanup(db,{planHash,confirm,actor='maintenance-cli',now=Date.now,uuid=randomUUID,backupDir}={}){
  if(confirm!=='CONFIRMO_EXCLUSAO_SOMENTE_TESTES_F675_SEM_PIX_REAL')throw Error('Confirmação literal obrigatória.');
  if(!/^[a-f0-9]{64}$/.test(text(planHash)))throw Error('Hash da prévia ao vivo obrigatório.');
  const keys=['erpFinanceAdvanceLocks/F675','erpFinancePayableLocks/CPPO_T303','erpFinancePayableLocks/CPPO_T309',
    'erpFinancePayableTicketLocks/T303','erpFinancePayableTicketLocks/T309'];
  const owner=uuid();
  const acquired=[];
  try{
    for(const path of keys){
      const result=await db.ref(path).transaction(current=>current&&Number(current.expiresAt)>now()?undefined:
        {owner,startedAt:now(),expiresAt:now()+120000,reason:'exceptional_F675_cleanup'},undefined,false);
      if(!result.committed)throw Error('Operação financeira ativa; limpeza cancelada sem alterar registros.');
      acquired.push(path);
    }
    const data=(await db.ref('erp').get()).val()||{};
    const preview=planSupplierTestCleanup({erp:data});
    if(!preview.readyForControlledCleanup)throw Error('Bloqueio de integridade: '+preview.blockers.join('; '));
    if(preview.planHash!==planHash)throw Error('Firebase alterado desde a prévia: limpezas bloqueadas. Gere uma prévia atualizada.');
    const operationId='F675_'+now()+'_'+uuid().replaceAll('-','').slice(0,12);
    const backup={project:PROJECT,supplier:SUPPLIER,operationId,createdAt:new Date(now()).toISOString(),
      advances:data.adiantamentos?.[SUPPLIER],payables:Object.fromEntries(EXPECTED_PAYABLES.keys().map(id=>[id,data.contasPagar?.[id]])),
      bankMovements:Object.fromEntries(EXPECTED_MOVEMENTS.keys().map(id=>[id,data.lancBanco?.[id]])),
      legacyBalances:Object.fromEntries([...EXPECTED_LEGACY_BALANCES.keys()].map(collection=>[collection,data[collection]?.[SUPPLIER]])),
      advanceReceipts:data.financeAdvanceOperations??{},payableReceipts:data.financePayableOperations??{},
      purchaseReceipts:data.purchaseCreateOperations??{},
      planHash};
    const dir=backupDir||join(homedir(),'.local','share','manuela-finance-backups');
    await mkdir(dir,{recursive:true,mode:0o700});
    const backupPath=join(dir,`F675-${operationId}.json`);
    await writeFile(backupPath,JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
    const update=makeUpdates(data,preview,operationId,now(),actor);
    for(const path of acquired)update[path]=null;
    try{
      await db.ref().update(update);
    }catch(error){
      const receipt=(await db.ref('erp/financeTestCleanupOperations/'+operationId).get().catch(()=>null))?.val();
      if(receipt?.planHash!==planHash)throw error;
    }
    const verification=await db.ref('erp').get();
    const after=verification.val()||{};
    const unchanged=Object.keys(after.adiantamentos?.[SUPPLIER]||{}).length===0&&
      [...EXPECTED_PAYABLES.keys()].every(id=>!after.contasPagar?.[id])&&
      [...EXPECTED_MOVEMENTS.keys()].every(id=>!after.lancBanco?.[id]&&after.lancBancoDeletedV2?.[id]===true)&&
      [...EXPECTED_PAYABLES.keys()].every(id=>after.contasPagarDeleted?.[id]===true)&&
      [...EXPECTED_LEGACY_BALANCES.keys()].every(collection=>after[collection]?.[SUPPLIER]==null)&&
      !!after.financeTestCleanupOperations?.[operationId];
    if(!unchanged)throw Error('Commit enviado, mas verificação pós-operação falhou: investigar sem repetir. Backup: '+backupPath);
    return {status:'CONFIRMED',supplier:SUPPLIER,operationId,backupPath,removedAdvances:4,removedPayables:2,removedBankMovements:6,removedLegacyBalances:2,receiptCollectionsPreserved:true};
  }finally{
    for(const path of acquired.reverse()){
      try{await db.ref(path).transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}
    }
  }
}

async function main(){
  const argv=process.argv.slice(2);
  const arg=name=>argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
  const snapshot=arg('snapshot');
  const live=argv.includes('--live');
  const apply=argv.includes('--apply');
  if(snapshot&&(live||apply))throw Error('Modo snapshot não aceita operações live/apply.');
  if(!snapshot&&!live)throw Error('Uso: --snapshot=backup.json (somente leitura) ou --live (prévia real).');
  if(snapshot){
    const data=JSON.parse(await readFile(snapshot,'utf8'));
    console.log(JSON.stringify(planSupplierTestCleanup(data),null,2));
    return;
  }
  const db=await getLiveDatabase();
  if(!apply){
    const data=(await db.ref('erp').get()).val()||{};
    console.log(JSON.stringify({...planSupplierTestCleanup({erp:data}),mode:'LIVE_PREVIEW_READ_ONLY'},null,2));
    return;
  }
  const result=await executeControlledCleanup(db,{planHash:arg('plan-hash'),confirm:arg('confirm'),actor:arg('actor')||'local-maintenance'});
  console.log(JSON.stringify(result,null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('LIMPEZA NÃO CONFIRMADA:',e.message);process.exitCode=1;});
