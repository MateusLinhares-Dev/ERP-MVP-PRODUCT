import {randomUUID,createHash} from 'node:crypto';
import {acquireLease,releaseLease} from '../../../shared/firebase/rtdb-transaction.js';

const fail=(status,code,message)=>{const error=new Error(message);error.status=status;error.code=code;throw error;};
const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const key=value=>{const s=clean(value,100);if(!s||/[.#$\[\]/\u0000-\u001f\u007f]/.test(s))fail(422,'INVALID_KEY','Identificador inválido.');return s;};
const currency=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100000000||Math.abs(Math.round(value*100)-value*100)>0.00001)fail(422,'INVALID_AMOUNT','Valor inválido.');
  return Math.round(value*100);
};
const dateISO=value=>{
  const s=clean(value,10),date=new Date(s+'T12:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==s)fail(422,'INVALID_DATE','Data inválida.');
  return s;
};
const money=cents=>Number((cents/100).toFixed(2));
const canFinance=identity=>identity?.erpAccess===true&&(identity.canPayables===true||identity.canFinance===true);
function authorize(identity){if(!canFinance(identity))fail(403,'REPASS_PERMISSION_REQUIRED','É necessário acesso a Contas a Pagar para registrar repasses.');}
async function database(db){return db||(await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;}
function supplierExists(raw,code){return Object.values(raw||{}).some(s=>s&&typeof s==='object'&&String(s.cod||'')===code&&s.ativo!==false&&s.excluido!==true);}
function bankOptions(raw){return Object.values(raw||{}).filter(b=>b&&typeof b==='object'&&!Array.isArray(b)).map(b=>({cod:clean(b.cod),banco:clean(b.banco||b.nome)})).filter(b=>b.cod&&b.banco);}
function visibleReceipt(record){
  return {id:record.id,operationId:record.operationId,fornCod:record.fornCod,data:record.data,valor:record.valor,valorPago:record.valorPago||0,saldo:record.saldo,
    status:record.status,versao:record.versao,obs:record.obs||'',pagamentos:record.pagamentos||[],criadoEm:record.criadoEm};
}
async function supplierLock(db,code,owner,now){
  const ref=db.ref('erpSupplierRepasseLocks/'+code);
  const acquired=await acquireLease(ref,owner,{now,ttlMs:90000,meta:{kind:'supplier-repasse'}});
  if(!acquired)fail(409,'SUPPLIER_REPASSE_BUSY','Outro lançamento deste fornecedor está sendo processado. Aguarde alguns segundos e tente novamente.');
  return ref;
}
export async function listSupplierCashRepasses(identity,fornCod,{db}={}){
  authorize(identity);db=await database(db);const code=key(fornCod);
  const [listSnap,banksSnap]=await Promise.all([db.ref('erp/fornecedorRepasses/'+code).get(),db.ref('erp/bancos').get()]);
  const records=Object.values(listSnap.val()||{}).filter(x=>x&&typeof x==='object').map(visibleReceipt).sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  return {records,banks:bankOptions(banksSnap.val()).sort((a,b)=>a.banco.localeCompare(b.banco,'pt-BR')),
    totalEmAberto:money(records.reduce((sum,r)=>sum+Math.round(r.saldo*100),0))};
}
export async function summarizeSupplierCashRepasses(identity,{db}={}){
  authorize(identity);db=await database(db);
  const [recordsSnap,suppliersSnap]=await Promise.all([
    db.ref('erp/fornecedorRepasses').get(),db.ref('erp/fornecedores').get()
  ]);
  const suppliers=new Map(Object.values(suppliersSnap.val()||{}).filter(s=>s&&typeof s==='object').map(s=>[String(s.cod||''),clean(s.nome,180)]));
  const months={};const rows=[];
  const add=(date,kind,value)=>{
    const month=String(date||'').slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(month))return;
    const entry=months[month]??={entradas:0,saidas:0};
    entry[kind]=money(Math.round(entry[kind]*100)+Math.round(Number(value||0)*100));
  };
  for(const [fornCod,group] of Object.entries(recordsSnap.val()||{})){
    if(!group||typeof group!=='object')continue;
    for(const r of Object.values(group)){
      if(!r||typeof r!=='object')continue;
      add(r.data,'entradas',r.valor);
      for(const p of r.pagamentos||[])add(p.data,'saidas',p.valor);
      if(r.saldo>0)rows.push({fornCod,id:r.id,nome:suppliers.get(fornCod)||fornCod,
        data:r.data,valor:r.valor,saldo:r.saldo,status:r.status});
    }
  }
  rows.sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  return {rows,months,totalEmAberto:money(rows.reduce((sum,r)=>sum+Math.round(r.saldo*100),0))};
}

export async function changeSupplierCashRepasse(identity,input,{db,uuid=randomUUID,now=()=>Date.now()}={}){
  authorize(identity);
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Dados inválidos.');
  const action=clean(input.action,12),fornCod=key(input.fornCod),operationId=key(input.operationId);
  if(!/^[a-f\d-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Identificador da operação inválido.');
  if(!['receive','pay'].includes(action))fail(422,'INVALID_ACTION','Operação inválida.');
  const date=dateISO(input.data);
  const amount=currency(input.valor);
  const note=clean(input.obs,500);
  const comprovante=clean(input.comprovante,180);
  const actor=clean(identity.uid||identity.erpUser||'user',100);
  const tokenId=createHash('sha256').update(actor+'|'+fornCod+'|'+operationId).digest('hex').slice(0,40);
  const receiptId=action==='pay'?key(input.receiptId):'RCS-'+tokenId;
  const bankCode=action==='pay'?key(input.bancoCod):'';
  const dbi=await database(db);
  const opKey=key(String(identity.uid||identity.erpUser||'user').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const intent=createHash('sha256').update(JSON.stringify([action,fornCod,receiptId,date,amount,bankCode,note,comprovante])).digest('hex');
  const opRef=dbi.ref('erp/fornecedorRepasseOperations/'+opKey);
  const previous=(await opRef.get()).val();
  if(previous?.result){
    if(previous.intent!==intent)fail(409,'OPERATION_ID_REUSED','Identificador já usado em outro lançamento. Atualize a tela.');
    return {...previous.result,alreadyCommitted:true};
  }
  const owner=uuid();const lock=await supplierLock(dbi,fornCod,owner,now);
  let committed=false;
  try{
    const again=(await opRef.get()).val();
    if(again?.result){
      if(again.intent!==intent)fail(409,'OPERATION_ID_REUSED','Identificador já usado em outro lançamento. Atualize a tela.');
      return {...again.result,alreadyCommitted:true};
    }
    const rowRef=dbi.ref('erp/fornecedorRepasses/'+fornCod+'/'+receiptId);
    const [recordSnap,supplierSnap,bankSnap]=await Promise.all([
      rowRef.get(),action==='receive'?dbi.ref('erp/fornecedores').get():Promise.resolve(null),
      action==='pay'?dbi.ref('erp/bancos').get():Promise.resolve(null)
    ]);
    const stored=recordSnap.val();
    const updates={};let record,movement=null;
    if(action==='receive'){
      if(stored)fail(409,'RECEIPT_ALREADY_EXISTS','Este recebimento já existe. Atualize a ficha financeira.');
      if(!supplierExists(supplierSnap.val(),fornCod))fail(422,'SUPPLIER_NOT_FOUND','Fornecedor não encontrado ou inativo.');
      record={id:receiptId,operationId,fornCod,data:date,valor:money(amount),valorPago:0,saldo:money(amount),
        status:'Pendente',versao:1,obs:note,origem:'Recebimento em espécie para repasse via PIX',pagamentos:[],
        criadoEm:new Date(now()).toISOString(),criadoPor:clean(identity.erpUser||identity.uid)};
      updates['fornecedorRepassesCaixa/'+receiptId]={id:receiptId,fornCod,data:date,tipo:'Entrada',valor:money(amount),
        origem:'Recebimento para repasse',obs:note};
    } else {
      if(!stored||stored.fornCod!==fornCod)fail(404,'RECEIPT_NOT_FOUND','Recebimento não encontrado.');
      if(Number(input.expectedVersion)!==Number(stored.versao))fail(409,'RECEIPT_CHANGED','O saldo foi alterado por outra sessão. Atualize os dados.');
      const balanceCents=Math.round(Number(stored.saldo)*100);
      if(amount>balanceCents)fail(409,'OVERPAYMENT','Valor do repasse ultrapassa o saldo disponível.');
      const bank=bankOptions(bankSnap.val()).find(b=>b.cod===bankCode);
      if(!bank)fail(422,'BANK_NOT_FOUND','Conta bancária não encontrada.');
      const movementId='LB-REP-'+tokenId;
      movement={id:movementId,bancoCod:bankCode,data:date.split('-').reverse().join('/'),tipo:'Saida',
        valor:money(amount),descricao:'Repasse via PIX ao fornecedor '+fornCod+' (recebimento '+receiptId+')'};
      updates['lancBanco/'+movementId]=movement;
      const payment={id:operationId,data:date,valor:money(amount),bancoCod:bankCode,bancoNome:bank.banco,
        forma:'PIX',movBancoId:movementId,comprovante,obs:note,criadoEm:new Date(now()).toISOString()};
      const remaining=balanceCents-amount;
      record={...stored,valorPago:money(Math.round(Number(stored.valorPago||0)*100)+amount),saldo:money(remaining),
        status:remaining?'Parcial':'Quitado',versao:Number(stored.versao)+1,
        pagamentos:[...(Array.isArray(stored.pagamentos)?stored.pagamentos:[]),payment]};
    }
    updates['fornecedorRepasses/'+fornCod+'/'+receiptId]=record;
    const result={record:visibleReceipt(record),movement};
    updates['fornecedorRepasseOperations/'+opKey]={result,intent,action,receiptId,criadoEm:new Date(now()).toISOString()};
    updates._ts=now();
    const atomic=Object.fromEntries(Object.entries(updates).map(([path,value])=>['erp/'+path,value]));
    const live=(await lock.get()).val();
    if(live?.owner!==owner)fail(409,'SUPPLIER_REPASSE_BUSY','A reserva deste fornecedor expirou durante o lançamento. Atualize os dados e tente novamente.');
    atomic['erpSupplierRepasseLocks/'+fornCod]=null;
    try{await dbi.ref().update(atomic);committed=true;}
    catch(error){
      const stored=(await opRef.get().catch(()=>({val:()=>null}))).val();
      if(stored?.result&&stored.intent===intent){committed=true;return {...stored.result,alreadyCommitted:true};}
      throw error;
    }
    return {...result,alreadyCommitted:false};
  }finally{
    if(!committed)await releaseLease(lock,owner,{label:'supplier.repasse.lock.release'});
  }
}
