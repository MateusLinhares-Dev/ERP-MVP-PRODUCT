import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const clean=v=>String(v??'').trim();
const entries=v=>Object.entries(v&&typeof v==='object'?v:{}).filter(([,r])=>r&&typeof r==='object'&&!Array.isArray(r));
const amount=v=>Math.round((Number(v)||0)*100)/100;
export function inspectPayableIntegrity(db,ticketNo){
  const erp=db?.erp??db??{};
  const payableRows=entries(erp.contasPagar).filter(([,r])=>clean(r.ticket)===ticketNo||clean(r.id)==='CPPO_'+ticketNo);
  const ticket=erp.tickets?.[ticketNo]??entries(erp.tickets).find(([,r])=>clean(r.ticket||r.numeroPedido)===ticketNo)?.[1]??null;
  return payableRows.map(([recordKey,payable])=>{
    const payments=Array.isArray(payable.pagamentos)?payable.pagamentos:[];
    const bankMovements=payments.filter(p=>amount(p.valor)>0).map(p=>{
      const key=clean(p.movBancoId);const bank=key?erp.lancBanco?.[key]:null;
      return {movementId:key||null,expectedAmount:amount(p.valor),found:!!bank,
        amountMatches:!!bank&&amount(bank.valor)===amount(p.valor),
        payableMatches:!!bank&&clean(bank.payableId)===clean(payable.id)};
    });
    const historyTotal=amount(payments.reduce((s,p)=>s+amount(p.valor)+amount(p.adt),0));
    const nominal=amount(ticket?.totalGeral??ticket?.pedidoCompra?.totalPedido??0);
    const issues=[];
    if(nominal>0&&historyTotal>nominal+0.005)issues.push('PAYMENTS_EXCEED_PURCHASE');
    if(nominal>0&&amount(payable.valorPago)>nominal+0.005)issues.push('DECLARED_PAID_EXCEEDS_PURCHASE');
    if(bankMovements.some(m=>!m.found))issues.push('BANK_MOVEMENTS_MISSING');
    if(bankMovements.some(m=>m.found&&(!m.amountMatches||!m.payableMatches)))issues.push('BANK_MOVEMENTS_MISMATCH');
    if(!ticket)issues.push('PURCHASE_TICKET_MISSING');
    if(ticket&&((clean(payable.status)==='Pago')!==(clean(ticket.status)==='Pago'||clean(ticket.status)==='Quitado')))issues.push('PAYABLE_TICKET_STATUS_MISMATCH');
    const relatedReceipts=entries(erp.financePayableOperations).filter(([,rec])=>
      clean(rec?.result?.payable?.id)===clean(payable.id));
    return {ticket:ticketNo,payableId:clean(payable.id||recordKey),payableStatus:clean(payable.status),
      ticketStatus:ticket?.status??null,ticketBalance:ticket?.saldoPagar??null,ticketNominal:nominal,
      declaredPaid:amount(payable.valorPago),registeredPayments:payments.length,
      historyPaymentTotal:historyTotal,movements:bankMovements,confirmedOperationReceipts:relatedReceipts.length,
      issues,recommendation:issues.length?'CONCILIAR SEM REENVIAR PAGAMENTO; não editar ou excluir movimentos manualmente.':'SEM INCONSISTENCIA DETECTADA NO SNAPSHOT'};
  });
}
async function main(){
  const args=process.argv.slice(2),snapshot=args.find(v=>v.startsWith('--snapshot='))?.slice(11),ticket=args.find(v=>v.startsWith('--ticket='))?.slice(9);
  if(!snapshot||!ticket||!/^[A-Za-z0-9_-]{1,60}$/.test(ticket))throw Error('Uso: node scripts/audit-payable-integrity.mjs --snapshot=export.json --ticket=T309');
  const db=JSON.parse(await fs.readFile(snapshot,'utf8'));
  const reports=inspectPayableIntegrity(db,ticket);
  console.log(JSON.stringify({source:'backup-local',ticket,records:reports},null,2));
  if(!reports.length)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{console.error(err.message);process.exitCode=1;});
