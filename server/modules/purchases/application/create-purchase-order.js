import {randomUUID} from 'node:crypto';
import {acquireLease,releaseLeases} from '../../../shared/firebase/rtdb-transaction.js';
import {installmentPayableIds,installmentPayables,normalizeInstallments} from '../domain/installments.js';

function fail(status,code,message){const e=new Error(message);e.status=status;e.code=code;throw e;}
function id(value){const s=String(value??'').trim();if(!/^[\w-]{1,80}$/.test(s))fail(422,'INVALID_ID','Identificador inválido.');return s;}
function cents(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>1e-5)fail(422,'INVALID_AMOUNT','Valor financeiro inválido.');return Math.round(value*100);}
const money=value=>Math.round(value)/100;
const clone=value=>JSON.parse(JSON.stringify(value));
const rows=value=>Array.isArray(value)?clone(value):(value&&typeof value==='object'?clone(value):[]);
const entries=value=>Object.entries(value||{}).filter(([,row])=>row&&typeof row==='object'&&!Array.isArray(row));
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))fail(422,'INVALID_DATE','Data inválida.');return String(value);}
function operationKey(identity,operationId){return id(String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_'))+'_'+id(operationId);}
function findAdvance(list,code){const matches=entries(list).filter(([,a])=>String(a.cod||'')===code);if(matches.length!==1)fail(409,'ADVANCE_CHANGED','Adiantamento inexistente ou duplicado. Atualize o formulário.');return matches[0][1];}
function verifyLegacyCredit(raw,tickets,advances,code){
  if(!raw||typeof raw!=='object'||!raw.ticket)fail(409,'CREDIT_UNVERIFIED','O crédito anterior não tem origem verificável. Solicite conciliação.');
  const origin=id(raw.ticket),source=tickets[origin];
  if(!source||String(source.fornecedorCod||source.fornCod||'')!==code||!['Pago','Quitado'].includes(String(source.status||'')))fail(409,'CREDIT_UNVERIFIED','A compra de origem do crédito não está comprovada.');
  const total=cents(Number(source.totalGeral)),gross=cents(Number(source.adiantamento));
  if(gross<=total)fail(409,'CREDIT_UNVERIFIED','A compra de origem não comprova o crédito residual.');
  const matching=entries(advances).filter(([,a])=>a.status==='Quitado'&&String(a.ticket||'')===origin&&!String(a.forma||'').toLowerCase().includes('cheque'));
  if(matching.length!==1||cents(Number(matching[0][1].valor))!==gross)fail(409,'CREDIT_UNVERIFIED','O adiantamento de origem não possui vínculo financeiro único.');
  let spent=0;
  for(const ticket of Object.values(tickets)){
    if(!ticket||typeof ticket!=='object'||String(ticket.fornecedorCod||ticket.fornCod||'')!==code)continue;
    if(String(ticket.creditoFornecedorOrigem||'')===origin)spent+=cents(Number(ticket.creditoFornecedorAplicado||0));
  }
  const balance=cents(Number(raw.valor));
  if(balance<=0||gross-total-spent!==balance)fail(409,'CREDIT_CHANGED','O saldo residual não coincide com as compras e abatimentos confirmados.');
  return {source:origin,balance};
}
function normalizeTicket(input,ticketNo,code){
  const ticket=input.ticket;
  if(!ticket||typeof ticket!=='object'||Array.isArray(ticket)||String(ticket.ticket||'')!==ticketNo||String(ticket.fornecedorCod||'')!==code)fail(422,'INVALID_TICKET','Pedido ou fornecedor divergente.');
  if(!Array.isArray(ticket.itens)||!ticket.itens.length||ticket.itens.length>200)fail(422,'INVALID_ITEMS','Informe materiais válidos.');
  const products=ticket.itens.reduce((sum,item)=>{
    if(!item||!String(item.mat||'').trim())fail(422,'INVALID_ITEMS','Material inválido.');
    const qty=Number(item.pesoLiq??item.quantidade),price=Number(item.preco);
    if(!Number.isFinite(qty)||qty<=0||qty>1e7||!Number.isFinite(price)||price<0||price>1e7)fail(422,'INVALID_ITEMS','Quantidade ou preço inválidos.');
    return sum+Math.round(qty*price*100);
  },0);
  const discount=cents(Number(ticket.descontoCompra||0)),freight=cents(Number(ticket.freteCompra||0));
  const rawExtra=Number(ticket.acrescimo||0);
  const extra=rawExtra<0?-cents(-rawExtra):cents(rawExtra);
  const total=products-discount+freight+extra;
  if(total<=0||Math.abs(total-cents(Number(ticket.totalGeral)))>1)fail(422,'TOTAL_MISMATCH','Valor da compra não corresponde aos materiais.');
  const next=clone(ticket);
  next.ticket=ticketNo;next.numeroPedido=ticketNo;next.fornecedorCod=code;
  next.totalProdutos=money(products);next.totalGeral=money(total);
  next.dataCompra=date(next.dataCompra||next.data);next.vencimentoSaldo=date(next.vencimentoSaldo||next.dataCompra);
  next._consolidado=true;
  return {ticket:next,total};
}

export async function createPurchaseOrder(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  if(identity?.erpAccess!==true||identity?.canPurchasing!==true)fail(403,'PURCHASE_FORBIDDEN','Sem permissão de Compras.');
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Requisição inválida.');
  const ticketNo=id(input.ticketNo),code=id(input.fornecedorCod),operationId=id(input.operationId);
  if(!/^[a-f\d-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Identificador da operação inválido.');
  const selected=[...(input.advanceCodes||[])].map(id),selectedCheques=[...(input.chequeIds||[])].map(id);
  if(selected.length>100||selectedCheques.length>100||new Set(selected).size!==selected.length||new Set(selectedCheques).size!==selectedCheques.length)fail(422,'INVALID_SELECTION','Seleção financeira inválida.');
  const credit=Boolean(input.useLegacyCredit);
  if(credit&&(selected.length||selectedCheques.length))fail(422,'MIXED_CREDITS','Para consumir o saldo residual, não selecione outros adiantamentos ou cheques na mesma compra.');
  const sources=(input.sourceTicketKeys||[]).map(id);
  if(sources.length>50||new Set(sources).size!==sources.length||sources.includes(ticketNo))fail(422,'INVALID_SOURCE','Pesagem inválida.');
  const {ticket:incoming,total}=normalizeTicket(input,ticketNo,code);
  db=db||(await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey=operationKey(identity,operationId),opRef=db.ref('erp/purchaseCreateOperations/'+opKey);
  const sameOperation=record=>{
    if(!record?.ticket)return null;
    if(record.ticket.ticket!==ticketNo||Math.abs(Number(record.ticket.totalGeral||0)-Number(incoming.totalGeral||0))>0.01)fail(409,'OPERATION_REUSED','Operação já utilizada com outro conteúdo.');
    return {...record,alreadyCommitted:true};
  };
  const previous=sameOperation((await opRef.get()).val());
  if(previous)return previous;
  const owner=uuid(),held=[];
  const lockKeys=['erpFinancePayableTicketLocks/'+ticketNo];
  if(selected.length||selectedCheques.length||credit)lockKeys.push('erpFinanceAdvanceLocks/'+code);
  let committed=false;
  try{
    for(const lockPath of lockKeys){
      const ref=db.ref(lockPath);
      const acquired=await acquireLease(ref,owner,{now,ttlMs:120000,meta:{kind:'purchase-create',operationKey:opKey}});
      if(!acquired){
        const live=(await ref.get()).val();
        const seconds=Math.ceil((Number(live?.expiresAt)-now())/1000);
        const error=new Error('Outra operação desta compra ou deste fornecedor está em andamento. Aguarde alguns segundos e tente novamente.');
        error.status=409;error.code='PURCHASE_IN_PROGRESS';
        if(Number.isFinite(seconds)&&seconds>0)error.retryAfterSeconds=Math.min(seconds,120);
        throw error;
      }
      held.push({ref,path:lockPath});
    }

    const repeated=sameOperation((await opRef.get()).val());
    if(repeated)return repeated;
    const [existingSnap,deletedSnap,advancesSnap,creditSnap,mirrorSnap,chequesSnap,...sourceSnaps]=await Promise.all([
      db.ref('erp/tickets/'+ticketNo).get(),
      db.ref('erp/ticketsDeletedV2/'+ticketNo).get(),
      db.ref('erp/adiantamentos/'+code).get(),
      db.ref('erp/saldoDevedor/'+code).get(),
      credit?db.ref('erp/saldos/'+code).get():Promise.resolve(null),
      db.ref('erp/cheques/'+code).get(),
      ...sources.map(sourceId=>db.ref('erp/tickets/'+sourceId).get())
    ]);
    if(existingSnap.val()||deletedSnap.val())fail(409,'TICKET_EXISTS','Número da compra já utilizado. Atualize o histórico.');
    const sourceTickets={};
    sources.forEach((sourceId,index)=>{
      const row=sourceSnaps[index].val();
      if(!row||String(row.fornecedorCod||row.fornCod||'')!==code||row._consolidadoEm||row._balFinalizado!==true||String(row.status||'')!=='Aguard. Preço')fail(409,'SOURCE_CHANGED','Pesagem já finalizada ou alterada por outro usuário.');
      sourceTickets[sourceId]=row;
    });
    const advanceRows=rows(advancesSnap.val()),chequeRows=rows(chequesSnap.val());
    const updates={},receipts=[],chequeReceipts=[];
    let remaining=total,legacy=null,usedCredit=0;
    if(credit){
      const allTickets=(await db.ref('erp/tickets').get()).val()||{};
      legacy=verifyLegacyCredit(creditSnap.val(),allTickets,advanceRows,code);
      usedCredit=Math.min(legacy.balance,remaining);remaining-=usedCredit;
      const rest=legacy.balance-usedCredit;
      updates['erp/saldoDevedor/'+code]=rest>0?{...clone(creditSnap.val()),valor:money(rest)}:null;
      const mirror=mirrorSnap?.val?.();
      if(mirror!=null)updates['erp/saldos/'+code]=rest>0?{...(typeof mirror==='object'?clone(mirror):{}),valor:money(rest),ticket:legacy.source}:null;
    }
    const linkedPurchases=new Map();
    for(const advanceCode of selected){
      const adt=findAdvance(advanceRows,advanceCode);
      if(String(adt.status||'')!=='Pendente')fail(409,'ADVANCE_CHANGED','Este adiantamento já foi utilizado ou alterado. Atualize a tela de compra.');
      const linked=String(adt.ticketOrigem||adt.ticket||'');
      if(linked&&linked!==ticketNo&&!sources.includes(linked)){
        if(!linkedPurchases.has(linked))linkedPurchases.set(linked,/^[\w-]{1,80}$/.test(linked)?(await db.ref('erp/tickets/'+linked).get()).val():null);
        const originalPurchase=linkedPurchases.get(linked);
        const alreadyPartiallyUsed=cents(Number(adt.valorCompensado||0))>0&&
          originalPurchase&&['Pago','Quitado'].includes(String(originalPurchase.status||''));
        if(!alreadyPartiallyUsed)fail(409,'ADVANCE_LINKED','O adiantamento '+advanceCode+' está reservado a outra compra ('+linked+').');
      }
      const available=cents(Number(adt.valor)),prior=cents(Number(adt.valorCompensado||0));
      const original=cents(Number(adt.valorOriginal??money(available+prior)));
      if(available<=0||original!==available+prior)fail(409,'ADVANCE_CHANGED','Saldo do adiantamento '+advanceCode+' inconsistente. Solicite conferência financeira.');
      const applied=Math.min(available,remaining);
      if(applied===0)continue;
      remaining-=applied;
      adt.valorOriginal=money(original);adt.valorCompensado=money(prior+applied);
      const balance=original-prior-applied;
      adt.valor=money(balance>0?balance:original);
      adt.valorDisponivel=money(balance);
      adt.status=balance===0?'Quitado':'Pendente';
      if(adt.status==='Quitado')adt.ticket=ticketNo;
      receipts.push({cod:advanceCode,valorOriginal:money(original),valorAplicado:money(applied),valorPendente:money(original-prior-applied),data:adt.data||'',forma:adt.forma||'',bancoNome:adt.bancoNome||''});
    }
    for(const chequeId of selectedCheques){
      const matches=entries(chequeRows).filter(([,c])=>String(c.id||c.num||c.numero||'')===chequeId);
      if(matches.length!==1||matches[0][1].status!=='Pendente'||matches[0][1]._aplicadoTicket)fail(409,'CHEQUE_CHANGED','Cheque não está mais disponível.');
      const cheque=matches[0][1],value=cents(Number(cheque.valor));
      if(value>remaining)fail(409,'CHEQUE_PARTIAL_UNSUPPORTED','Cheque não pode ser parcialmente aplicado; ajuste a seleção.');
      remaining-=value;cheque.status='Quitado';cheque._aplicadoTicket=ticketNo;cheque.vinculo=cheque.vinculo||ticketNo;
      chequeReceipts.push({id:cheque.id||'',num:cheque.num||cheque.numero||'',valorOriginal:money(value),valorAplicado:money(value),valorPendente:0});
    }
    const applied=total-remaining;
    incoming.adiantamento=money(applied);incoming.saldoAnterior=0;incoming.saldoPagar=money(remaining);
    incoming.status=remaining===0?'Pago':'Pendente';
    const installments=normalizeInstallments(input.ticket.parcelas,{balanceCents:remaining,purchaseDate:incoming.dataCompra,defaultDueDate:incoming.vencimentoSaldo});
    if(installments.length){incoming.parcelas=installments;incoming.vencimentoSaldo=installments[0].vencimento;}
    else delete incoming.parcelas;
    incoming.reciboFinanceiro={versao:2,total:money(applied),adiantamentos:receipts,cheques:chequeReceipts,
      ...(credit?{creditos:[{ticketOrigem:legacy.source,valorAplicado:money(usedCredit)}]}:{})};
    if(credit){incoming.creditoFornecedorOrigem=legacy.source;incoming.creditoFornecedorAplicado=money(usedCredit);}
    else {delete incoming.creditoFornecedorOrigem;delete incoming.creditoFornecedorAplicado;}
    updates['erp/tickets/'+ticketNo]=incoming;
    if(receipts.length)updates['erp/adiantamentos/'+code]=advanceRows;
    if(chequeReceipts.length)updates['erp/cheques/'+code]=chequeRows;
    for(const sourceId of sources)updates['erp/tickets/'+sourceId]={...sourceTickets[sourceId],_balFinalizado:false,status:'Consolidado',_consolidadoEm:ticketNo};
    const payableIds=installmentPayableIds(ticketNo,installments.length);
    const existingPayables=installments.length?await Promise.all(payableIds.map(id=>db.ref('erp/contasPagar/'+id).get())):[];
    if(existingPayables.some(snap=>snap.val()))fail(409,'PAYABLE_EXISTS','Conta a pagar já existe para este ticket.');
    const payables=installmentPayables({ticketNo,supplierCode:code,supplierName:incoming.fornecedor||incoming.fornecedorNome||'',
      descriptionName:incoming.fornecedor||'',purchaseDate:incoming.dataCompra,installments});
    for(const row of payables)updates['erp/contasPagar/'+row.id]=row;
    const payable=payables[0]||null;
    const receipt={ticket:incoming,advances:advanceRows,cheques:chequeRows,
      saldo:credit?updates['erp/saldoDevedor/'+code]:creditSnap.val(),payable,payables,fornCod:code,at:now(),actor:String(identity.erpUser||identity.uid||'')};
    updates['erp/purchaseCreateOperations/'+opKey]=receipt;
    updates['erp/_ts']=now();
    for(const lock of held){
      const live=(await lock.ref.get()).val();
      if(live?.owner!==owner)fail(409,'PURCHASE_CHANGED','A compra mudou durante a gravação. Consulte o Histórico.');
      updates[lock.path]=null;
    }
    try{await db.ref().update(updates);committed=true;}
    catch(error){
      const recovered=(await opRef.get().catch(()=>({val:()=>null}))).val();
      if(recovered?.ticket&&recovered.ticket.ticket===ticketNo){committed=true;return {...recovered,alreadyCommitted:true};}
      throw error;
    }
    return {...receipt,alreadyCommitted:false};
  }finally{
    if(!committed)await releaseLeases(held,owner,{label:'purchase.create.lock.release'});
  }
}
