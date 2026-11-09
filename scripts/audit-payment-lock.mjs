import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const clean=value=>String(value??'').trim();
const rows=value=>Object.entries(value&&typeof value==='object'?value:{}).filter(([,row])=>row&&typeof row==='object'&&!Array.isArray(row));
function key(value){const v=clean(value);if(!/^[\w-]{1,120}$/.test(v))throw new Error('Identificador inválido.');return v;}

export function inspectPaymentLock({database,payableId,ticketNo,now=Date.now()}={}){
  const all=database||{};
  const erp=all.erp||{};
  const payables=erp.contasPagar||{};
  const matched=rows(payables).filter(([path,row])=>payableId?(path===payableId||clean(row.id)===payableId):clean(row.ticket)===ticketNo);
  return matched.map(([path,row])=>{
    const id=clean(row.id||path),lock=all.erpFinancePayableLocks?.[id]||null;
    const expectedTicket=clean(row.ticket);
    const remainingMs=lock?Math.max(0,Number(lock.expiresAt||0)-now):0;
    const payments=Array.isArray(row.pagamentos)?row.pagamentos:[];
    const movementIds=[...new Set([row.movBancoIdCP,...payments.map(payment=>payment?.movBancoId)].filter(Boolean))];
    const op=lock?.operationKey?erp.financePayableOperations?.[lock.operationKey]:null;
    return {
      payablePath:path,payableId:id,ticket:expectedTicket,status:row.status||null,
      balance:Number(row.valor??0),registeredPayments:payments.length,
      bankMovements:movementIds.map(movementId=>({id:movementId,exists:erp.lancBanco?.[movementId]!=null})),
      lock:lock?{present:true,expiresAt:Number(lock.expiresAt||0),expired:remainingMs===0,secondsRemaining:Math.ceil(remainingMs/1000),hasOperationReference:Boolean(lock.operationKey),operationReceiptFound:Boolean(op?.result)}:{present:false},
      action:'Conferir o título e os movimentos antes de qualquer nova baixa. Este diagnóstico nunca remove bloqueios.'
    };
  });
}

async function main(){
  const snapArg=process.argv.find(arg=>arg.startsWith('--snapshot='));
  const live=process.argv.includes('--live');
  const ticketArg=process.argv.find(arg=>arg.startsWith('--ticket='));
  const payableArg=process.argv.find(arg=>arg.startsWith('--payable='));
  if(Boolean(snapArg)===live||Boolean(ticketArg)===Boolean(payableArg))
    throw new Error('Uso: node scripts/audit-payment-lock.mjs --ticket=T275 (--live OU --snapshot=arquivo.json). Também aceita --payable=CP-T275.');
  const ticketNo=ticketArg?key(ticketArg.slice(9)):null;
  const payableId=payableArg?key(payableArg.slice(10)):null;
  let data;
  if(snapArg){
    data=JSON.parse(await fs.readFile(snapArg.slice(11),'utf8'));
    if(data?.rules)throw new Error('Arquivo de regras não é um snapshot do banco.');
  }else{
    const {getFirebaseAdmin}=await import('../server/shared/firebase/firebase-admin.js');
    const {db}=getFirebaseAdmin();
    const payables=(await db.ref('erp/contasPagar').get()).val()||{};
    const matching=rows(payables).filter(([p,r])=>payableId?(p===payableId||clean(r.id)===payableId):clean(r.ticket)===ticketNo);
    const locks={},operations={},movements={};
    for(const [keyPath,row] of matching){
      const id=clean(row.id||keyPath);
      locks[id]=(await db.ref('erpFinancePayableLocks/'+key(id)).get()).val();
      if(locks[id]?.operationKey){
        const operationKey=key(locks[id].operationKey);
        operations[operationKey]=(await db.ref('erp/financePayableOperations/'+operationKey).get()).val();
      }
      for(const movementId of new Set([row.movBancoIdCP,...(row.pagamentos||[]).map(p=>p?.movBancoId)].filter(Boolean))){
        movements[movementId]=(await db.ref('erp/lancBanco/'+key(movementId)).get()).val();
      }
    }
    data={erp:{contasPagar:payables,financePayableOperations:operations,lancBanco:movements},erpFinancePayableLocks:locks};
  }
  const report=inspectPaymentLock({database:data,payableId,ticketNo});
  console.log(JSON.stringify({environment:live?'firebase-live-readonly':'snapshot',project:live?(process.env.FIREBASE_PROJECT_ID||'não informado'):null,records:report},null,2));
  if(!report.length){console.error('Nenhum título encontrado. Confira o ticket e o projeto Firebase.');process.exitCode=2;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error('[AUDITORIA DE BAIXA]',error.message);process.exitCode=1;});
}
