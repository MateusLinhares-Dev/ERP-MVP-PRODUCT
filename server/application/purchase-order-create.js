import {randomUUID} from 'node:crypto';

// Criação com atribuição financeira autoritativa: pedido, abatimentos, saldo e
// conta a pagar são confirmados em UMA atualização do Realtime Database.
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
  const extra=cents(Number(ticket.acrescimo||0));
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
  if(sources.length>50||new Set(sources).size!==sources.length)fail(422,'INVALID_SOURCE','Pesagem inválida.');
  const {ticket:incoming,total}=normalizeTicket(input,ticketNo,code);
  db=db||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey=operationKey(identity,operationId),opRef=db.ref('erp/purchaseCreateOperations/'+opKey);
  const previous=(await opRef.get()).val();
  if(previous?.ticket){if(previous.ticket.ticket!==ticketNo||Math.abs(Number(previous.ticket.totalGeral||0)-Number(incoming.totalGeral||0))>0.01)fail(409,'OPERATION_REUSED','Operação já utilizada com outro conteúdo.');return {...previous,alreadyCommitted:true};}
  const lockRef=db.ref('erpFinanceAdvanceLocks/'+code),owner=uuid();
  const lock=await lockRef.transaction(current=>current&&Number(current.expiresAt)>now()?undefined:{owner,expiresAt:now()+120000},undefined,false);
  if(!lock?.committed)fail(409,'FINANCE_BUSY','Outro lançamento financeiro desse fornecedor está em andamento.');
  let committed=false;
  try{
    const repeated=(await opRef.get()).val();
    if(repeated?.ticket){if(repeated.ticket.ticket!==ticketNo||Math.abs(Number(repeated.ticket.totalGeral||0)-Number(incoming.totalGeral||0))>0.01)fail(409,'OPERATION_REUSED','Operação já utilizada com outro conteúdo.');return {...repeated,alreadyCommitted:true};}
    const snap=await Promise.all(['tickets','ticketsDeletedV2','adiantamentos/'+code,'saldoDevedor/'+code,'cheques/'+code,'contasPagar'].map(path=>db.ref('erp/'+path).get()));
    const allTickets=snap[0].val()||{},deleted=snap[1].val()||{};
    if(allTickets[ticketNo]||deleted[ticketNo])fail(409,'TICKET_EXISTS','Número da compra já utilizado. Atualize o histórico.');
    for(const sourceId of sources){
      const row=allTickets[sourceId];
      if(!row||String(row.fornecedorCod||row.fornCod||'')!==code||row._consolidadoEm||row._balFinalizado!==true||String(row.status||'')!=='Aguard. Preço')fail(409,'SOURCE_CHANGED','Pesagem já finalizada ou alterada por outro usuário.');
    }
    const advanceRows=rows(snap[2].val()),chequeRows=rows(snap[4].val());
    const updates={},receipts=[],chequeReceipts=[];
    let remaining=total,legacy=null,usedCredit=0;
    if(credit){
      legacy=verifyLegacyCredit(snap[3].val(),allTickets,advanceRows,code);
      usedCredit=Math.min(legacy.balance,remaining);remaining-=usedCredit;
      updates['erp/saldoDevedor/'+code]=legacy.balance-usedCredit>0?{...clone(snap[3].val()),valor:money(legacy.balance-usedCredit)}:null;
    }
    for(const advanceCode of selected){
      const adt=findAdvance(advanceRows,advanceCode);
      if(String(adt.status||'')!=='Pendente'||String(adt.forma||'').toLowerCase().includes('cheque'))fail(409,'ADVANCE_CHANGED','Este adiantamento já foi utilizado ou alterado.');
      const linked=String(adt.ticketOrigem||adt.ticket||'');
      if(linked&&!sources.includes(linked)){
        const originalPurchase=allTickets[linked];
        const alreadyPartiallyUsed=cents(Number(adt.valorCompensado||0))>0&&
          originalPurchase&&['Pago','Quitado'].includes(String(originalPurchase.status||''));
        if(!alreadyPartiallyUsed)fail(409,'ADVANCE_LINKED','Este adiantamento está reservado a outra compra.');
      }
      const available=cents(Number(adt.valor)),prior=cents(Number(adt.valorCompensado||0));
      const original=cents(Number(adt.valorOriginal??money(available+prior)));
      if(available<=0||original!==available+prior)fail(409,'ADVANCE_CHANGED','Saldo do adiantamento inconsistente.');
      const applied=Math.min(available,remaining);
      if(applied===0)continue;
      remaining-=applied;
      adt.valorOriginal=money(original);adt.valorCompensado=money(prior+applied);
      const balance=original-prior-applied;
      // Quitado preserva o valor histórico da transferência bancária;
      // a disponibilidade fica em campo próprio (não exibir R$ 0 como transferido).
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
    incoming.reciboFinanceiro={versao:2,total:money(applied),adiantamentos:receipts,cheques:chequeReceipts,
      ...(credit?{creditos:[{ticketOrigem:legacy.source,valorAplicado:money(usedCredit)}]}:{})};
    if(credit){incoming.creditoFornecedorOrigem=legacy.source;incoming.creditoFornecedorAplicado=money(usedCredit);}
    else {delete incoming.creditoFornecedorOrigem;delete incoming.creditoFornecedorAplicado;}
    updates['erp/tickets/'+ticketNo]=incoming;
    if(receipts.length)updates['erp/adiantamentos/'+code]=advanceRows;
    if(chequeReceipts.length)updates['erp/cheques/'+code]=chequeRows;
    for(const sourceId of sources)updates['erp/tickets/'+sourceId]={...allTickets[sourceId],_balFinalizado:false,status:'Consolidado',_consolidadoEm:ticketNo};
    let payable=null;
    if(remaining>0){
      const payableId='CPPO_'+ticketNo;
      if((snap[5].val()||{})[payableId])fail(409,'PAYABLE_EXISTS','Conta a pagar já existe para este ticket.');
      const due=incoming.vencimentoSaldo.split('-').reverse().join('/');
      payable={id:payableId,ticket:ticketNo,fornCod:code,cred:incoming.fornecedor||incoming.fornecedorNome||'',desc:'Compra de Sucata — '+(incoming.fornecedor||'')+' — '+ticketNo,
        cat:'Compra de Sucata',tipoForn:'compra',lancto:incoming.dataCompra.split('-').reverse().join('/'),venc:due,valor:money(remaining),status:'Pendente',dataPgto:'',bancoCod:'',bancoNome:'',obs:'Gerado automaticamente — Pedido '+ticketNo};
      updates['erp/contasPagar/'+payableId]=payable;
    }
    const receipt={ticket:incoming,advances:advanceRows,cheques:chequeRows,
      saldo:credit?updates['erp/saldoDevedor/'+code]:snap[3].val(),payable,fornCod:code,at:now(),actor:String(identity.erpUser||identity.uid||'')};
    updates['erp/purchaseCreateOperations/'+opKey]=receipt;
    updates['erp/_ts']=now();
    // Liberar a trava no MESMO update; não deixar gravação confirmada com lock pendente.
    updates['erpFinanceAdvanceLocks/'+code]=null;
    try{await db.ref().update(updates);committed=true;}
    catch(error){
      const recovered=(await opRef.get().catch(()=>({val:()=>null}))).val();
      if(recovered?.ticket&&recovered.ticket.ticket===ticketNo){committed=true;return {...recovered,alreadyCommitted:true};}
      throw error;
    }
    return {...receipt,alreadyCommitted:false};
  }finally{
    if(!committed){
      // Se a situação do commit é desconhecida, o lease expira; o recibo é a prova.
      try{const verified=(await opRef.get()).val();if(!verified?.ticket)await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}
    }
  }
}
