import {createHash,randomUUID} from 'node:crypto';
import {acquireLease,releaseLeases} from '../../../shared/firebase/rtdb-transaction.js';
import {businessTodayISO,isoToBrazilianDate} from '../../../shared/domain/business-date.js';
import {MAX_INSTALLMENTS,installmentPayableIds,installmentPayables,installmentSignature,normalizeInstallments} from '../domain/installments.js';

function reject(status,code,message){
  const error=new Error(message);
  error.status=status;
  error.code=code;
  throw error;
}
function key(value){
  const text=String(value??'').trim();
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(text))reject(422,'INVALID_KEY','Código inválido.');
  return text;
}
function cash(value){
  const amount=Number(value);
  if(!Number.isFinite(amount)||Math.abs(Math.round(amount*100)-amount*100)>0.00001||Math.abs(amount)>1000000000)reject(422,'INVALID_AMOUNT','Valor financeiro inválido.');
  return Math.round(amount*100);
}
function clone(value){return JSON.parse(JSON.stringify(value));}
function signature(value){
  if(Array.isArray(value))return '['+value.map(signature).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+signature(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const hash=value=>createHash('sha256').update(signature(value)).digest('hex');
const round=value=>Math.round(value)/100;
function readRows(raw){
  if(Array.isArray(raw))return raw.map(row=>row&&typeof row==='object'?clone(row):row);
  if(raw&&typeof raw==='object')return clone(raw);
  return [];
}
function rowEntries(rows){return Object.entries(rows).filter(([,row])=>row&&typeof row==='object'&&!Array.isArray(row));}
function readAmount(raw){return raw&&typeof raw==='object'?Number(raw.valor):Number(raw);}
async function acquire(ref,owner,now){
  const acquired=await acquireLease(ref,owner,{now,ttlMs:120000,meta:{kind:'purchase-edit'}});
  if(!acquired)reject(409,'EDIT_IN_PROGRESS','Outro lançamento financeiro está em andamento. Aguarde alguns segundos e tente novamente.');
}
function normalizeItems(raw,original){
  if(!Array.isArray(raw)||raw.length===0||raw.length>200)reject(422,'INVALID_ITEMS','Informe de 1 a 200 materiais.');
  const originalItems=Array.isArray(original.itens)?original.itens:[];
  return raw.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))reject(422,'INVALID_ITEMS','Material inválido.');
    const mat=String(row.mat||'').trim().slice(0,180);
    if(!mat)reject(422,'INVALID_ITEMS','Informe o material.');
    const quantity=Number(row.pesoLiq??row.quantidade),price=Number(row.preco);
    if(!Number.isFinite(quantity)||quantity<=0||quantity>10000000||!Number.isFinite(price)||price<0||price>1000000)reject(422,'INVALID_ITEMS','Quantidade ou preço inválido.');
    const description=String(row.descricaoDetalhada||row.obs||'').trim().slice(0,400);
    return {...(originalItems[index]||{}),mat,matBase:mat,ident:String(row.ident||originalItems[index]?.ident||''),
      descricaoDetalhada:description,obs:description,unidade:'kg',quantidade:quantity,pesoBruto:Number(row.pesoBruto||quantity),
      pesoLiq:quantity,preco:price,subtotal:round(Math.round(quantity*price*100)),total:round(Math.round(quantity*price*100))};
  });
}
function assemble(original,input){
  const incoming=input.ticket;
  if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))reject(422,'INVALID_TICKET','Pedido inválido.');
  const items=normalizeItems(incoming.itens,original);
  const totalProducts=items.reduce((sum,row)=>sum+cash(row.total),0);
  const discount=cash(Number(incoming.descontoCompra||0)),freight=cash(Number(incoming.freteCompra||0));
  if(discount<0||freight<0)reject(422,'INVALID_AMOUNT','Desconto ou frete inválido.');
  const previousProducts=(original.itens||[]).reduce((sum,row)=>sum+cash(Number(row.total??Number(row.pesoLiq||row.quantidade||0)*Number(row.preco||0))),0);
  const oldDiscount=cash(Number(original.descontoCompra??original.pedidoCompra?.desconto??0));
  const oldFreight=cash(Number(original.freteCompra??original.pedidoCompra?.frete??0));
  const legacyExtra=cash(Number(original.totalGeral||0))-previousProducts+oldDiscount-oldFreight;
  const total=totalProducts-discount+freight+legacyExtra;
  if(total<0||total>1e11||Math.abs(total-cash(Number(incoming.totalGeral)))>1)reject(422,'TOTAL_MISMATCH','Total da compra divergente dos itens.');
  const order=String(incoming.ordemCompra||'').trim().slice(0,120);
  const date=String(incoming.dataCompra||'').trim();
  const due=String(incoming.vencimentoSaldo||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(due))reject(422,'INVALID_DATE','Data inválida.');
  const notes=String(incoming.observacoesPedido||'').trim().slice(0,5000);
  const oldTotal=cash(Number(original.totalGeral||0));
  const oldBalance=cash(Number(original.saldoPagar||0));
  const balance=oldBalance+total-oldTotal;
  const next={...clone(original),itens:items,totalProdutos:round(totalProducts),totalGeral:round(total),
    totalKg:items.reduce((sum,row)=>sum+Number(row.pesoLiq||0),0),descontoCompra:round(discount),freteCompra:round(freight),
    ordemCompra:order,dataCompra:date,vencimentoSaldo:due,observacoesPedido:notes,saldoPagar:round(balance),
    status:balance>0?'Pendente':'Pago'};
  next.pedidoCompra={...(original.pedidoCompra||{}),numero:original.ticket||'',ordemCompra:order,
    dataCompra:date,vencimentoSaldo:due,observacoes:notes,desconto:round(discount),frete:round(freight),
    totalProdutos:round(totalProducts),totalPedido:round(total)};
  return {ticket:next,oldTotal,total,balance,difference:total-oldTotal};
}
function trustedLegacyReceipt(original,raw,ticketNo){
  const oldTotal=cash(Number(original.totalGeral||0));
  const originalAdvance=cash(Number(original.adiantamento||0));
  const originalCredit=-cash(Number(original.saldoPagar||0));
  if(oldTotal<=0||originalCredit<=0||originalAdvance!==oldTotal+originalCredit)return null;
  const candidates=rowEntries(readRows(raw)).filter(([,row])=>{
    if(!row.cod||row.status!=='Pendente'||String(row.forma||'').toLowerCase().includes('cheque'))return false;
    if(row.ticket&&String(row.ticket)!==ticketNo)return false;
    const remaining=cash(Number(row.valor||0));
    const already=cash(Number(row.valorCompensado||0));
    const originalValue=cash(Number(row.valorOriginal??(remaining+already)/100));
    return remaining===originalCredit&&already===oldTotal&&originalValue===originalAdvance;
  });
  if(candidates.length!==1)return null;
  const source=candidates[0][1];
  return {versao:1,total:round(originalAdvance),adiantamentos:[{
    cod:String(source.cod),data:String(source.data||''),forma:String(source.forma||''),bancoNome:String(source.bancoNome||''),
    valorOriginal:round(originalAdvance),valorAplicado:round(oldTotal),valorPendente:round(originalCredit)
  }],cheques:[]};
}
function adjustReceipt(original,next,total,ledger,ticketNo){
  const existing=clone(original.reciboFinanceiro||{});
  if((existing.cheques||[]).some(row=>cash(Number(row.valorAplicado||0))>0))reject(409,'CHEQUE_RECONCILIATION_REQUIRED','Esta compra possui cheques aplicados. A alteração exige conciliação específica.');
  const source=Array.isArray(existing.adiantamentos)&&existing.adiantamentos.length
    ?existing:trustedLegacyReceipt(original,ledger,ticketNo);
  if(!source)reject(409,'ADVANCE_RECONCILIATION_REQUIRED','O adiantamento deste pedido antigo não possui vínculo financeiro único. Não foi alterado.');
  const advances=source.adiantamentos;
  const oldApplied=advances.reduce((sum,row)=>sum+cash(Number(row.valorAplicado||0)),0);
  if(Math.abs(oldApplied-cash(Number(original.totalGeral||0)))>1)reject(409,'ADVANCE_RECEIPT_MISMATCH','O recibo possui abatimentos diferentes do total original. Confira as baixas antes de editar.');
  let remaining=total;
  const changes=[];
  for(const row of advances){
    const originalCash=cash(Number(row.valorOriginal||0));
    const appliedBefore=cash(Number(row.valorAplicado||0));
    if(!row.cod||originalCash<appliedBefore)reject(409,'ADVANCE_RECEIPT_INVALID','O recibo de adiantamento está incompleto.');
    const applied=Math.min(originalCash,remaining);
    remaining-=applied;
    row.valorAplicado=round(applied);
    row.valorPendente=round(originalCash-applied);
    changes.push({code:String(row.cod),original:originalCash,before:appliedBefore,after:applied});
  }
  if(remaining>0)reject(409,'ADVANCE_INSUFFICIENT','O novo total excede o adiantamento disponível. A conciliação exige uma conta a pagar.');
  source.adiantamentos=advances;
  next.reciboFinanceiro=source;
  return changes;
}
function adjustLedger(raw,changes,ticketNo){
  const records=readRows(raw);
  const entries=rowEntries(records);
  for(const change of changes){
    if(change.before===change.after)continue;
    const match=entries.find(([,record])=>String(record.cod||'')===change.code&&record.status==='Pendente');
    if(!match)reject(409,'ADVANCE_NOT_PENDING','O adiantamento original não está disponível para conciliar a edição.');
    const record=match[1],original=cash(Number(record.valorOriginal??record.valor));
    const consumed=cash(Number(record.valorCompensado||0));
    const remaining=cash(Number(record.valor||0));
    if(original!==change.original||consumed!==change.before||original-consumed!==remaining)
      reject(409,'ADVANCE_CHANGED','O adiantamento mudou desde a compra. Atualize e concilie antes de editar.');
    record.valorCompensado=round(change.after);
    record.valor=round(original-change.after);
    const partials=entries.filter(([,candidate])=>candidate.status==='Quitado'&&String(candidate.ticket||'')===ticketNo&&(
      String(candidate.adiantamentoOrigem||'')===change.code||String(candidate.obs||'').includes('Quitação parcial de '+change.code)
    ));
    if(partials.length>1)reject(409,'ADVANCE_DUPLICATE_PARTIAL','Existe mais de uma compensação parcial vinculada.');
    if(partials.length===1)partials[0][1].valor=round(change.after);
  }
  return records;
}
function adjustPayable(raw,ticketNo,oldBalance,nextBalance,operationId,supplierCode,original){
  const entriesAll=rowEntries(raw);
  const active=entriesAll.filter(([,row])=>String(row.ticket||'')===ticketNo&&row.status!=='Pago');
  if(active.length>1)reject(409,'PAYABLE_DUPLICATE','Há mais de uma conta em aberto para este pedido.');
  if(active.length===1){
    const [path,row]=active[0];
    if(row.status!=='Pendente'||cash(Number(row.valor||0))!==oldBalance)
      reject(409,'PAYABLE_CHANGED','O saldo da conta foi alterado. Atualize o pedido antes de editar.');
    if(nextBalance<0)reject(409,'PAYABLE_RECONCILIATION_REQUIRED','A alteração geraria crédito a restituir.');
    const updated={...row,valor:round(nextBalance),status:nextBalance===0?'Pago':'Pendente'};
    if(nextBalance===0){
      const historical=cash(Number(row.valorPago||0))+cash(Number(row.adtCompensado||0));
      updated.valor=round(historical>0?historical:0);
      updated.dataPgto=String(row.dataPgto||businessTodayISO());
    }
    return {path,updated};
  }
  if(oldBalance!==0||nextBalance<=0)reject(409,'PAYABLE_CHANGED','O saldo do pedido não corresponde às contas financeiras disponíveis.');
  const id='CP-AJUSTE-'+ticketNo+'-'+operationId.slice(0,8);
  if(entriesAll.some(([,row])=>String(row.id||'')===id))reject(409,'PAYABLE_CHANGED','Ajuste já registrado. Atualize o histórico.');
  const taken=new Set(entriesAll.map(([path])=>path));
  const path=Array.isArray(raw)?String(raw.length):id;
  if(taken.has(path))reject(409,'PAYABLE_CHANGED','Não foi possível reservar um registro financeiro único.');
  const date=String(original.dataCompra||original.data||'').replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$2-$1');
  const due=String(original.vencimentoSaldo||date);
  const updated={id,ticket:ticketNo,fornCod:supplierCode,cred:String(original.fornecedor||''),cat:'Compra de Sucata',tipoForn:'compra',
    desc:'Diferença após correção do pedido '+ticketNo,lancto:date,venc:due,valor:round(nextBalance),
    status:'Pendente',dataPgto:'',bancoCod:'',bancoNome:'',pagamentos:[],obs:'Ajuste confirmado após pagamento anterior'};
  return {path,updated};
}
function adjustmentOfCredit(raw,before,after,ticketNo){
  if(raw==null)return null;
  const obj=typeof raw==='object'&&!Array.isArray(raw)?clone(raw):{valor:Number(raw)};
  if(obj.ticket&&String(obj.ticket)!==ticketNo)reject(409,'CREDIT_CHANGED','O crédito do fornecedor foi utilizado em outra compra.');
  if(Math.abs(cash(Number(obj.valor||0))-before)>1)reject(409,'CREDIT_CHANGED','O saldo credor já foi alterado.');
  return {...obj,valor:round(after),ticket:ticketNo};
}
function untouchedPayable(row){
  if(String(row.status||'')!=='Pendente')return false;
  if(cash(Number(row.valorPago||0))>0||cash(Number(row.adtCompensado||0))>0)return false;
  if(Array.isArray(row.pagamentos)&&row.pagamentos.length>0)return false;
  return !row.dataPgto&&!row.movBancoIdCP&&!row.bancoCod;
}
function currentPlan(ticket){
  if(Array.isArray(ticket.parcelas)&&ticket.parcelas.length)return ticket.parcelas;
  const balance=cash(Number(ticket.saldoPagar||0));
  return balance>0?[{vencimento:String(ticket.vencimentoSaldo||''),valor:round(balance),forma:'',obs:''}]:[];
}
function purchasePayables(raw,ticketNo,previous){
  const count=Array.isArray(previous.parcelas)&&previous.parcelas.length>1?previous.parcelas.length:1;
  const expected=new Set(installmentPayableIds(ticketNo,count));
  const rows=rowEntries(raw&&typeof raw==='object'?raw:{}).filter(([path,row])=>
    String(row.ticket||'')===ticketNo||expected.has(path)||expected.has(String(row.id||'')));
  return {expected,rows};
}
function replanPayables({raw,ticketNo,previous,next,installments,supplierCode,oldBalance,at}){
  const {expected,rows}=purchasePayables(raw,ticketNo,previous);
  if(rows.some(([path,row])=>!expected.has(path)||String(row.id||'')!==path))
    reject(409,'LEGACY_PAYABLE_REVIEW','As contas a pagar deste pedido precisam de revisão no financeiro antes de mudar as parcelas.');
  if(rows.some(([,row])=>!untouchedPayable(row)))
    reject(409,'INSTALLMENTS_HAVE_PAYMENTS','Já existe parcela paga desta compra. Para mudar valores ou parcelas, estorne o pagamento em Contas a Pagar.');
  if(rows.length!==expected.size||rows.reduce((sum,[,row])=>sum+cash(Number(row.valor||0)),0)!==oldBalance)
    reject(409,'PAYABLE_CHANGED','As parcelas em Contas a Pagar não conferem com o saldo do pedido. Atualize a tela.');
  const payables=installments.length?installmentPayables({ticketNo,supplierCode,
    supplierName:String(next.fornecedor||next.fornecedorNome||''),descriptionName:String(next.fornecedor||''),
    purchaseDate:String(next.dataCompra||''),installments}):[];
  const kept=new Set(payables.map(row=>row.id));
  const removed=rows.map(([path])=>path).filter(path=>!kept.has(path));
  const updates={};
  for(const path of removed)updates['contasPagar/'+path]=null;
  for(const row of payables)updates['contasPagar/'+row.id]={...row,_upd:at};
  return {updates,payables:payables.map(row=>updates['contasPagar/'+row.id]),removed};
}
function applyPlan(ticket,installments){
  if(installments.length){
    ticket.parcelas=installments;
    ticket.vencimentoSaldo=installments[0].vencimento;
    if(ticket.pedidoCompra)ticket.pedidoCompra.vencimentoSaldo=installments[0].vencimento;
  }else delete ticket.parcelas;
}
export function refundAdvanceReceipt(previous,ledgerRaw,excess,ticketNo,at){
  const receipt=clone(previous.reciboFinanceiro||{});
  if((receipt.cheques||[]).some(row=>cash(Number(row.valorAplicado||0))>0))
    reject(409,'CHEQUE_RECONCILIATION_REQUIRED','Esta compra foi paga com cheque. Para reduzir o valor ou excluir, devolva o cheque pelo financeiro.');
  if((Array.isArray(receipt.creditos)&&receipt.creditos.length)||cash(Number(previous.creditoFornecedorAplicado||0))>0)
    reject(409,'CREDIT_RECONCILIATION_REQUIRED','Esta compra usou crédito residual do fornecedor. Reduzir ou excluir precisa de conciliação no financeiro.');
  const rows=Array.isArray(receipt.adiantamentos)?receipt.adiantamentos:[];
  if(Number(receipt.versao)!==2||!rows.length)
    reject(409,'ADVANCE_RECONCILIATION_REQUIRED','O adiantamento deste pedido antigo não possui vínculo financeiro único. Não foi alterado.');
  const appliedTotal=rows.reduce((sum,row)=>sum+cash(Number(row.valorAplicado||0)),0);
  if(Math.abs(appliedTotal-cash(Number(previous.adiantamento||0)))>1)
    reject(409,'ADVANCE_RECEIPT_MISMATCH','O recibo possui abatimentos diferentes do total original. Confira as baixas antes de editar.');
  if(excess>appliedTotal)
    reject(409,'PAID_REFUND_REQUIRED','A redução passa do valor pago com adiantamento (R$ '+round(appliedTotal).toFixed(2).replace('.',',')+'). A diferença foi paga pelo banco: faça o estorno no financeiro.');
  const records=readRows(ledgerRaw);
  const entries=rowEntries(records);
  const refunds=[];
  let remaining=excess;
  for(let index=rows.length-1;index>=0&&remaining>0;index--){
    const row=rows[index];
    const applied=cash(Number(row.valorAplicado||0));
    const take=Math.min(applied,remaining);
    if(!take)continue;
    const matches=entries.filter(([,record])=>String(record.cod||'')===String(row.cod||'')&&record.origem!=='compensacao_cp');
    if(matches.length!==1)reject(409,'ADVANCE_CHANGED','O adiantamento '+String(row.cod||'')+' não foi encontrado de forma única. Solicite conferência.');
    const record=matches[0][1];
    const original=cash(Number(record.valorOriginal??record.valor));
    const consumed=cash(Number(record.valorCompensado||0));
    const consistent=record.status==='Quitado'
      ?consumed===original
      :record.status==='Pendente'&&cash(Number(record.valorDisponivel??record.valor??0))===original-consumed;
    if(consumed<take||original<consumed||!consistent)
      reject(409,'ADVANCE_CHANGED','O saldo do adiantamento '+String(row.cod||'')+' mudou desde a compra. Atualize a tela antes de editar.');
    const usedAfter=consumed-take,available=original-usedAfter;
    record.valorOriginal=round(original);
    record.valorCompensado=round(usedAfter);
    record.valorDisponivel=round(available);
    record.valor=round(available);
    record.status='Pendente';
    if(record.ticket){if(!record.ticketOrigem)record.ticketOrigem=String(record.ticket);record.ticket='';}
    if(usedAfter===0&&String(record.ticketOrigem||'')===ticketNo)delete record.ticketOrigem;
    record.devolucoesCompra=[...(Array.isArray(record.devolucoesCompra)?record.devolucoesCompra:[]),{ticket:ticketNo,valor:round(take),em:at}];
    row.valorAplicado=round(applied-take);
    row.valorPendente=round(cash(Number(row.valorPendente||0))+take);
    refunds.push({cod:String(row.cod),valor:round(take)});
    remaining-=take;
  }
  if(remaining>0)reject(409,'ADVANCE_RECEIPT_MISMATCH','Não foi possível devolver todo o valor aos adiantamentos. Nada foi alterado.');
  receipt.total=round(appliedTotal-excess);
  receipt.devolucoes=[...(Array.isArray(receipt.devolucoes)?receipt.devolucoes:[]),{em:at,valor:round(excess),adiantamentos:refunds}];
  return {receipt,records,applied:appliedTotal-excess,refunds};
}
export async function editPurchaseOrder(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  if(identity?.erpAccess!==true||identity?.canPurchasing!==true)reject(403,'PURCHASE_FORBIDDEN','Sem autorização para editar compras.');
  if(!input||typeof input!=='object'||Array.isArray(input))reject(400,'INVALID_INPUT','Solicitação inválida.');
  const ticketNo=key(input.ticketNo),opId=key(input.operationId);
  if(!/^[a-f0-9-]{36}$/i.test(opId))reject(422,'INVALID_OPERATION','Operação inválida.');
  const expected=input.expectedTicket;
  if(!expected||typeof expected!=='object'||Array.isArray(expected))reject(422,'EXPECTED_TICKET_REQUIRED','A versão original do pedido é obrigatória.');
  db=db||(await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey=key(String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_'))+'_'+opId;
  const opRef=db.ref('erp/purchaseEditOperations/'+opKey);
  const earlier=(await opRef.get()).val();
  if(earlier?.ticket){if(String(earlier.ticket.ticket)!==ticketNo)reject(409,'OPERATION_USED','Identificador de operação já utilizado.');return {...earlier,alreadyCommitted:true};}
  const requestedCount=Array.isArray(input.ticket?.parcelas)?input.ticket.parcelas.length:0;
  if(requestedCount>MAX_INSTALLMENTS)reject(422,'TOO_MANY_INSTALLMENTS','Máximo de '+MAX_INSTALLMENTS+' parcelas.');
  const first=(await db.ref('erp/tickets/'+ticketNo).get()).val();
  if(!first)reject(404,'TICKET_NOT_FOUND','Pedido não encontrado.');
  const firstCount=Array.isArray(first.parcelas)?first.parcelas.length:0;
  const payableLockIds=[...new Set([...installmentPayableIds(ticketNo,firstCount),...installmentPayableIds(ticketNo,requestedCount)])].sort();
  const code=key(first.fornecedorCod||first.fornCod);
  const owner=uuid(),locks=[];
  let committed=false;
  try{
    const ticketLock=db.ref('erpFinancePayableTicketLocks/'+ticketNo);
    await acquire(ticketLock,owner,now);
    locks.push({ref:ticketLock,path:'erpFinancePayableTicketLocks/'+ticketNo});
    for(const id of payableLockIds){
      const payableLock=db.ref('erpFinancePayableLocks/'+id);
      await acquire(payableLock,owner,now);
      locks.push({ref:payableLock,path:'erpFinancePayableLocks/'+id});
    }
    const priorReceipt=(await opRef.get()).val();
    if(priorReceipt?.ticket){if(String(priorReceipt.ticket.ticket)!==ticketNo)reject(409,'OPERATION_USED','Identificador de operação já utilizado.');return {...priorReceipt,alreadyCommitted:true};}
    const paths=['erp/tickets/'+ticketNo,'erp/adiantamentos/'+code,'erp/saldos/'+code,'erp/saldoDevedor/'+code,'erp/contasPagar'];
    const snaps=await Promise.all(paths.map(path=>db.ref(path).get()));
    const previous=snaps[0].val();
    if(!previous||hash(previous)!==hash(expected))reject(409,'TICKET_CHANGED','O pedido mudou no Firebase. Reabra o histórico para editar os valores atuais.');
    const result=assemble(previous,input);
    const updates={['tickets/'+ticketNo]:result.ticket};
    const changed=result.difference!==0;
    const advancesUsed=Number(previous.adiantamento||0)>0;
    if(changed&&advancesUsed){
      const creditLock=db.ref('erpFinanceAdvanceLocks/'+code);
      await acquire(creditLock,owner,now);
      locks.push({ref:creditLock,path:'erpFinanceAdvanceLocks/'+code});
      snaps[1]=await db.ref('erp/adiantamentos/'+code).get();
      snaps[2]=await db.ref('erp/saldos/'+code).get();
      snaps[3]=await db.ref('erp/saldoDevedor/'+code).get();
      const live=(await db.ref('erp/tickets/'+ticketNo).get()).val();
      if(!live||hash(live)!==hash(previous))reject(409,'TICKET_CHANGED','O pedido mudou durante a edição. Reabra o Histórico.');
    }
    let advanceRefund=null,replanned=null;
    const oldBalance=cash(Number(previous.saldoPagar||0));
    const previousPlan=Array.isArray(previous.parcelas)?previous.parcelas:[];
    if(oldBalance>0&&previousPlan.length>1&&changed&&purchasePayables(snaps[4].val(),ticketNo,previous).rows.some(([,row])=>!untouchedPayable(row)))
      reject(409,'INSTALLMENTS_HAVE_PAYMENTS','Já existe parcela paga desta compra. Para mudar valores ou parcelas, estorne o pagamento em Contas a Pagar.');
    const rawRequested=Array.isArray(input.ticket.parcelas)?input.ticket.parcelas:(previousPlan.length>1?previousPlan:null);
    const requested=rawRequested&&result.balance>0?normalizeInstallments(rawRequested,{balanceCents:result.balance,
      purchaseDate:result.ticket.dataCompra,defaultDueDate:result.ticket.vencimentoSaldo}):null;
    if(oldBalance<=0&&(requested?.length??0)>1)
      reject(409,'INSTALLMENTS_AFTER_PAYMENT','Esta compra já estava quitada: a diferença vira uma conta única em Contas a Pagar. Deixe uma parcela só.');
    const multi=oldBalance>0&&(previousPlan.length>1||(requested?.length??0)>1);
    const planChanged=installmentSignature(currentPlan(previous))!==installmentSignature(requested??[]);
    if(multi&&(changed||planChanged)){
      if(result.balance<0&&!advancesUsed)
        reject(409,'FINANCE_RECONCILIATION_REQUIRED','O valor altera a natureza do saldo do pedido. Essa mudança exige conciliação específica.');
      if(result.balance<0){
        const refund=refundAdvanceReceipt(previous,snaps[1].val(),-result.balance,ticketNo,now());
        updates['adiantamentos/'+code]=refund.records;
        result.ticket.reciboFinanceiro=refund.receipt;
        result.ticket.adiantamento=round(refund.applied);
        result.ticket.saldoPagar=0;
        result.ticket.status='Pago';
        advanceRefund={valor:round(-result.balance),adiantamentos:refund.refunds};
      }
      replanned=replanPayables({raw:snaps[4].val(),ticketNo,previous,next:result.ticket,installments:requested??[],supplierCode:code,oldBalance,at:now()});
      Object.assign(updates,replanned.updates);
      applyPlan(result.ticket,requested??[]);
    }else if(changed){
      const payments=Object.values(snaps[4].val()||{}).filter(row=>row&&String(row.ticket||'')===ticketNo);
      if(oldBalance<0&&result.balance<=0&&advancesUsed){
        if(payments.some(row=>Number(row.valorPago||0)>0||(row.pagamentos||[]).some(p=>Number(p.valor||0)>0)))
          reject(409,'PAID_AND_ADVANCE_RECONCILIATION_REQUIRED','Existem pagamentos e adiantamentos vinculados ao mesmo pedido. É necessária conciliação específica.');
        const changes=adjustReceipt(previous,result.ticket,result.total,snaps[1].val(),ticketNo);
        updates['adiantamentos/'+code]=adjustLedger(snaps[1].val(),changes,ticketNo);
        const oldCredit=-oldBalance,newCredit=Math.max(0,-result.balance);
        const saldo=adjustmentOfCredit(snaps[2].val(),oldCredit,newCredit,ticketNo);
        const legacy=adjustmentOfCredit(snaps[3].val(),oldCredit,newCredit,ticketNo);
        if(saldo!==null)updates['saldos/'+code]=saldo;
        if(legacy!==null)updates['saldoDevedor/'+code]=legacy;
      }else if(oldBalance>=0&&result.balance>=0){
        const payable=adjustPayable(snaps[4].val()||[],ticketNo,oldBalance,result.balance,opId,code,previous);
        updates['contasPagar/'+payable.path]=payable.updated;
      }else if(oldBalance>=0&&result.balance<0&&advancesUsed){
        const refund=refundAdvanceReceipt(previous,snaps[1].val(),-result.balance,ticketNo,now());
        updates['adiantamentos/'+code]=refund.records;
        result.ticket.reciboFinanceiro=refund.receipt;
        result.ticket.adiantamento=round(refund.applied);
        result.ticket.saldoPagar=0;
        result.ticket.status='Pago';
        if(oldBalance>0){
          const payable=adjustPayable(snaps[4].val()||[],ticketNo,oldBalance,0,opId,code,previous);
          updates['contasPagar/'+payable.path]=payable.updated;
        }
        advanceRefund={valor:round(-result.balance),adiantamentos:refund.refunds};
      }else reject(409,'FINANCE_RECONCILIATION_REQUIRED','O valor altera a natureza do saldo do pedido. Essa mudança exige conciliação específica.');
    }
    if(!replanned&&requested?.length===1&&result.ticket.saldoPagar>0){
      const single=requested[0];
      applyPlan(result.ticket,requested);
      const payableId='CPPO_'+ticketNo;
      const path=Object.keys(updates).find(entry=>entry==='contasPagar/'+payableId)
        ?payableId
        :(planChanged?rowEntries(snaps[4].val()||{}).find(([entry,row])=>entry===payableId&&String(row.id||'')===payableId&&row.status==='Pendente')?.[0]:null);
      if(path){
        const base=updates['contasPagar/'+path]||rowEntries(snaps[4].val()||{}).find(([entry])=>entry===path)[1];
        if(base.status==='Pendente'){
          const patched={...base,venc:isoToBrazilianDate(single.vencimento),_upd:now()};
          if(single.forma)patched.formaPrevista=single.forma;else delete patched.formaPrevista;
          if(single.obs)patched.obs=single.obs;
          updates['contasPagar/'+path]=patched;
        }
      }
    }else if(!replanned&&result.ticket.saldoPagar<=0&&!multi)delete result.ticket.parcelas;
    updates._ts=now();
    const record={ticket:result.ticket,advances:updates['adiantamentos/'+code]||null,
      saldo:updates['saldos/'+code]||null,creditLegacy:updates['saldoDevedor/'+code]||null,
      payable:replanned?replanned.payables[0]||null:Object.entries(updates).find(([path,value])=>path.startsWith('contasPagar/')&&value)?.[1]||null,
      ...(replanned?{payables:replanned.payables,removedPayableIds:replanned.removed}:{}),
      ...(advanceRefund?{advanceRefund}:{}),
      updatedAt:now(),actor:String(identity.erpUser||identity.uid||'')};
    updates['purchaseEditOperations/'+opKey]=record;
    const atomic=Object.fromEntries(Object.entries(updates).map(([path,value])=>['erp/'+path,value]));
    for(const lock of locks){
      const live=(await lock.ref.get()).val();
      if(live?.owner!==owner)reject(409,'PURCHASE_EDIT_BUSY','A edição foi alterada por outra sessão.');
      atomic[lock.path]=null;
    }
    try{await db.ref().update(atomic);committed=true;}
    catch(error){
      const confirmed=(await opRef.get().catch(()=>({val:()=>null}))).val();
      if(confirmed?.ticket&&String(confirmed.ticket.ticket)===ticketNo){committed=true;return {...confirmed,alreadyCommitted:true};}
      throw error;
    }
    return {...record,alreadyCommitted:false};
  }finally{
    if(!committed)await releaseLeases(locks,owner,{label:'purchase.edit.lock.release'});
  }
}
