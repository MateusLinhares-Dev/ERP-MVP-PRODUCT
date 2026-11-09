import {randomUUID} from 'node:crypto';
import {acquireLease,releaseLease} from '../../../shared/firebase/rtdb-transaction.js';
import {refundAdvanceReceipt} from './edit-purchase-order.js';

const conflict=(status,code,message)=>{const error=new Error(message);error.status=status;error.code=code;throw error;};
const validKey=(value,label)=>{const val=String(value??'').trim();if(!/^[A-Za-z0-9_-]{1,80}$/.test(val))conflict(422,'INVALID_KEY',label+' inválido.');return val;};
const asRows=raw=>Object.entries(raw&&typeof raw==='object'?raw:{}).filter(([,r])=>r&&typeof r==='object'&&!Array.isArray(r));
const cents=value=>{const n=Number(value??0);if(!Number.isFinite(n)||Math.abs(n)>1e9)conflict(409,'FINANCE_DATA_INVALID','Os valores financeiros desta compra precisam de revisão.');return Math.round(n*100);};
const same=(a,b)=>String(a??'').trim()===String(b??'').trim();
const hasFinancialReceipt=ticket=>{
  const receipt=ticket.reciboFinanceiro||{};
  return (Array.isArray(receipt.adiantamentos)&&receipt.adiantamentos.length>0)||
    (Array.isArray(receipt.cheques)&&receipt.cheques.length>0)||
    cents(receipt.total||0)!==0;
};
const hasTicketRef=(value,ticketId,depth=0)=>{
  if(!value||typeof value!=='object'||depth>5)return false;
  if(!Array.isArray(value)){
    for(const field of ['ticket','ticketNo','numeroPedido','ticketOrigem','ticketReferencia','pedido','purchaseTicket']){
      if(value[field]!=null&&same(value[field],ticketId))return true;
    }
  }
  return Object.values(value).some(entry=>entry&&typeof entry==='object'&&hasTicketRef(entry,ticketId,depth+1));
};
const isPaidPayable=payable=>{
  if(String(payable.status||'').toLocaleLowerCase('pt-BR')!=='pendente')return true;
  if(cents(payable.valorPago||0)>0||cents(payable.adtCompensado||0)>0)return true;
  if(Array.isArray(payable.pagamentos)&&payable.pagamentos.length>0)return true;
  return Boolean(payable.dataPgto||payable.movBancoIdCP||payable.bancoCod);
};
const advanceOnlyReceipt=ticket=>{
  const receipt=ticket.reciboFinanceiro||{};
  return Number(receipt.versao)===2&&Array.isArray(receipt.adiantamentos)&&
    receipt.adiantamentos.some(row=>cents(row?.valorAplicado||0)>0)&&
    !(receipt.cheques||[]).some(row=>cents(row?.valorAplicado||0)>0)&&
    !(Array.isArray(receipt.creditos)&&receipt.creditos.length)&&
    cents(ticket.creditoFornecedorAplicado||0)===0&&ticket._pagoUndo==null;
};
const payableWithoutPayment=payable=>{
  if(cents(payable.valorPago||0)>0||cents(payable.adtCompensado||0)>0)return false;
  if(Array.isArray(payable.pagamentos)&&payable.pagamentos.length>0)return false;
  if(payable.movBancoIdCP||payable.bancoCod)return false;
  const status=String(payable.status||'').toLocaleLowerCase('pt-BR');
  return status==='pendente'||(status==='pago'&&cents(payable.valor||0)===0);
};
async function acquire(ref,owner,now){
  const acquired=await acquireLease(ref,owner,{now,ttlMs:120000,meta:{kind:'purchase-delete'}});
  if(!acquired)conflict(409,'PURCHASE_DELETE_BUSY','Existe uma operação financeira em andamento para esta compra. Aguarde alguns segundos e tente novamente.');
}
async function release(ref,owner){
  await releaseLease(ref,owner,{label:'purchase.delete.lock.release'});
}
const linkedBank=(bank,payables,ticketId)=>{
  const ids=new Set([...payables.map(([path,row])=>String(row.id||path)),'CPPO_'+ticketId]);
  return asRows(bank).some(([path,record])=>{
    const payment=String(record.payableId||record.contaPagarId||record.cpId||'');
    if(payment&&ids.has(payment))return true;
    if(same(record.ticket||record.ticketNo||record.numeroPedido,ticketId))return true;
    const text=String(record.descricao||record.obs||'');
    return new RegExp('(^|[^A-Za-z0-9])'+ticketId+'([^A-Za-z0-9]|$)','i').test(text);
  });
};

export async function deletePurchaseOrder(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  if(identity?.erpAccess!==true||identity?.canPurchasing!==true)conflict(403,'PURCHASE_FORBIDDEN','Seu perfil não pode excluir compras.');
  if(!input||typeof input!=='object'||Array.isArray(input))conflict(400,'INVALID_INPUT','Solicitação inválida.');
  const ticketId=validKey(input.ticketNo,'Ticket');
  const operationId=validKey(input.operationId,'Operação');
  if(!/^[a-f0-9-]{36}$/i.test(operationId))conflict(422,'INVALID_OPERATION','Operação inválida.');
  db=db||(await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const actor=String(identity.erpUser||identity.uid||'operador').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64);
  const opRef=db.ref('erp/purchaseDeleteOperations/'+actor+'_'+operationId);
  const fromReceipt=record=>{
    if(!record)return null;
    if(!same(record.ticketNo,ticketId))conflict(409,'OPERATION_USED','Esta operação já foi utilizada em outro pedido.');
    if(record.status==='CONFIRMED')return {...record,alreadyCommitted:true};
    return null;
  };
  const recorded=fromReceipt((await opRef.get()).val());
  if(recorded)return recorded;
  const owner=uuid(),held=[];
  let committed=false;
  try{
    const first=(await db.ref('erp/tickets/'+ticketId).get()).val();
    if(!first){
      const prior=fromReceipt((await opRef.get()).val());
      if(prior)return prior;
      conflict(404,'PURCHASE_NOT_FOUND','A compra não existe mais. Atualize o Histórico.');
    }
    if(!same(first.ticket||ticketId,ticketId))conflict(409,'TICKET_MISMATCH','O ticket não corresponde ao pedido registrado.');
    const supplier=validKey(first.fornecedorCod||first.fornCod,'Fornecedor');
    const payablesInitial=(await db.ref('erp/contasPagar').get()).val();
    const payableMatches=asRows(payablesInitial).filter(([id,row])=>same(row.ticket,ticketId)||same(row.id,'CPPO_'+ticketId)||same(id,'CPPO_'+ticketId));
    if(payableMatches.length>1)conflict(409,'MULTIPLE_PAYABLES','A compra possui vários títulos financeiros. Solicite conciliação antes de excluir.');
    if(payableMatches.length&&!identity.canPayables&&!identity.canFinance)conflict(403,'PAYABLES_REQUIRED','É necessário acesso financeiro para excluir esta compra com título pendente.');
    if(payableMatches.length){
      const [id,row]=payableMatches[0];
      const payableLock=db.ref('erpFinancePayableLocks/'+validKey(row.id||id,'Título'));
      await acquire(payableLock,owner,now);
      held.push({ref:payableLock,path:'erpFinancePayableLocks/'+validKey(row.id||id,'Título')});
    }
    const ticketLock=db.ref('erpFinancePayableTicketLocks/'+ticketId);
    await acquire(ticketLock,owner,now);
    held.push({ref:ticketLock,path:'erpFinancePayableTicketLocks/'+ticketId});
    const sources=['tickets/'+ticketId,'contasPagar','adiantamentos/'+supplier,'cheques/'+supplier,'lancBanco',
      'saldos/'+supplier,'saldoDevedor/'+supplier,'financePayableOperations','financeAdvanceOperations',
      'ticketsDeletedV2/'+ticketId];
    const snapshots=await Promise.all(sources.map(path=>db.ref('erp/'+path).get()));
    const [ticket,payables,advances,cheques,bank,saldo,saldoDevedor,paymentOps,advanceOps,tombstone]=snapshots.map(s=>s.val());
    const prior=fromReceipt((await opRef.get()).val());
    if(prior)return prior;
    if(!ticket||tombstone)conflict(409,'PURCHASE_CHANGED','A compra foi alterada ou excluída em outra sessão. Atualize a página.');
    if(!same(ticket.ticket||ticketId,ticketId)||!same(ticket.fornecedorCod||ticket.fornCod,supplier))conflict(409,'PURCHASE_CHANGED','A compra foi modificada em outra sessão.');
    if(input.expectedTotal!=null&&cents(ticket.totalGeral)!==cents(input.expectedTotal))conflict(409,'PURCHASE_CHANGED','O valor da compra mudou. Atualize a página.');
    if(input.expectedSupplier!=null&&!same(input.expectedSupplier,supplier))conflict(409,'PURCHASE_CHANGED','O fornecedor da compra mudou. Atualize a página.');
    const currentPayables=asRows(payables).filter(([id,row])=>same(row.ticket,ticketId)||same(row.id,'CPPO_'+ticketId)||same(id,'CPPO_'+ticketId));
    if(currentPayables.length!==payableMatches.length||currentPayables.some(([id])=>!payableMatches.some(([old])=>same(old,id))))
      conflict(409,'PAYABLE_CHANGED','O título desta compra mudou. Atualize a tela.');
    const total=cents(ticket.totalGeral||0),remaining=cents(ticket.saldoPagar||0);
    let refund=null,advanceRows=null;
    if(advanceOnlyReceipt(ticket)){
      const applied=cents(ticket.adiantamento||0);
      if(currentPayables.some(([,row])=>!payableWithoutPayment(row)))
        conflict(409,'PURCHASE_HAS_PAYMENTS','A compra possui baixa financeira registrada. Estorne o pagamento antes de excluir.');
      if(applied<=0||applied+remaining!==total)
        conflict(409,'PURCHASE_HAS_FINANCE','Os valores desta compra não fecham com o adiantamento aplicado. Solicite conciliação antes de excluir.');
      if(currentPayables.some(([id,row])=>!same(id,'CPPO_'+ticketId)||!same(row.id,'CPPO_'+ticketId)))
        conflict(409,'LEGACY_PAYABLE_REVIEW','Este pedido possui um título financeiro antigo que precisa de revisão antes de excluir.');
      if(remaining>0&&(currentPayables.length!==1||cents(currentPayables[0][1].valor||0)!==remaining))
        conflict(409,'PAYABLE_CHANGED','A conta a pagar desta compra não confere com o saldo. Atualize a tela.');
      if(currentPayables.some(([,row])=>row.fornCod&&!same(row.fornCod,supplier)))
        conflict(409,'SUPPLIER_MISMATCH','A conta a pagar pertence a outro fornecedor.');
      const purchaseBank=Object.fromEntries(asRows(bank).filter(([,row])=>row.source!=='advance'&&!row.advanceCode));
      if(hasTicketRef(cheques,ticketId)||hasTicketRef(saldo,ticketId)||hasTicketRef(saldoDevedor,ticketId)||
        hasTicketRef(paymentOps,ticketId)||linkedBank(purchaseBank,currentPayables,ticketId))
        conflict(409,'PURCHASE_HAS_LINKS','Existem outros vínculos financeiros nesta compra. Não é possível excluí-la sem estorno e conciliação.');
      const advanceLock=db.ref('erpFinanceAdvanceLocks/'+supplier);
      await acquire(advanceLock,owner,now);
      held.push({ref:advanceLock,path:'erpFinanceAdvanceLocks/'+supplier});
      const liveTicket=(await db.ref('erp/tickets/'+ticketId).get()).val();
      if(!liveTicket||JSON.stringify(liveTicket)!==JSON.stringify(ticket))conflict(409,'PURCHASE_CHANGED','A compra mudou durante a exclusão. Atualize o Histórico.');
      const ledger=(await db.ref('erp/adiantamentos/'+supplier).get()).val();
      const result=refundAdvanceReceipt(ticket,ledger,applied,ticketId,now());
      advanceRows=result.records;
      refund={valor:applied/100,adiantamentos:result.refunds};
    }
    if(!refund&&(String(ticket.status||'').toLocaleLowerCase('pt-BR')==='pago'||
      cents(ticket.adiantamento||0)!==0||hasFinancialReceipt(ticket)||
      (total>0&&remaining!==total)||
      (ticket._pagoUndo!=null)))
      conflict(409,'PURCHASE_HAS_FINANCE','Esta compra possui pagamento ou adiantamento. Para removê-la é necessário cancelar e estornar as operações financeiras.');
    if(!refund&&ticket._consolidado===true&&cents(ticket.totalGeral||0)>0&&currentPayables.length!==1)
      conflict(409,'PURCHASE_PAYABLE_MISSING','A conta a pagar desta compra não foi localizada. Atualize o Financeiro antes de excluir.');
    if(currentPayables.some(([id,row])=>!same(id,'CPPO_'+ticketId)||!same(row.id,'CPPO_'+ticketId)))
      conflict(409,'LEGACY_PAYABLE_REVIEW','Este pedido possui um título financeiro antigo que precisa de revisão antes de excluir.');
    if(!refund&&currentPayables.some(([,row])=>isPaidPayable(row)))
      conflict(409,'PURCHASE_HAS_PAYMENTS','A compra possui baixa financeira registrada. Não é possível excluir diretamente.');
    if(currentPayables.some(([,row])=>row.fornCod&&!same(row.fornCod,supplier)))
      conflict(409,'SUPPLIER_MISMATCH','A conta a pagar pertence a outro fornecedor.');
    if(!refund&&(hasTicketRef(advances,ticketId)||hasTicketRef(cheques,ticketId)||
      hasTicketRef(saldo,ticketId)||hasTicketRef(saldoDevedor,ticketId)||
      hasTicketRef(paymentOps,ticketId)||hasTicketRef(advanceOps,ticketId)||
      linkedBank(bank,currentPayables,ticketId)))
      conflict(409,'PURCHASE_HAS_LINKS','Existem vínculos financeiros nesta compra. Não é possível excluí-la sem estorno e conciliação.');
    const deletedAt=now();
    const receipt={status:'CONFIRMED',ticketNo:ticketId,supplierCode:supplier,deletedPayableIds:currentPayables.map(([id,row])=>String(row.id||id)),deletedAt,actor,
      ...(refund?{advanceRefund:refund}:{})};
    const updates={['tickets/'+ticketId]:null,['ticketsDeletedV2/'+ticketId]:true,
      ['purchaseDeleteOperations/'+actor+'_'+operationId]:receipt,_ts:deletedAt};
    if(advanceRows)updates['adiantamentos/'+supplier]=advanceRows;
    for(const [path,row] of currentPayables){
      updates['contasPagar/'+path]=null;
      if(row.id)updates['contasPagarDeleted/'+validKey(row.id,'Título')]=true;
    }
    const atomic=Object.fromEntries(Object.entries(updates).map(([path,value])=>['erp/'+path,value]));
    for(const lock of held){
      const live=(await lock.ref.get()).val();
      if(live?.owner!==owner)conflict(409,'PURCHASE_CHANGED','A operação mudou durante a exclusão. Atualize o Histórico.');
      atomic[lock.path]=null;
    }
    try{await db.ref().update(atomic);committed=true;}
    catch(error){
      const verified=fromReceipt((await opRef.get().catch(()=>({val:()=>null}))).val());
      if(verified){committed=true;return verified;}
      throw error;
    }
    return advanceRows?{...receipt,advances:advanceRows}:receipt;
  }finally{
    if(!committed){
      for(const lock of held.reverse())await release(lock.ref,owner);
    }
  }
}
