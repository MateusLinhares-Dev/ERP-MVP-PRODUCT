import {createHash,randomUUID} from 'node:crypto';

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
  const tx=await ref.transaction(cur=>cur&&cur.expiresAt>now()?undefined:{owner,expiresAt:now()+120000},undefined,false);
  if(!tx?.committed)reject(409,'EDIT_IN_PROGRESS','Outro lançamento financeiro está em andamento.');
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
function adjustReceipt(original,next,total){
  const source=clone(original.reciboFinanceiro||{});
  const advances=Array.isArray(source.adiantamentos)?source.adiantamentos:[];
  const cheques=Array.isArray(source.cheques)?source.cheques:[];
  if(cheques.some(row=>cash(Number(row.valorAplicado||0))>0))reject(409,'CHEQUE_RECONCILIATION_REQUIRED','Esta compra possui cheques aplicados. A alteração exige conciliação específica.');
  if(!advances.length)reject(409,'ADVANCE_RECEIPT_MISSING','Não foi encontrado o recibo do adiantamento.');
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
function adjustPayable(raw,ticketNo,oldBalance,nextBalance){
  const matches=rowEntries(raw).filter(([,row])=>String(row.ticket||'')===ticketNo&&row.status!=='Pago');
  if(matches.length!==1)reject(409,'PAYABLE_MISSING','A conta a pagar do pedido não foi encontrada ou está duplicada.');
  const [path,row]=matches[0];
  if(row.status!=='Pendente'||cash(Number(row.valor||0))!==oldBalance||Number(row.valorPago||0)>0||
    (Array.isArray(row.pagamentos)&&row.pagamentos.length>0))
    reject(409,'PAYABLE_CHANGED','Esta compra já tem baixa ou foi alterada em Contas a Pagar.');
  const updated={...row,valor:round(nextBalance),status:nextBalance===0?'Pago':'Pendente'};
  if(nextBalance===0)updated.dataPgto='';
  return {path,updated};
}
function adjustmentOfCredit(raw,before,after,ticketNo){
  if(raw==null)return null;
  const obj=typeof raw==='object'&&!Array.isArray(raw)?clone(raw):{valor:Number(raw)};
  if(obj.ticket&&String(obj.ticket)!==ticketNo)reject(409,'CREDIT_CHANGED','O crédito do fornecedor foi utilizado em outra compra.');
  if(Math.abs(cash(Number(obj.valor||0))-before)>1)reject(409,'CREDIT_CHANGED','O saldo credor já foi alterado.');
  return {...obj,valor:round(after),ticket:ticketNo};
}
export async function editPurchaseOrder(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  if(identity?.erpAccess!==true||identity?.canPurchasing!==true)reject(403,'PURCHASE_FORBIDDEN','Sem autorização para editar compras.');
  if(!input||typeof input!=='object'||Array.isArray(input))reject(400,'INVALID_INPUT','Solicitação inválida.');
  const ticketNo=key(input.ticketNo),opId=key(input.operationId);
  if(!/^[a-f0-9-]{36}$/i.test(opId))reject(422,'INVALID_OPERATION','Operação inválida.');
  const expected=input.expectedTicket;
  if(!expected||typeof expected!=='object'||Array.isArray(expected))reject(422,'EXPECTED_TICKET_REQUIRED','A versão original do pedido é obrigatória.');
  db=db||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey=key(String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_'))+'_'+opId;
  const opRef=db.ref('erp/purchaseEditOperations/'+opKey);
  const earlier=(await opRef.get()).val();
  if(earlier?.ticket){if(String(earlier.ticket.ticket)!==ticketNo)reject(409,'OPERATION_USED','Identificador de operação já utilizado.');return {...earlier,alreadyCommitted:true};}
  const first=(await db.ref('erp/tickets/'+ticketNo).get()).val();
  if(!first)reject(404,'TICKET_NOT_FOUND','Pedido não encontrado.');
  const code=key(first.fornecedorCod||first.fornCod);
  const owner=uuid(),locks=[];
  try{
    for(const lockKey of ['erpFinanceAdvanceLocks/'+code,'erpFinancePayableTicketLocks/'+ticketNo].sort()){
      const ref=db.ref(lockKey);
      await acquire(ref,owner,now);
      locks.push(ref);
    }
    const committed=(await opRef.get()).val();
    if(committed?.ticket){if(String(committed.ticket.ticket)!==ticketNo)reject(409,'OPERATION_USED','Identificador de operação já utilizado.');return {...committed,alreadyCommitted:true};}
    const paths=['erp/tickets/'+ticketNo,'erp/adiantamentos/'+code,'erp/saldos/'+code,'erp/saldoDevedor/'+code,'erp/contasPagar'];
    const snaps=await Promise.all(paths.map(path=>db.ref(path).get()));
    const previous=snaps[0].val();
    if(!previous||hash(previous)!==hash(expected))reject(409,'TICKET_CHANGED','O pedido mudou no Firebase. Reabra o histórico para editar os valores atuais.');
    const result=assemble(previous,input);
    const updates={['tickets/'+ticketNo]:result.ticket};
    const changed=result.difference!==0;
    const advancesUsed=Number(previous.adiantamento||0)>0;
    if(changed){
      const oldBalance=cash(Number(previous.saldoPagar||0));
      const payments=Object.values(snaps[4].val()||{}).filter(row=>row&&String(row.ticket||'')===ticketNo);
      if(payments.some(row=>Number(row.valorPago||0)>0||(row.pagamentos||[]).some(p=>Number(p.valor||0)>0)))
        reject(409,'PAYMENT_ALREADY_RECORDED','Há pagamentos bancários já registrados nesta compra.');
      if(oldBalance<0&&result.balance<=0&&advancesUsed){
        const changes=adjustReceipt(previous,result.ticket,result.total);
        updates['adiantamentos/'+code]=adjustLedger(snaps[1].val(),changes,ticketNo);
        const oldCredit=-oldBalance,newCredit=Math.max(0,-result.balance);
        const saldo=adjustmentOfCredit(snaps[2].val(),oldCredit,newCredit,ticketNo);
        const legacy=adjustmentOfCredit(snaps[3].val(),oldCredit,newCredit,ticketNo);
        if(saldo!==null)updates['saldos/'+code]=saldo;
        if(legacy!==null)updates['saldoDevedor/'+code]=legacy;
      }else if(oldBalance>=0&&result.balance>=0){
        const payable=adjustPayable(snaps[4].val()||[],ticketNo,oldBalance,result.balance);
        updates['contasPagar/'+payable.path]=payable.updated;
      }else reject(409,'FINANCE_RECONCILIATION_REQUIRED','O valor altera a natureza do saldo do pedido. Essa mudança exige conciliação específica.');
    }
    updates._ts=now();
    const record={ticket:result.ticket,advances:updates['adiantamentos/'+code]||null,
      saldo:updates['saldos/'+code]||null,creditLegacy:updates['saldoDevedor/'+code]||null,
      payable:Object.entries(updates).find(([path])=>path.startsWith('contasPagar/'))?.[1]||null,
      updatedAt:now(),actor:String(identity.erpUser||identity.uid||'')};
    updates['purchaseEditOperations/'+opKey]=record;
    await db.ref('erp').update(updates);
    return {...record,alreadyCommitted:false};
  }finally{
    for(const ref of locks.reverse())try{await ref.transaction(cur=>cur?.owner===owner?null:undefined,undefined,false);}catch{}
  }
}
