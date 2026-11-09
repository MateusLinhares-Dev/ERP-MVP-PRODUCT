import {randomUUID,createHash} from 'node:crypto';
import {runTransaction,releaseLease} from '../../../shared/firebase/rtdb-transaction.js';

function failure(status,code,message){
  const error=new Error(message);
  error.status=status;
  error.code=code;
  throw error;
}

function requireFinance(identity){
  if(!identity||identity.erpAccess!==true||identity.canAdvances!==true)failure(403,'ADVANCES_REQUIRED','Sem permissão para Adiantamentos.');
}

function clean(value,max=120){
  return String(value??'').trim().slice(0,max);
}

function pathKey(value){
  const key=clean(value,120);
  if(!key||/[.#$\[\]/\u0000-\u001f\u007f]/.test(key))failure(422,'INVALID_KEY','Identificador inválido.');
  return key;
}

function amount(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000000000||Math.round(value*100)/100!==value)failure(422,'INVALID_AMOUNT','Informe um valor válido em centavos.');
  return value;
}

function isoDate(value){
  const date=clean(value,10);
  const parsed=new Date(date+'T12:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)failure(422,'INVALID_DATE','Data inválida.');
  return date;
}

function chequeFingerprint(c){
  return createHash('sha256').update(JSON.stringify([
    c.id,c.b,c.n,c.c,c.emitente,c.dest,c.v,c.d,c.venc,c.cd,c.s,c.dc,c.origem||'',c.advanceCode,c.fornCod
  ])).digest('hex');
}

function bankEntries(raw){
  return Object.entries(raw&&typeof raw==='object'?raw:{}).filter(([,b])=>b&&typeof b==='object'&&!Array.isArray(b)).map(([key,b])=>({
    cod:clean(b.cod||b.codigo||b.id||key),
    banco:clean(b.banco||b.nomeBanco||b.nome||''),
    empresa:clean(b.empresa||''),
    tipo:clean(b.tipo||''),
    titular:clean(b.titular||'')
  })).filter(b=>b.cod&&b.banco);
}

async function resolveDatabase(db){
  if(db)return db;
  const {getFirebaseAdmin}=await import('../../../shared/firebase/firebase-admin.js');
  return getFirebaseAdmin().db;
}

export function supplierTombstones(raw){
  if(Array.isArray(raw))return new Set(raw.filter(value=>value!=null).map(value=>String(value)));
  if(!raw||typeof raw!=='object')return new Set();
  return new Set(Object.entries(raw).filter(([,value])=>value===true||value===1||value==='true').map(([key])=>String(key)));
}

export function supplierOptions(raw,deletedCodes,deletedIds){
  const byCode=new Map();
  for(const [key,supplier] of Object.entries(raw&&typeof raw==='object'?raw:{})){
    if(!supplier||typeof supplier!=='object'||Array.isArray(supplier))continue;
    const cod=clean(supplier.cod),nome=clean(supplier.nome,240),id=clean(supplier.id||key);
    if(!cod||!nome||supplier.ativo===false||supplier.excluido===true||
      ['inativo','desativado','excluido','excluído'].includes(String(supplier.status||'').trim().toLocaleLowerCase('pt-BR'))||
      deletedCodes.has(cod)||deletedCodes.has(id)||deletedIds.has(id)||deletedIds.has(cod)||deletedIds.has(key))continue;
    const candidate={cod,nome};
    if(!byCode.has(cod))byCode.set(cod,candidate);
  }
  return Array.from(byCode.values()).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR',{sensitivity:'base'})||a.cod.localeCompare(b.cod,'pt-BR'));
}

export async function listAdvanceBankOptions(identity,{db}={}){
  requireFinance(identity);
  db=await resolveDatabase(db);
  const paths=['erp/bancos','erp/fornecedores','erp/fornDeleted','erp/fornDeletedV2','erp/fornecedoresDeleted','erp/fornecedoresDeletedV2'];
  const snapshots=await Promise.all(paths.map(path=>db.ref(path).get()));
  const banks=bankEntries(snapshots[0].val()).map(({cod,banco})=>({cod,banco}));
  banks.sort((a,b)=>a.banco.localeCompare(b.banco,'pt-BR')||a.cod.localeCompare(b.cod,'pt-BR'));
  const deletedCodes=new Set([...supplierTombstones(snapshots[2].val()),...supplierTombstones(snapshots[3].val())]);
  const deletedIds=new Set([...supplierTombstones(snapshots[4].val()),...supplierTombstones(snapshots[5].val())]);
  const suppliers=supplierOptions(snapshots[1].val(),deletedCodes,deletedIds);
  return {banks,suppliers};
}

export async function listAdvanceCheques(identity,{db}={}){
  requireFinance(identity);
  db=await resolveDatabase(db);
  const [snapshot,deletedSnapshot]=await Promise.all([
    db.ref('erp/chequesControle').get(),
    db.ref('erp/chequesControle_del').get()
  ]);
  const deleted=deletedSnapshot.val()||{};
  const entries=snapshot.val()||{};
  const rows=Object.entries(entries).filter(([id,c])=>c&&typeof c==='object'&&!Array.isArray(c)&&c.advanceCode&&c.fornCod&&deleted[id]!==true).map(([id,c])=>({
    origem:'Adiantamento a fornecedor',
    id:clean(c.id||id,100),
    adiantamento:clean(c.advanceCode,100),
    empresa:clean(c.emitente||c.origem||'',180),
    cliente:clean(c.dest||'',240),
    numero:clean(c.n,40),
    data:clean(c.d,10),
    vencimento:clean(c.venc,10),
    valor:Number(c.v),
    situacao:c.s==='C'?'Compensado':c.s==='X'?'Cancelado':'A compensar'
  })).filter(c=>c.numero&&c.cliente&&Number.isFinite(c.valor)&&c.valor>0);
  if(identity.canFinance===true){
    const customerSnap=await db.ref('erp/chequesCli').get();
    for(const [customer,raw] of Object.entries(customerSnap.val()||{})){
      if(!raw||typeof raw!=='object')continue;
      for(const c of Object.values(raw)){
        if(!c||typeof c!=='object'||clean(c.tipo,40).toLowerCase()!=='adiantamento')continue;
        const item={
          origem:'Cheque de cliente',
          id:'',adiantamento:'',
          empresa:clean(c.emitente||'',180),
          cliente:clean(customer,240),
          numero:clean(c.num,40),
          data:clean(c.data||c.bomPara,10),
          vencimento:clean(c.bomPara,10),
          valor:Number(c.valor),
          situacao:c.status==='Compensado'?'Compensado':c.status==='Devolvido'?'Devolvido':'A compensar'
        };
        if(item.numero&&item.cliente&&Number.isFinite(item.valor)&&item.valor>0)rows.push(item);
      }
    }
  }
  return {cheques:rows};
}

function supplierExists(raw,code){
  return Object.values(raw&&typeof raw==='object'?raw:{}).some(s=>s&&typeof s==='object'&&String(s.cod||'')===code);
}

function advanceRecords(value){
  if(!value)return [];
  if(Array.isArray(value))return value.filter(x=>x&&typeof x==='object');
  if(typeof value==='object')return Object.values(value).filter(x=>x&&typeof x==='object');
  failure(409,'INVALID_SUPPLIER_ADVANCES','Cadastro de adiantamentos do fornecedor está inconsistente.');
}

export async function getAdvanceOperationStatus(identity,input,{db,now=()=>Date.now()}={}){
  requireFinance(identity);
  if(!input||typeof input!=='object'||Array.isArray(input))failure(400,'INVALID_INPUT','Dados inválidos.');
  const operationId=pathKey(input.operationId);
  if(!/^[a-f\d-]{36}$/i.test(operationId))failure(422,'INVALID_OPERATION','Identificador da operação inválido.');
  const fornCod=pathKey(input.fornCod);
  db=await resolveDatabase(db);
  const operationKey=pathKey(String(identity.uid||identity.erpUser||'user').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const record=(await db.ref('erp/financeAdvanceOperations/'+operationKey).get()).val();
  if(record?.advance){
    if(record.fornCod&&record.fornCod!==fornCod)failure(409,'ADVANCE_SUPPLIER_MISMATCH','Operação não corresponde ao fornecedor selecionado.');
    const entries=advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val());
    if(!entries.some(entry=>entry.cod===record.advance.cod))
      failure(409,'ADVANCE_SUPPLIER_MISMATCH','Operação não corresponde ao fornecedor selecionado.');
    return {state:'confirmed',advance:record.advance,bankMovement:record.bankMovement||null,
      cheques:record.cheques||[],entries,alreadyCommitted:true};
  }
  const lock=(await db.ref('erpFinanceAdvanceLocks/'+fornCod).get()).val();
  const remaining=Number(lock?.expiresAt)-now();
  if(Number.isFinite(remaining)&&remaining>0)return {state:'processing',retryAfterSeconds:Math.max(1,Math.ceil(remaining/1000))};
  return {state:'not_found'};
}

async function acquireAdvanceLock(ref,owner,now,{db,operationKey='',fornCod='',kind='',requestFingerprint='',sleep}={}){
  const delays=[0,160,280,420,640,900,1200,1600];
  const pause=sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const nextLock=()=>({owner,operationKey,fornCod,kind,requestFingerprint,startedAt:now(),expiresAt:now()+120000});
  for(const delay of delays){
    if(delay)await pause(delay);
    const acquired=await runTransaction(ref,current=>{
      if(current&&current.owner!==owner&&Number(current.expiresAt)>now())return;
      return nextLock();
    });
    if(acquired.committed)return true;

    if(!db)continue;
    const lock=(await ref.get()).val();
    if(!lock?.owner||!lock.operationKey||!lock.kind||!lock.fornCod)continue;
    if(!/^[\w-]{1,120}$/.test(String(lock.operationKey)))continue;
    const receipt=(await db.ref('erp/financeAdvanceOperations/'+lock.operationKey).get()).val();
    const confirmed=lock.kind==='create'
      ?Boolean(receipt?.advance&&receipt.fornCod===lock.fornCod&&
        receipt.requestFingerprint&&receipt.requestFingerprint===lock.requestFingerprint)
      :lock.kind==='change'&&Boolean(receipt?.result&&['edit','delete'].includes(receipt.action)&&
        (lock.fornCod==='__global_cheques__'||receipt.result.fornCod===lock.fornCod||receipt.result.newFornCod===lock.fornCod));
    if(!confirmed)continue;
    const recovered=await runTransaction(ref,current=>{
      if(current?.owner!==lock.owner||current?.operationKey!==lock.operationKey||
        current?.kind!==lock.kind||current?.fornCod!==lock.fornCod)return;
      return nextLock();
    });
    if(recovered.committed)return true;
  }
  return false;
}

async function commitAdvanceAndRelease(db,updates,keys,owner,now){
  for(const key of keys){
    const current=(await db.ref('erpFinanceAdvanceLocks/'+key).get()).val();
    if(current?.owner!==owner||Number(current.expiresAt)<=now())
      failure(409,'ADVANCE_LOCK_LOST','A confirmação financeira perdeu a reserva. Confira o resultado antes de tentar novamente.');
  }
  const batch=Object.fromEntries(Object.entries(updates).map(([path,value])=>['erp/'+path,value]));
  for(const key of keys)batch['erpFinanceAdvanceLocks/'+key]=null;
  await db.ref('/').update(batch);
}

async function releaseAdvanceLocks(locks,owner){
  for(const ref of [...locks].reverse()){
    for(let attempt=0;attempt<3;attempt++){
      if(await releaseLease(ref,owner,{label:'finance.advance.lock.release'}))break;
      if(attempt===2)console.error('finance.advance.lock.release',new Error('Trava própria permaneceu ativa após três tentativas de liberação.'));
      else await new Promise(resolve=>setTimeout(resolve,120*(attempt+1)));
    }
  }
}

export async function createAdvance(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  requireFinance(identity);
  db=await resolveDatabase(db);
  if(!input||typeof input!=='object'||Array.isArray(input))failure(400,'INVALID_INPUT','Dados de adiantamento inválidos.');
  const operationId=pathKey(input.operationId);
  if(!/^[a-f\d-]{36}$/i.test(operationId))failure(422,'INVALID_OPERATION','Identificador da operação inválido.');
  const fornCod=pathKey(input.fornCod);
  const date=isoDate(input.data);
  const value=amount(input.valor);
  const forma=clean(input.forma,30);
  const isCheque=forma==='Cheque'||forma==='Cheque de Terceiro';
  if(!['PIX','TED','Dinheiro','Cheque','Cheque de Terceiro'].includes(forma))failure(422,'INVALID_PAYMENT_METHOD','Forma de pagamento inválida.');
  const bankCode=isCheque?'':pathKey(input.bancoCod);
  const ticket=clean(input.ticket,100);
  const empresa=clean(input.empresa,120);
  const obs=clean(input.obs,1000);
  const chequeSituation=clean(input.chequeSituation||'A',1);
  if(isCheque&&!['A','C'].includes(chequeSituation))failure(422,'INVALID_CHEQUE_STATUS','Situação do cheque inválida.');
  const chequeItems=isCheque?input.cheques:[];
  const confirmDuplicates=input.confirmDuplicates===true;
  if(isCheque&&(!Array.isArray(chequeItems)||chequeItems.length===0||chequeItems.length>200))
    failure(422,'INVALID_CHEQUES','Informe de 1 a 200 cheques.');
  const cheques=isCheque?chequeItems.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))failure(422,'INVALID_CHEQUE','Cheque inválido.');
    const b=clean(raw.b,120),n=clean(raw.n,40);
    if(!b||!/^[a-zA-Z0-9_-]{1,40}$/.test(n))failure(422,'INVALID_CHEQUE','Informe banco e número do cheque válidos.');
    return {b,n,v:amount(raw.v),d:raw.d?isoDate(raw.d):date,venc:raw.venc?isoDate(raw.venc):'',cli:clean(raw.cli,180)};
  }):[];
  if(isCheque){
    const totalCents=cheques.reduce((sum,c)=>sum+Math.round(c.v*100),0);
    if(totalCents!==Math.round(value*100))failure(422,'CHEQUE_TOTAL_MISMATCH','A soma dos cheques deve ser igual ao valor do adiantamento.');
    const ids=new Set();
    const duplicateRows=[];
    for(const c of cheques){
      if(forma==='Cheque de Terceiro'&&!c.cli)
        failure(422,'CHEQUE_DRAWER_REQUIRED','Informe o dono/emitente de cada cheque de terceiro.');
      const key=(c.b+'|'+c.n).toLocaleLowerCase('pt-BR');
      if(ids.has(key)){
        if(forma==='Cheque')failure(409,'DUPLICATE_CHEQUE','Cheque próprio repetido na lista: '+c.b+' nº '+c.n+'.');
        duplicateRows.push(c);
      }
      ids.add(key);
    }
    if(duplicateRows.length&&!confirmDuplicates)
      failure(409,'CHEQUE_DUPLICATE_CONFIRMATION_REQUIRED',
        'Há '+duplicateRows.length+' cheque(s) de terceiro com banco e número repetidos nesta lista (ex.: '+duplicateRows[0].b+' nº '+duplicateRows[0].n+'). Confirme conscientemente para continuar.');
  }
  const requestFingerprint=createHash('sha256').update(JSON.stringify({
    fornCod,date,value,forma,bankCode,ticket,empresa,obs,chequeSituation:isCheque?chequeSituation:'',
    cheques:isCheque?cheques:[]
  })).digest('hex');
  const operationKey=pathKey(String(identity.uid||identity.erpUser||'user').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const opRef=db.ref('erp/financeAdvanceOperations/'+operationKey);
  const existing=(await opRef.get()).val();
  if(existing?.advance){
    if(existing.requestFingerprint&&existing.requestFingerprint!==requestFingerprint)failure(409,'OPERATION_REUSED','A identificação já foi usada por outro adiantamento.');
    return {advance:existing.advance,bankMovement:existing.bankMovement||null,cheques:existing.cheques||[],entries:advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val()),alreadyCommitted:true};
  }
  const owner=uuid(),locks=[];
  const keys=(isCheque?[fornCod,'__global_cheques__']:[fornCod]).sort();
  let committedAndUnlocked=false;
  try{
    for(const key of keys){
      const lockRef=db.ref('erpFinanceAdvanceLocks/'+key);
      const acquired=await acquireAdvanceLock(lockRef,owner,now,{db,operationKey,fornCod,kind:'create',requestFingerprint});
      if(!acquired){
        const active=(await lockRef.get()).val();
        const wait=Math.max(1,Math.ceil((Number(active?.expiresAt)-now())/1000));
        const error=new Error('Outra operação financeira está em andamento. Aguarde a confirmação antes de tentar novamente.');
        error.status=409;error.code='ADVANCE_IN_PROGRESS';
        if(Number.isFinite(wait))error.retryAfterSeconds=Math.min(wait,120);
        throw error;
      }
      locks.push(lockRef);
    }
    const committed=(await opRef.get()).val();
    if(committed?.advance){
      if(committed.requestFingerprint&&committed.requestFingerprint!==requestFingerprint)failure(409,'OPERATION_REUSED','A identificação já foi usada por outro adiantamento.');
      return {advance:committed.advance,bankMovement:committed.bankMovement||null,cheques:committed.cheques||[],entries:advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val()),alreadyCommitted:true};
    }
    const [banksSnap,suppliersSnap,advancesSnap,chequesSnap]=await Promise.all([
      isCheque?Promise.resolve(null):db.ref('erp/bancos').get(),
      db.ref('erp/fornecedores').get(),db.ref('erp/adiantamentos/'+fornCod).get(),
      isCheque?db.ref('erp/chequesControle').get():Promise.resolve(null)
    ]);
    if(!supplierExists(suppliersSnap.val(),fornCod))failure(422,'SUPPLIER_NOT_FOUND','Fornecedor não encontrado no Firebase.');
    const bank=isCheque?null:bankEntries(banksSnap.val()).find(b=>b.cod===bankCode);
    if(!isCheque&&!bank)failure(422,'BANK_NOT_FOUND','Conta bancária não encontrada ou removida. Atualize a lista.');
    const records=advanceRecords(advancesSnap.val());
    const id='ADT'+now().toString(36).toUpperCase()+uuid().replace(/-/g,'').slice(0,8).toUpperCase();
    const dataFmt=date.split('-').reverse().join('/');
    const supplier=Object.values(suppliersSnap.val()).find(s=>s&&String(s.cod||'')===fornCod);
    const advance={cod:id,data:dataFmt,valor:value,status:'Pendente',ticket,forma,
      bancoCod:bank?.cod||'',bancoNome:bank?.banco||'Não informado',empresa,obs};
    const updates={};
    let movement=null;
    const createdCheques=[];
    if(isCheque){
      const previousCheques=Object.values(chequesSnap.val()||{}).filter(c=>c&&typeof c==='object');
      for(const [chequeIndex,c] of cheques.entries()){
        const duplicatedInBatch=cheques.slice(0,chequeIndex).some(old=>
          old.b.toLocaleLowerCase('pt-BR')===c.b.toLocaleLowerCase('pt-BR')&&
          old.n.toLocaleLowerCase('pt-BR')===c.n.toLocaleLowerCase('pt-BR'));
        const duplicated=previousCheques.some(old=>
          String(old.b||'').trim().toLocaleLowerCase('pt-BR')===c.b.toLocaleLowerCase('pt-BR')&&
          String(old.n||'').trim().toLocaleLowerCase('pt-BR')===c.n.toLocaleLowerCase('pt-BR'));
        if(duplicated&&forma==='Cheque')
          failure(409,'CHEQUE_ALREADY_EXISTS','Cheque próprio '+c.n+' de '+c.b+' já cadastrado.');
        if(duplicated&&!confirmDuplicates)
          failure(409,'CHEQUE_DUPLICATE_CONFIRMATION_REQUIRED',
            'Cheque de terceiro nº '+c.n+' do banco '+c.b+' já existe. Confira o emitente ('+c.cli+'), valor e documento e confirme para manter ambos.');
        const slug=c.b.replace(/[^a-zA-Z0-9]/g,'').slice(0,8).toUpperCase()||'XX';
        const chequeId='CC'+slug+c.n+'-'+uuid().replace(/-/g,'').slice(0,12)+'-'+chequeIndex.toString(36);
        if(chequeId.length>100||createdCheques.some(item=>item.id===chequeId)||(chequesSnap.val()||{})[chequeId])
          failure(409,'CHEQUE_ID_CONFLICT','Identificador de cheque já utilizado.');
        const d=c.d.split('-').reverse().join('/');
        const venc=c.venc?c.venc.split('-').reverse().join('/'):'';
        const supplierName=clean(supplier?.nome,240)||fornCod;
        const cheque={id:chequeId,b:c.b,n:c.n,c:c.cli?c.cli+' → '+supplierName:supplierName,
          emitente:c.cli,dest:supplierName,v:c.v,d,venc,cd:chequeSituation==='C'?d:'',s:chequeSituation,dc:true,
          advanceCode:id,fornCod,tipoCheque:forma,duplicidadeConfirmada:Boolean(duplicated||duplicatedInBatch)};
        if(empresa)cheque.origem=empresa;
        createdCheques.push(cheque);
        updates['chequesControle/'+chequeId]=cheque;
      }
      advance.chequeIds=createdCheques.map(c=>c.id);
      advance.chequeFingerprints=Object.fromEntries(createdCheques.map(c=>[c.id,chequeFingerprint(c)]));
    }else{
      const movementId='LB-'+now()+'-'+uuid().replace(/-/g,'').slice(0,8);
      advance.movBancoId=movementId;
      movement={id:movementId,bancoCod:bank.cod,data:dataFmt,
        descricao:'Adiantamento: '+(clean(supplier?.nome)||fornCod)+(ticket?' Ticket '+ticket:''),tipo:'Saida',valor:value,advanceCode:id,source:'advance'};
      updates['lancBanco/'+movementId]=movement;
    }
    const entries=[...records,advance];
    updates['adiantamentos/'+fornCod]=entries;
    updates['financeAdvanceOperations/'+operationKey]={advance,bankMovement:movement,cheques:createdCheques,requestFingerprint,fornCod,
      createdAt:new Date(now()).toISOString(),createdBy:clean(identity.erpUser||identity.uid)};
    updates._ts=now();
    await commitAdvanceAndRelease(db,updates,keys,owner,now);
    committedAndUnlocked=true;
    return {advance,bankMovement:movement,cheques:createdCheques,entries,alreadyCommitted:false};
  }finally{
    if(!committedAndUnlocked)await releaseAdvanceLocks(locks,owner);
  }
}

function assertLinkedBankMovement(advance,movement){
  const movementId=clean(advance?.movBancoId||'');
  if(!movementId)return;
  const wrong=[];
  if(!movement||typeof movement!=='object')wrong.push('ausente');
  else{
    const value=Number(movement.valor);
    const advanceValue=Number(advance.valor);
    if(!Number.isFinite(value)||!Number.isFinite(advanceValue)||Math.abs(value-advanceValue)>0.009)wrong.push('valor');
    if(String(movement.bancoCod??'')!==String(advance.bancoCod??''))wrong.push('conta');
    if(!String(movement.descricao||'').startsWith('Adiantamento: '))wrong.push('origem');
    if(movement.advanceCode&&String(movement.advanceCode)!==String(advance.cod))wrong.push('identificador');
  }
  if(wrong.length){
    const error=new Error('O movimento bancário deste adiantamento está divergente ('+wrong.join(', ')+'). A exclusão foi impedida para proteger os saldos. É necessária conciliação financeira, não repetição do clique.');
    error.status=409;
    error.code='BANK_LEDGER_CHANGED';
    throw error;
  }
}

function expectedMatches(previous,expected){
  if(!expected||typeof expected!=='object'||Array.isArray(expected))return false;
  const fields=['cod','valor','data','forma','bancoCod','movBancoId','status','ticket','empresa','obs'];
  return fields.every(key=>String(previous[key]??'')===String(expected[key]??''));
}

async function restoreConfirmedDelete(identity,{db,now,uuid,fornCod,adtCod,previous,operationKey}){
  const movementId=clean(previous?.movBancoId||'');
  if(!movementId||previous.status!=='Pendente'||previous.ticket||previous.ticketOrigem||
    previous.adiantamentoOrigem||Number(previous.valorCompensado||0)>0||
    Number(previous.valorAplicado||0)>0||previous.origem||
    (previous.chequeIds&&previous.chequeIds.length))return null;
  const operations=(await db.ref('erp/financeAdvanceOperations').get()).val()||{};
  const related=Object.values(operations).filter(r=>r&&typeof r==='object'&&(
    r.adtCod===adtCod||r.advance?.cod===adtCod||r.result?.removedCode===adtCod));
  const creates=related.filter(r=>{
    if(r.advance?.cod!==adtCod||r.action||r.result||
      String(r.advance.movBancoId||'')!==movementId||
      Number(r.advance.valor)!==Number(previous.valor)||
      String(r.advance.bancoCod||'')!==String(previous.bancoCod||''))return false;
    if(r.fornCod!=null&&String(r.fornCod).trim()!==''&&String(r.fornCod)!==fornCod)return false;
    return true;
  });
  const deletes=related.filter(r=>r.action==='delete'&&r.result?.removedCode===adtCod&&
    r.result?.fornCod===fornCod&&r.result?.movementRemovedId===movementId);
  if(creates.length!==1||deletes.length===0||
    related.some(receipt=>!creates.includes(receipt)&&!deletes.includes(receipt)))return null;
  const createdAt=Date.parse(creates[0].createdAt||'');
  if(!Number.isFinite(createdAt)||deletes.some(receipt=>
    !Number.isFinite(Date.parse(receipt.createdAt||''))||Date.parse(receipt.createdAt)<createdAt))return null;
  const deletion=deletes.reduce((latest,current)=>Date.parse(current.createdAt)>Date.parse(latest.createdAt)?current:latest);
  const lockRef=db.ref('erpFinanceAdvanceLocks/'+fornCod),owner=uuid();
  const acquired=await acquireAdvanceLock(lockRef,owner,now,{db,operationKey,fornCod,kind:'change'});
  if(!acquired)failure(409,'ADVANCE_IN_PROGRESS','Aguarde a conclusão da operação anterior.');
  let committed=false;
  try{
    const source=advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val());
    const matches=source.filter(row=>row?.cod===adtCod);
    if(matches.length!==1||!expectedMatches(matches[0],previous))
      failure(409,'ADVANCE_CHANGED','O adiantamento foi alterado. Atualize a consulta.');
    if((await db.ref('erp/lancBanco/'+pathKey(movementId)).get()).val())
      failure(409,'BANK_LEDGER_CHANGED','O lançamento bancário reapareceu; é necessária conferência.');
    const referencedPaths=['tickets','contasPagar','chequesControle','chequesCli','financePayableOperations',
      'purchaseCreateOperations','purchaseEditOperations','saldoDevedor','saldos','cheques'];
    const readings=await Promise.all(referencedPaths.map(path=>db.ref('erp/'+path).get()));
    for(let i=0;i<readings.length;i++){
      if(JSON.stringify(readings[i].val()??null).includes(JSON.stringify(adtCod)))
        failure(409,'ADVANCE_USED','Encontrada utilização financeira posterior; não é possível remover automaticamente.');
    }
    const fullLedger=(await db.ref('erp/lancBanco').get()).val()||{};
    if(Object.values(fullLedger).some(item=>item&&String(item.advanceCode||'')===adtCod||
      item&&String(item.id||'')===movementId))
      failure(409,'BANK_LEDGER_CHANGED','Outro movimento bancário pode estar vinculado ao adiantamento.');
    const tombstone={removedAt:now(),removedCode:adtCod,movementRemovedId:movementId,
      reason:'confirmed_delete_receipt_reappeared',originalDeletedAt:deletion.createdAt||null};
    const result={action:'delete',advance:null,removedCode:adtCod,bankMovement:null,
      movementRemovedId:movementId,entries:source.filter(row=>row?.cod!==adtCod),
      targetEntries:null,fornCod,newFornCod:fornCod,restoredDeletion:true};
    const {entries,targetEntries,...receipt}=result;
    await commitAdvanceAndRelease(db,{
      ['adiantamentos/'+fornCod]:entries,
      ['financeAdvanceDeleted/'+fornCod+'/'+adtCod]:tombstone,
      ['financeAdvanceOperations/'+operationKey]:{action:'delete',adtCod,result:receipt,
        createdAt:new Date(now()).toISOString(),createdBy:clean(identity.erpUser),recoveredFromReceipt:true},
      _ts:now()
    },[fornCod],owner,now);
    committed=true;
    return {...result,alreadyCommitted:false};
  }finally{
    if(!committed)await releaseAdvanceLocks([lockRef],owner);
  }
}

export async function changeAdvance(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  requireFinance(identity);
  db=await resolveDatabase(db);
  if(!input||typeof input!=='object'||Array.isArray(input))failure(400,'INVALID_INPUT','Dados inválidos.');
  const action=clean(input.action,10);
  if(action!=='edit'&&action!=='delete')failure(422,'INVALID_ACTION','Ação não permitida.');
  const fornCod=pathKey(input.fornCod);
  const adtCod=pathKey(input.adtCod);
  const newFornCod=action==='edit'&&input.newFornCod?pathKey(input.newFornCod):fornCod;
  const operationId=pathKey(input.operationId);
  if(!/^[a-f\d-]{36}$/i.test(operationId))failure(422,'INVALID_OPERATION','Identificador da operação inválido.');
  const opPath='erp/financeAdvanceOperations/'+pathKey(String(identity.uid||identity.erpUser||'user').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const opRef=db.ref(opPath);
  const existing=(await opRef.get()).val();
  if(existing?.action===action&&existing?.adtCod===adtCod){
    const receipt=existing.result;
    const [source,target]=await Promise.all([db.ref('erp/adiantamentos/'+receipt.fornCod).get(),receipt.newFornCod!==receipt.fornCod?db.ref('erp/adiantamentos/'+receipt.newFornCod).get():Promise.resolve(null)]);
    return {...receipt,entries:advanceRecords(source.val()),targetEntries:target?advanceRecords(target.val()):null,alreadyCommitted:true};
  }
  const operationKey=opPath.slice('erp/financeAdvanceOperations/'.length);
  const candidate=advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val())
    .find(row=>String(row.cod)===adtCod);
  if(action==='delete'&&candidate&&expectedMatches(candidate,input.expected)&&candidate.movBancoId){
    const bankMovement=(await db.ref('erp/lancBanco/'+pathKey(candidate.movBancoId)).get()).val();
    if(!bankMovement){
      const repaired=await restoreConfirmedDelete(identity,{db,now,uuid,fornCod,adtCod,
        previous:candidate,operationKey});
      if(repaired)return repaired;
    }
  }
  if(candidate&&expectedMatches(candidate,input.expected)){
    if(Number(candidate.valorCompensado||0)>0||candidate.origem==='compensacao_cp')
      failure(409,'ADVANCE_ALREADY_COMPENSATED','Adiantamento já compensado total ou parcialmente. Para alterar ou excluir, faça o estorno financeiro auditado.');
    if(candidate.movBancoId){
      const movement=(await db.ref('erp/lancBanco/'+pathKey(candidate.movBancoId)).get()).val();
      assertLinkedBankMovement(candidate,movement);
    }
  }
  const touchesCheques=Boolean(candidate&&(
    (Array.isArray(candidate.chequeIds)&&candidate.chequeIds.length>0)||
    ['Cheque','Cheque de Terceiro'].includes(candidate.forma)
  ));
  const keys=[...new Set([fornCod,newFornCod,...(touchesCheques?['__global_cheques__']:[])])].sort();
  const owner=uuid();
  const locks=[];
  let committedAndUnlocked=false;
  try{
    for(const key of keys){
      const lockRef=db.ref('erpFinanceAdvanceLocks/'+key);
      const acquired=await acquireAdvanceLock(lockRef,owner,now,{db,operationKey,fornCod:key,kind:'change'});
      if(!acquired){
        const active=(await lockRef.get()).val();
        const seconds=Math.ceil((Number(active?.expiresAt)-now())/1000);
        const error=new Error('Outra alteração financeira ainda está em processamento para este fornecedor.');
        error.status=409;
        error.code='ADVANCE_IN_PROGRESS';
        if(Number.isFinite(seconds)&&seconds>0)error.retryAfterSeconds=Math.min(seconds,120);
        console.warn('finance.advance.change.lock_busy',{
          scope:key==='__global_cheques__'?'cheques':'fornecedor',
          kind:String(active?.kind||'sem_metadados'),
          retryAfterSeconds:error.retryAfterSeconds||null
        });
        throw error;
      }
      locks.push(lockRef);
    }
    const again=(await opRef.get()).val();
    if(again?.action===action&&again?.adtCod===adtCod){
      const receipt=again.result;
      const [source,target]=await Promise.all([db.ref('erp/adiantamentos/'+receipt.fornCod).get(),receipt.newFornCod!==receipt.fornCod?db.ref('erp/adiantamentos/'+receipt.newFornCod).get():Promise.resolve(null)]);
      return {...receipt,entries:advanceRecords(source.val()),targetEntries:target?advanceRecords(target.val()):null,alreadyCommitted:true};
    }
    const [sourceSnap,targetSnap,banksSnap,suppliersSnap]=await Promise.all([
      db.ref('erp/adiantamentos/'+fornCod).get(),
      newFornCod===fornCod?Promise.resolve(null):db.ref('erp/adiantamentos/'+newFornCod).get(),
      db.ref('erp/bancos').get(),db.ref('erp/fornecedores').get()
    ]);
    const source=advanceRecords(sourceSnap.val());
    const matches=source.filter(a=>String(a.cod)===adtCod);
    if(matches.length!==1)failure(409,'ADVANCE_CHANGED','Adiantamento não encontrado ou duplicado. Atualize os dados.');
    const previous=matches[0];
    if(!expectedMatches(previous,input.expected))failure(409,'ADVANCE_CHANGED','O adiantamento foi alterado por outra sessão. Atualize antes de salvar.');
    if(Number(previous.valorCompensado||0)>0||previous.origem==='compensacao_cp')
      failure(409,'ADVANCE_ALREADY_COMPENSATED','Adiantamento já compensado total ou parcialmente. Para alterar ou excluir, faça o estorno financeiro auditado.');
    if(newFornCod!==fornCod&&!supplierExists(suppliersSnap.val(),newFornCod))failure(422,'SUPPLIER_NOT_FOUND','Fornecedor de destino não encontrado.');
    const oldMovementId=clean(previous.movBancoId||'');
    const originalMovement=oldMovementId?(await db.ref('erp/lancBanco/'+pathKey(oldMovementId)).get()).val():null;
    assertLinkedBankMovement(previous,originalMovement);
    let changed=null;
    let movement=null;
    let movementRemovedId='';
    const updates={};
    const linkedChequeIds=Array.isArray(previous.chequeIds)?previous.chequeIds.map(pathKey):[];
    if(['Cheque','Cheque de Terceiro'].includes(previous.forma)&&!linkedChequeIds.length)
      failure(409,'LEGACY_CHEQUE_RESTRICTED','Adiantamento legado com cheque exige conferência manual antes da alteração.');
    if(linkedChequeIds.length){
      for(const chequeId of linkedChequeIds){
        const cheque=(await db.ref('erp/chequesControle/'+chequeId).get()).val();
        if(cheque&&cheque.advanceCode===adtCod&&cheque.s==='C')
          failure(409,'CHEQUE_ALREADY_CLEARED','O cheque nº '+clean(cheque.n,40)+' deste adiantamento já foi compensado. Para alterar ou excluir o adiantamento, primeiro reabra o cheque em "Cheques a compensar".');
        if(!cheque||cheque.advanceCode!==adtCod||cheque.fornCod!==fornCod||
          !previous.chequeFingerprints||chequeFingerprint(cheque)!==previous.chequeFingerprints[chequeId])
          failure(409,'CHEQUE_LEDGER_CHANGED','Cheque vinculado foi alterado. A operação foi bloqueada para evitar divergências.');
      }
      if(action==='edit')failure(409,'CHEQUE_EDIT_RESTRICTED','Para alterar um adiantamento com cheques vinculados, exclua o lançamento e cadastre os cheques novamente.');
      for(const chequeId of linkedChequeIds)updates['chequesControle/'+chequeId]=null;
    }
    const nextSource=source.filter(a=>String(a.cod)!==adtCod);
    if(action==='edit'){
      const date=isoDate(input.data),value=amount(input.valor),forma=clean(input.forma,30);
      if(!['PIX','TED','Dinheiro','Cheque','Cheque de Terceiro','Transferência','Crédito'].includes(forma))
        failure(422,'INVALID_PAYMENT_METHOD','Forma de pagamento inválida.');
      const isBankTransfer=['PIX','TED','Dinheiro','Transferência'].includes(forma);
      if(['Cheque','Cheque de Terceiro'].includes(forma))
        failure(422,'CHEQUE_EDIT_RESTRICTED','Não é possível transformar um adiantamento em cheque pela edição. Cadastre os cheques pela operação específica.');
      const bankCode=isBankTransfer?pathKey(input.bancoCod):'';
      const bank=isBankTransfer?bankEntries(banksSnap.val()).find(b=>b.cod===bankCode):null;
      if(isBankTransfer&&!bank)failure(422,'BANK_NOT_FOUND','Conta bancária não encontrada.');
      if(isBankTransfer&&!oldMovementId&&previous.bancoNome&&previous.bancoNome!=='Não informado')
        failure(409,'LEGACY_LEDGER_NOT_LINKED','Adiantamento antigo sem movimento bancário vinculado. Solicite conciliação antes de alterar.');
      const status=clean(input.status,20);
      if(!['Pendente','Quitado'].includes(status))failure(422,'INVALID_STATUS','Status inválido.');
      const dataFmt=date.split('-').reverse().join('/');
      changed={...previous,data:dataFmt,valor:value,forma,status,
        bancoCod:bank?.cod||'',bancoNome:bank?.banco||'Não informado',
        empresa:clean(input.empresa,120),ticket:clean(input.ticket,100),obs:clean(input.obs,1000)};
      if(isBankTransfer){
        const movementId=oldMovementId||('LB-'+now()+'-'+uuid().replace(/-/g,'').slice(0,8));
        changed.movBancoId=movementId;
        const supplier=Object.values(suppliersSnap.val()||{}).find(s=>s&&String(s.cod)===newFornCod);
        movement={id:movementId,bancoCod:bank.cod,data:dataFmt,
          descricao:'Adiantamento: '+(clean(supplier?.nome)||newFornCod)+(changed.ticket?' Ticket '+changed.ticket:''),tipo:'Saida',valor:value,advanceCode:adtCod,source:'advance'};
        updates['lancBanco/'+movementId]=movement;
      }else{
        delete changed.movBancoId;
        if(oldMovementId){movementRemovedId=oldMovementId;updates['lancBanco/'+oldMovementId]=null;}
      }
    }else if(oldMovementId){
      movementRemovedId=oldMovementId;
      updates['lancBanco/'+oldMovementId]=null;
    }
    const target=targetSnap?advanceRecords(targetSnap.val()):[];
    if(changed){
      if(newFornCod!==fornCod&&target.some(a=>String(a.cod)===adtCod))failure(409,'ADVANCE_EXISTS','Já existe um adiantamento com esse código no fornecedor de destino.');
      (newFornCod===fornCod?nextSource:target).push(changed);
    }
    updates['adiantamentos/'+fornCod]=nextSource;
    if(action==='delete')updates['financeAdvanceDeleted/'+fornCod+'/'+adtCod]={
      removedAt:now(),removedCode:adtCod,movementRemovedId:oldMovementId||'',
      reason:'confirmed_financial_delete'
    };
    if(newFornCod!==fornCod)updates['adiantamentos/'+newFornCod]=target;
    const result={action,advance:changed,removedCode:action==='delete'?adtCod:null,
      bankMovement:movement,movementRemovedId,entries:nextSource,
      targetEntries:newFornCod!==fornCod?target:null,fornCod,newFornCod};
    const {entries,targetEntries,...receipt}=result;
    updates['financeAdvanceOperations/'+opPath.slice('erp/financeAdvanceOperations/'.length)]={action,adtCod,result:receipt,createdAt:new Date(now()).toISOString(),createdBy:clean(identity.erpUser)};
    updates._ts=now();
    await commitAdvanceAndRelease(db,updates,keys,owner,now);
    committedAndUnlocked=true;
    return {...result,alreadyCommitted:false};
  }finally{
    if(!committedAndUnlocked)await releaseAdvanceLocks(locks,owner);
  }
}
