import {randomUUID} from 'node:crypto';

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

export async function listPaymentBanks(identity,{db}={}){
  if(!canList(identity))fail(403,'PAYMENT_BANKS_FORBIDDEN','Seu perfil não pode consultar as opções de pagamento.');
  const instance=await database(db);
  const items=banks((await instance.ref('erp/bancos').get()).val());
  items.sort((a,b)=>a.banco.localeCompare(b.banco,'pt-BR')||a.cod.localeCompare(b.cod,'pt-BR'));
  return {banks:items};
}

export async function payPayable(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
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
  const previous=(await opRef.get()).val();
  if(previous?.result)return {...previous.result,alreadyCommitted:true};
  const expected=input.expected||{};
  if(typeof expected!=='object'||Array.isArray(expected))fail(422,'INVALID_EXPECTED','Versão esperada inválida.');
  const lockRef=instance.ref('erpFinancePayableLocks/'+id),owner=uuid();
  const claimed=await lockRef.transaction(current=>current&&current.expiresAt>now()?undefined:{owner,expiresAt:now()+120000},undefined,false);
  if(!claimed.committed)fail(409,'PAYMENT_IN_PROGRESS','Outra baixa deste título está em andamento.');
  let supplierLock=null,ticketLock=null;
  try{
    const committed=(await opRef.get()).val();
    if(committed?.result)return {...committed.result,alreadyCommitted:true};
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
    const supplier=advanceCents?key(input.fornCod||original.fornCod):'';
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
    const bank=payCents?banks(bankSnap.val()).find(b=>b.cod===bankCode):null;
    if(payCents&&!bank)fail(422,'BANK_NOT_FOUND','Banco não encontrado. Atualize as opções.');
    const advanceList=advanceCents?(Array.isArray(advanceSnap.val())?advanceSnap.val():Object.values(advanceSnap.val()||{}).filter(Boolean)).map(x=>({...x})):null;
    if(advanceCents&&!Array.isArray(advanceList))fail(409,'ADVANCES_INVALID','Saldo de adiantamentos inconsistente.');
    let advanceRemaining=advanceCents;
    if(advanceList){
      for(const advance of [...advanceList]){
        if(!advanceRemaining)break;
        if(advance.status!=='Pendente')continue;
        const available=cents(Number(advance.valor));
        const used=Math.min(available,advanceRemaining);
        if(used===available){advance.status='Quitado';advance.ticket=advance.ticket||original.ticket||'';advance.obs=(advance.obs?advance.obs+' | ':'')+'Compensado em CP '+displayDate(date);}
        else{
          advance.valor=money(available-used);
          advanceList.push({cod:'ADT'+now().toString(36)+uuid().replaceAll('-','').slice(0,8),data:displayDate(date),valor:money(used),status:'Quitado',ticket:original.ticket||'',forma:advance.forma,bancoCod:advance.bancoCod||'',bancoNome:advance.bancoNome||'',obs:'Compensação parcial – CP '+displayDate(date)});
        }
        advanceRemaining-=used;
      }
      if(advanceRemaining)fail(409,'ADVANCE_BALANCE_CHANGED','Saldo de adiantamentos insuficiente. Atualize a página.');
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
    updates['financePayableOperations/'+opKey]={result,createdAt:now(),actor:clean(identity.erpUser)};
    await instance.ref('erp').update(updates);
    return result;
  }finally{
    if(supplierLock){try{await supplierLock.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}}
    if(ticketLock){try{await ticketLock.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}}
    try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch{}
  }
}
