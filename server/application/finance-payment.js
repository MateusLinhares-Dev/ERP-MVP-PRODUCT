import {createHash,randomUUID} from 'node:crypto';

const fail=(status,code,message)=>{const error=new Error(message);error.status=status;error.code=code;throw error;};
const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const key=(value)=>{const text=clean(value,120);if(!text||/[.#$\[\]/\u0000-\u001f\u007f]/.test(text))fail(422,'INVALID_KEY','Identificador inválido.');return text;};
const cents=(value,allowZero=false)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||(!allowZero&&value===0)||Math.round(value*100)!==value*100&&Math.abs(Math.round(value*100)-value*100)>0.000001||value>1e9)fail(422,'INVALID_AMOUNT','Valor monetário inválido.');return Math.round(value*100);};
const money=value=>Math.round(value)/100;
const entries=value=>Object.entries(value&&typeof value==='object'?value:{}).filter(([,record])=>record&&typeof record==='object'&&!Array.isArray(record));
const dateISO=value=>{const date=clean(value,10),parsed=new Date(date+'T12:00:00.000Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)fail(422,'INVALID_DATE','Data inválida.');return date;};
const displayDate=value=>value.split('-').reverse().join('/');
const bankListClaims=['canFinance','canAdvances','canPayables','canReceivables','canBanking','canPurchasing','canSales','canCustomers','canSuppliers','canContracts','canFleet','canPayroll','canExpenses'];
const canList=identity=>identity?.erpAccess===true&&bankListClaims.some(claim=>identity[claim]===true);
async function database(db){return db||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;}
const banks=value=>entries(value).map(([id,b])=>({cod:clean(b.cod||b.codigo||b.id||id),banco:clean(b.banco||b.nomeBanco||b.nome)})).filter(b=>b.cod&&b.banco);
const LOCK_TTL_MS=120000;
// Nunca roubar um bloqueio ainda válido. A operação poderá ter gravado no Firebase
// mesmo quando a resposta HTTP se perdeu: nesse caso o comprovante é a fonte da verdade.
async function recoverPaymentResult(opRef,originalLock,operationKey,{sleep}){
  const waits=originalLock?.operationKey===operationKey?6:1;
  for(let attempt=0;attempt<waits;attempt++){
    const operation=(await opRef.get()).val();
    if(operation?.result)return operation;
    if(attempt+1<waits)await sleep(250);
  }
  return null;
}
function inProgress(lock,now){
  const seconds=Math.max(1,Math.min(120,Math.ceil((Number(lock?.expiresAt||0)-now())/1000)));
  const error=new Error('Há uma baixa em processamento para este título. Não confirme novamente antes da conclusão ou do prazo informado.');
  error.status=409;error.code='PAYMENT_IN_PROGRESS';error.retryAfterSeconds=seconds;
  throw error;
}


export async function listPaymentBanks(identity,{db}={}){
  if(!canList(identity))fail(403,'PAYMENT_BANKS_FORBIDDEN','Seu perfil não pode consultar as opções de pagamento.');
  const instance=await database(db);
  const items=banks((await instance.ref('erp/bancos').get()).val());
  items.sort((a,b)=>a.banco.localeCompare(b.banco,'pt-BR')||a.cod.localeCompare(b.cod,'pt-BR'));
  return {banks:items};
}

export async function payPayable(identity,input,{db,now=()=>Date.now(),uuid=randomUUID,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(identity?.erpAccess!==true||identity.canPayables!==true)fail(403,'PAYABLES_REQUIRED','Sem acesso a Contas a Pagar.');
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Solicitação inválida.');
  const id=key(input.payableId),operationId=key(input.operationId),bankCode=input.bankCode?key(input.bankCode):'',date=dateISO(input.date);
  if(!/^[a-f0-9-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Operação inválida.');
  const payCents=cents(input.amount,true),advanceCents=cents(input.advanceAmount??0,true);
  if(payCents+advanceCents<=0)fail(422,'INVALID_AMOUNT','Informe o valor do pagamento ou da compensação.');
  if(payCents&&!bankCode)fail(422,'BANK_REQUIRED','Selecione a conta bancária.');
  if(!payCents&&bankCode)fail(422,'INVALID_BANK','Banco não é necessário para compensação integral.');
  const instance=await database(db);
  const opKey=key(String(identity.uid||identity.erpUser||'user').replace(/[^a-zA-Z0-9_-]/g,'_'))+'_'+operationId;
  const opRef=instance.ref('erp/financePayableOperations/'+opKey);
  const expected=input.expected||{};
  if(typeof expected!=='object'||Array.isArray(expected))fail(422,'INVALID_EXPECTED','Versão esperada inválida.');
  const signature=createHash('sha256').update(JSON.stringify({id,date,bankCode,payCents,advanceCents,fornCod:clean(input.fornCod),expected})).digest('hex');
  const resultIfCommitted=record=>{
    if(!record?.result)return null;
    if(record.requestSignature&&record.requestSignature!==signature)fail(409,'OPERATION_USED','Esta tentativa já foi usada com outros dados. Atualize a conta antes de tentar novamente.');
    return {...record.result,alreadyCommitted:true};
  };
  const previous=(await opRef.get()).val();
  const replay=resultIfCommitted(previous);
  if(replay)return replay;
  const lockRef=instance.ref('erpFinancePayableLocks/'+id),owner=uuid();
  let claimed=await lockRef.transaction(current=>current&&current.expiresAt>now()?undefined:{owner,operationKey:opKey,expiresAt:now()+LOCK_TTL_MS},undefined,false);
  if(!claimed.committed){
    const lock=claimed.snapshot?.val?.()||(await lockRef.get()).val();
    const completed=await recoverPaymentResult(opRef,lock,opKey,{sleep});
    const recovered=resultIfCommitted(completed);
    if(recovered)return recovered;
    // A requisição que reteve o lock pode ter sido interrompida. Se o prazo já
    // terminou durante a espera, só o próprio transaction pode reassumir o lock.
    if(Number(lock?.expiresAt||0)<=now()){
      claimed=await lockRef.transaction(current=>current&&current.expiresAt>now()?undefined:{owner,operationKey:opKey,expiresAt:now()+LOCK_TTL_MS},undefined,false);
    }
    if(!claimed.committed)inProgress(claimed.snapshot?.val?.()||(await lockRef.get()).val(),now);
  }
  let supplierLock=null,ticketLock=null;
  try{
    const committed=(await opRef.get()).val();
    const committedResult=resultIfCommitted(committed);
    if(committedResult)return committedResult;
    const rawPayables=(await instance.ref('erp/contasPagar').get()).val();
    const found=entries(rawPayables).find(([path,row])=>path===id||String(row.id)===id);
    if(!found)fail(404,'PAYABLE_NOT_FOUND','Título não encontrado na nuvem.');
    const [path,original]=found;
    const currentCents=cents(Number(original.valor));
    const paidCount=Array.isArray(original.pagamentos)?original.pagamentos.length:0;
    if(original.status==='Pago'||(expected.valor!=null&&cents(Number(expected.valor))!==currentCents)||(expected.status!=null&&String(expected.status)!==String(original.status))||(expected.paymentsCount!=null&&Number(expected.paymentsCount)!==paidCount))
      fail(409,'PAYABLE_CHANGED','O título foi alterado por outra sessão. Atualize a página antes de pagar.');
    if(payCents+advanceCents>currentCents)fail(409,'OVERPAYMENT','O valor informado excede o saldo atual.');
    if(original.ticket){
      ticketLock=instance.ref('erpFinancePayableTicketLocks/'+key(original.ticket));
      const lock=await ticketLock.transaction(current=>current&&current.expiresAt>now()?undefined:{owner,expiresAt:now()+120000},undefined,false);
      if(!lock.committed)fail(409,'TICKET_IN_PROGRESS','Outra baixa deste ticket está em andamento.');
    }
    const supplier=advanceCents?key(original.fornCod||input.fornCod):'';
    if(advanceCents&&original.fornCod&&String(input.fornCod||original.fornCod)!==String(original.fornCod))
      fail(409,'SUPPLIER_MISMATCH','O fornecedor do adiantamento não corresponde ao título.');
    if(advanceCents){
      supplierLock=instance.ref('erpFinanceAdvanceLocks/'+supplier);
      const lock=await supplierLock.transaction(current=>current&&current.expiresAt>now()?undefined:{owner,expiresAt:now()+120000},undefined,false);
      if(!lock.committed)fail(409,'ADVANCE_IN_PROGRESS','Outro adiantamento está em alteração.');
    }
    const [bankSnap,advanceSnap,ticketSnap]=await Promise.all([
      payCents?instance.ref('erp/bancos').get():Promise.resolve(null),
      advanceCents?instance.ref('erp/adiantamentos/'+supplier).get():Promise.resolve(null),
      original.ticket?instance.ref('erp/tickets/'+key(original.ticket)).get():Promise.resolve(null)
    ]);
    // Guardar a integridade do histórico antes de adicionar outra baixa.
    // Um snapshot legado pode ter restaurado a conta como pendente depois de uma
    // confirmação real. Nesse caso os recibos não autorizam cobrar de novo.
    if(original.ticket&&String(id).startsWith('CPPO_')){
      const rawHistory=Array.isArray(original.pagamentos)?original.pagamentos:[];
      const ticketNominalCents=cents(Number(ticketSnap?.val?.()?.totalGeral??ticketSnap?.val?.()?.pedidoCompra?.totalPedido??0),true);
      const registeredCents=rawHistory.reduce((sum,row)=>sum+cents(Number(row?.valor||0),true)+cents(Number(row?.adt||0),true),0);
      const declaredCents=cents(Number(original.valorPago||0),true)+cents(Number(original.adtCompensado||0),true);
      if(ticketNominalCents>0&&(registeredCents>ticketNominalCents||declaredCents>ticketNominalCents||registeredCents+payCents+advanceCents>ticketNominalCents))
        fail(409,'PAYABLE_RECONCILIATION_REQUIRED','O histórico deste título ultrapassa o valor da compra. Nenhuma nova baixa foi registrada.');
      const priorBankMovements=rawHistory.filter(row=>Number(row?.valor||0)>0);
      const movementChecks=await Promise.all(priorBankMovements.map(async row=>{
        if(!row?.movBancoId)return false;
        const movement=(await instance.ref('erp/lancBanco/'+key(row.movBancoId)).get()).val();
        return !!movement&&String(movement.payableId||'')===id&&cents(Number(movement.valor||0),true)===cents(Number(row.valor),true);
      }));
      if(movementChecks.some(exists=>!exists))
        fail(409,'PAYABLE_RECONCILIATION_REQUIRED','Existem baixas sem lançamento bancário correspondente. Nenhum novo pagamento foi registrado.');
    }
    const bank=payCents?banks(bankSnap.val()).find(b=>b.cod===bankCode):null;
    if(payCents&&!bank)fail(422,'BANK_NOT_FOUND','Banco não encontrado. Atualize as opções.');
    const advanceList=advanceCents?(Array.isArray(advanceSnap.val())?advanceSnap.val():Object.values(advanceSnap.val()||{}).filter(Boolean)).map(x=>({...x})):null;
    if(advanceCents&&!Array.isArray(advanceList))fail(409,'ADVANCES_INVALID','Saldo de adiantamentos inconsistente.');
    const ticketRecord=ticketSnap?.val?.()||null;
    // Nunca baixar só a conta deixando a Compra de Sucata pendente.
    // Esse era um caminho possível quando a referência do ticket estava ausente.
    if(original.ticket&&!ticketRecord)fail(409,'PURCHASE_TICKET_MISSING','Compra vinculada não localizada. Nenhuma baixa foi registrada.');
    if(ticketRecord){
      const ticketBalance=cents(Number(ticketRecord.saldoPagar||0),true);
      if(ticketBalance<payCents+advanceCents)fail(409,'PURCHASE_BALANCE_CHANGED','O saldo da compra não corresponde ao pagamento. Nenhuma baixa foi registrada.');
      if(ticketBalance===0)fail(409,'PURCHASE_ALREADY_PAID','A compra já está quitada. Confira o Histórico antes de pagar.');
    }
    if(advanceCents&&ticketRecord?.fornecedorCod&&String(ticketRecord.fornecedorCod)!==supplier)
      fail(409,'SUPPLIER_MISMATCH','O ticket está associado a outro fornecedor.');
    if(advanceCents&&!original.fornCod&&!ticketRecord?.fornecedorCod){
      const rawSuppliers=(await instance.ref('erp/fornecedores').get()).val();
      const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');
      const name=normalize(original.cred||ticketRecord?.fornecedor||ticketRecord?.fornecedorNome);
      const matching=entries(rawSuppliers).filter(([,row])=>normalize(row.nome)===name);
      if(!name||matching.length!==1||String(matching[0][1].cod||'')!==supplier)
        fail(409,'SUPPLIER_NOT_VERIFIED','Não foi possível confirmar o fornecedor deste título legado. Verifique o cadastro.');
    }
    let advanceRemaining=advanceCents;
    if(advanceList){
      const ticketCode=String(original.ticket||'').trim();
      const eligible=advanceList.filter(a=>a.status==='Pendente'&&(!a.ticket||String(a.ticket).trim()===ticketCode));
      eligible.sort((a,b)=>Number(String(b.ticket||'').trim()===ticketCode)-Number(String(a.ticket||'').trim()===ticketCode));
      for(const advance of eligible){
        if(!advanceRemaining)break;
        const available=cents(Number(advance.valor));
        const used=Math.min(available,advanceRemaining);
        const initialCents=cents(Number(advance.valorOriginal??advance.valor));
        const alreadyApplied=cents(Number(advance.valorCompensado||0),true);
        advance.valorOriginal=money(initialCents);
        advance.valorCompensado=money(alreadyApplied+used);
        if(used===available){
          advance.status='Quitado';
          advance.ticket=advance.ticket||ticketCode;
          advance.obs=(advance.obs?advance.obs+' | ':'')+'Compensado em CP '+displayDate(date);
        }else{
          advance.valor=money(available-used);
          if(advance.ticket&&String(advance.ticket).trim()===ticketCode){
            advance.ticketOrigem=advance.ticket;
            advance.ticket='';
          }
          advanceList.push({cod:'ADT'+now().toString(36)+uuid().replaceAll('-','').slice(0,8),data:displayDate(date),valor:money(used),status:'Quitado',ticket:ticketCode,forma:advance.forma,bancoCod:advance.bancoCod||'',bancoNome:advance.bancoNome||'',empresa:advance.empresa||'',origem:'compensacao_cp',adiantamentoOrigem:advance.cod,obs:'Compensação parcial – CP '+displayDate(date)});
        }
        advanceRemaining-=used;
      }
      if(advanceRemaining)fail(409,'ADVANCE_BALANCE_CHANGED','Crédito disponível para este ticket é insuficiente. Atualize os dados.');
    }
    const amountTotal=payCents+advanceCents,rest=currentCents-amountTotal,full=rest===0;
    const updated={...original,pagamentos:[...(Array.isArray(original.pagamentos)?original.pagamentos:[]),{data:displayDate(date),valor:money(payCents),adt:money(advanceCents),banco:bank?.banco||'',obs:clean(input.obs,1000)}],status:full?'Pago':'Pendente',valor:full?money(currentCents):money(rest),valorPago:money(cents(Number(original.valorPago||0),true)+payCents),_upd:now()};
    if(advanceCents)updated.adtCompensado=money(cents(Number(original.adtCompensado||0),true)+advanceCents);
    if(full)updated.dataPgto=displayDate(date);
    if(bank){updated.bancoNome=bank.banco;updated.bancoCod=bank.cod;}
    const updates={['contasPagar/'+path]:updated};
    let movement=null;
    if(payCents){
      const movementId='LB-PG-'+now()+'-'+uuid().replaceAll('-','').slice(0,8);
      movement={id:movementId,bancoCod:bank.cod,data:displayDate(date),descricao:'Pagto: '+clean(original.desc||original.cred,240),tipo:'Saida',valor:money(payCents),payableId:id};
      updated.movBancoIdCP=movementId;
      updated.pagamentos[updated.pagamentos.length-1].movBancoId=movementId;
      updates['lancBanco/'+movementId]=movement;
    }
    if(advanceList)updates['adiantamentos/'+supplier]=advanceList;
    let ticket=null;
    if(ticketSnap?.exists?.()||ticketSnap?.val?.()){
      const originalTicket=ticketSnap.val();
      const currentTicket=Number(originalTicket.saldoPagar||0);
      const nextBalance=money(Math.max(0,cents(currentTicket,true)-amountTotal));
      ticket={...originalTicket,saldoPagar:nextBalance,status:nextBalance===0?'Pago':'Parcial'};
      updates['tickets/'+key(original.ticket)]=ticket;
    }
    const result={payable:updated,bankMovement:movement,advanceEntries:advanceList,fornCod:supplier,ticket,ticketKey:original.ticket||''};
    updates['financePayableOperations/'+opKey]={result,requestSignature:signature,createdAt:now(),actor:clean(identity.erpUser)};
    // Confirmar recibo, título, ticket, movimento e LIBERAÇÃO dos três locks
    // em uma única operação RTDB. Uma execução interrompida depois do commit
    // não pode deixar a próxima baixa bloqueada por até 120 segundos.
    const atomicUpdates=Object.fromEntries(Object.entries(updates).map(([path,value])=>['erp/'+path,value]));
    atomicUpdates['erpFinancePayableLocks/'+id]=null;
    if(ticketLock)atomicUpdates['erpFinancePayableTicketLocks/'+key(original.ticket)]=null;
    if(supplierLock)atomicUpdates['erpFinanceAdvanceLocks/'+supplier]=null;
    try{
      await instance.ref().update(atomicUpdates);
    }catch(error){
      // Se o servidor gravou e a resposta se perdeu, nunca reenviar a baixa.
      const stored=(await opRef.get().catch(()=>({val:()=>null}))).val();
      const recovered=resultIfCommitted(stored);
      if(recovered)return recovered;
      throw error;
    }
    return result;
  }finally{
    if(supplierLock){try{await supplierLock.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}}
    if(ticketLock){try{await ticketLock.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}}
    try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}
  }
}

// Consulta somente leitura para confirmar a baixa antes de qualquer nova tentativa.
// Não cria movimentos, não altera travas e não substitui a operação de pagamento.
export async function inspectPayablePayment(identity,input,{db,now=()=>Date.now()}={}){
  if(identity?.erpAccess!==true||identity.canPayables!==true)fail(403,'PAYABLES_REQUIRED','Sem acesso a Contas a Pagar.');
  const id=key(input?.payableId);
  const instance=await database(db);
  const payables=(await instance.ref('erp/contasPagar').get()).val();
  const found=entries(payables).find(([path,row])=>path===id||String(row.id)===id);
  if(!found) return {state:'not_found'};
  const [,payable]=found;
  const ticketId=String(payable.ticket||'').trim();
  const ticketIdKey=ticketId?key(ticketId):'';
  const ticket=ticketIdKey?(await instance.ref('erp/tickets/'+ticketIdKey).get()).val():null;
  let operation=null;
  if(input?.operationId){
    const operationId=key(input.operationId);
    if(!/^[a-f0-9-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Identificador de operação inválido.');
    const opKey=key(String(identity.uid||identity.erpUser||'user').replace(/[^a-zA-Z0-9_-]/g,'_'))+'_'+operationId;
    operation=(await instance.ref('erp/financePayableOperations/'+opKey).get()).val();
  }
  const lock=(await instance.ref('erpFinancePayableLocks/'+id).get()).val();
  const remains=Math.max(0,Math.ceil((Number(lock?.expiresAt||0)-now())/1000));
  const paid=String(payable.status||'')==='Pago';
  const ticketMarkedPaid=!!ticket&&['Pago','Quitado'].includes(String(ticket.status));
  const ticketZero=!!ticket&&Number(ticket.saldoPagar||0)<=0.005;
  // Detectar histórico com baixas repetidas ou lançamentos ausentes. Esta consulta
  // é apenas leitura e nunca altera o saldo ou remove pagamentos.
  const payments=Array.isArray(payable.pagamentos)?payable.pagamentos:[];
  const ticketNominal=Number(ticket?.totalGeral??ticket?.pedidoCompra?.totalPedido??0);
  const totalInHistory=payments.reduce((sum,row)=>sum+Number(row?.valor||0)+Number(row?.adt||0),0);
  const reported=Number(payable.valorPago||0)+Number(payable.adtCompensado||0);
  const historyErrors=[];
  if(ticketNominal>0&&(totalInHistory>ticketNominal+0.005||reported>ticketNominal+0.005))
    historyErrors.push('PAYMENTS_EXCEED_PURCHASE');
  const bankPayments=payments.filter(row=>Number(row?.valor||0)>0);
  const bankChecks=await Promise.all(bankPayments.map(async row=>{
    if(!row?.movBancoId)return false;
    const movement=(await instance.ref('erp/lancBanco/'+key(row.movBancoId)).get()).val();
    return !!movement&&String(movement.payableId||'')===id&&Math.abs(Number(movement.valor||0)-Number(row.valor||0))<0.005;
  }));
  if(bankChecks.some(check=>!check))historyErrors.push('BANK_MOVEMENT_MISSING');
  if(historyErrors.length)return {state:'needs_review',reasons:historyErrors,payable,ticket,ticketKey:ticketIdKey};
  // Não oferecer uma segunda baixa quando a conta e a compra divergem em qualquer direção.
  const mismatch=Boolean(ticketIdKey)&&(!ticket||ticketMarkedPaid!==ticketZero||paid!==ticketMarkedPaid);
  if(mismatch||(!paid&&operation?.result?.payable?.status==='Pago')){
    return {state:'needs_review',payable,ticket,ticketKey:ticketIdKey};
  }
  if(paid){return {state:'confirmed',payable,ticket,ticketKey:ticketIdKey,receiptFound:!!operation?.result};}
  if(remains>0)return {state:'processing',retryAfterSeconds:remains};
  return {state:'pending',payable,ticket,ticketKey:ticketIdKey};
}
