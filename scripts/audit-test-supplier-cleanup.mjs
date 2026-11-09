#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const text=v=>String(v??'').trim();
const rows=v=>Object.entries(v&&typeof v==='object'?v:{}).filter(([,r])=>r&&typeof r==='object');
const selected=(v,s)=>s.has(text(v));
const DEFAULT_TICKETS=['T275','T284','T296','T303','T309'];

export function auditTestSupplierBackup(snapshot,{supplier='F675',tickets=DEFAULT_TICKETS}={}){
  const erp=snapshot?.erp??snapshot??{};
  const ticketSet=new Set(tickets.map(text));
  const advances=rows(erp.adiantamentos?.[supplier]).map(([key,a])=>({
    key,code:text(a.cod),amount:a.valor,status:a.status,bankCode:text(a.bancoCod),
    bankMovementId:text(a.movBancoId),ticket:text(a.ticket),compensated:Number(a.valorCompensado||0),
    origin:text(a.origem)
  }));
  const advanceSet=new Set(advances.map(a=>a.code).filter(Boolean));
  for(const a of advances)if(a.ticket)ticketSet.add(a.ticket);
  const ticketRows=rows(erp.tickets).filter(([key,t])=>selected(key,ticketSet)||selected(t.ticket,ticketSet)||selected(t.numeroPedido,ticketSet)||text(t.fornecedorCod)===supplier);
  for(const [key,t] of ticketRows)ticketSet.add(text(t.ticket||t.numeroPedido||key));
  const payables=rows(erp.contasPagar).filter(([key,p])=>text(p.fornCod)===supplier||selected(p.ticket,ticketSet)||selected(key,new Set([...ticketSet].map(t=>'CPPO_'+t)))).map(([key,p])=>({
    key,id:text(p.id||key),ticket:text(p.ticket),amount:p.valor,paid:p.valorPago,status:p.status,
    payments:Array.isArray(p.pagamentos)?p.pagamentos.map(payment=>({value:payment.valor||0,advance:payment.adt||0,movementId:text(payment.movBancoId)})):[]
  }));
  const payableSet=new Set(payables.map(p=>p.id));
  const movementSet=new Set([...advances.map(a=>a.bankMovementId),...payables.flatMap(p=>p.payments.map(x=>x.movementId))].filter(Boolean));
  const bankMovements=rows(erp.lancBanco).filter(([id,b])=>movementSet.has(id)||movementSet.has(text(b.id))||advanceSet.has(text(b.advanceCode))||payableSet.has(text(b.payableId))).map(([key,b])=>({
    key,amount:b.valor,type:b.tipo,bankCode:text(b.bancoCod),advanceCode:text(b.advanceCode),payableId:text(b.payableId)
  }));
  const referenced=Object.fromEntries(['financeAdvanceOperations','financePayableOperations','purchaseCreateOperations','purchaseEditOperations',
    'financeAdvanceDeleted','financeAdvanceRecoveryAudit','purchaseOrderCreateOperations'].map(collection=>{
    const data=erp[collection];
    const matches=rows(data).filter(([key,v])=>{
      const json=JSON.stringify(v);
      return [...advanceSet,...ticketSet,...payableSet].some(value=>value&&json.includes('"'+value+'"'));
    });
    return [collection,matches.map(([key])=>key)];
  }));
  const activeTickets=ticketRows.map(([key,t])=>({key,ticket:text(t.ticket||t.numeroPedido||key),status:t.status}));
  const blockers=[];
  if(advances.some(a=>a.status==='Quitado'||a.compensated>0||a.origin==='compensacao_cp'))blockers.push('Adiantamentos utilizados/quitados: exigem estorno da compensação antes de excluir.');
  if(payables.some(p=>p.payments.length||Number(p.paid)>0))blockers.push('Contas a pagar com histórico de pagamentos: não remover sem reconciliar recibos e lançamentos.');
  if(activeTickets.length)blockers.push('Tickets ainda identificados no snapshot: conferir a exclusão e o status.');
  if(bankMovements.length)blockers.push('Lançamentos bancários vinculados: remover apenas em operação financeira com recibo e auditoria.');
  if(!advances.length)blockers.push('Nenhum adiantamento de F675 encontrado neste backup (possivelmente desatualizado).');
  return {
    mode:'SOMENTE_LEITURA',supplier,requestedTickets:[...ticketSet].sort(),
    advances,bankMovements,payables,activeTickets,
    relatedReceiptKeys:referenced,
    bankReconciliationImportCount:rows(erp.bankReconciliationImports?.['BC-005']).length,
    blockers,automaticDeletionAllowed:false,
    nextStep:'Conferir o relatório e executar uma reversão financeira transacional, nunca apagar diretamente lancBanco ou adiantamentos.'
  };
}

async function main(){
  const argv=process.argv.slice(2);
  const file=argv.find(s=>s.startsWith('--snapshot='))?.slice('--snapshot='.length);
  if(!file)throw new Error('Uso: node auditar_limpeza_testes_F675.mjs --snapshot=./backup-ATUAL.json');
  const data=JSON.parse(await readFile(file,'utf8'));
  console.log(JSON.stringify(auditTestSupplierBackup(data),null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error('Erro:',e.message);process.exitCode=1;});
}
