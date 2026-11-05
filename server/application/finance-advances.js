import {randomUUID,createHash} from 'node:crypto';

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
  const {getFirebaseAdmin}=await import('../infrastructure/firebase-admin.js');
  return getFirebaseAdmin().db;
}

function supplierTombstones(raw){
  if(Array.isArray(raw))return new Set(raw.filter(value=>value!=null).map(value=>String(value)));
  if(!raw||typeof raw!=='object')return new Set();
  return new Set(Object.entries(raw).filter(([,value])=>value===true||value===1||value==='true').map(([key])=>String(key)));
}

function supplierOptions(raw,deletedCodes,deletedIds){
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

async function acquireAdvanceLock(ref,owner,now){
  const delays=[0,160,280,420,640,900,1200,1600];
  for(const delay of delays){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const acquired=await ref.transaction(current=>{
      if(current&&Number(current.expiresAt)>now())return;
      return {owner,expiresAt:now()+120000};
    },undefined,false);
    if(acquired.committed)return true;
  }
  return false;
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
      // Own cheques are uniquely identified by bank and number. A third-party
      // cheque is only accepted repeatedly after an explicit operator review.
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
  const operationKey=pathKey(String(identity.uid||identity.erpUser||'user').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const opRef=db.ref('erp/financeAdvanceOperations/'+operationKey);
  const existing=(await opRef.get()).val();
  if(existing?.advance)return {advance:existing.advance,bankMovement:existing.bankMovement||null,cheques:existing.cheques||[],entries:advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val()),alreadyCommitted:true};
  const owner=uuid(),locks=[];
  const keys=(isCheque?[fornCod,'__global_cheques__']:[fornCod]).sort();
  try{
    for(const key of keys){
      const lockRef=db.ref('erpFinanceAdvanceLocks/'+key);
      const acquired=await acquireAdvanceLock(lockRef,owner,now);
      if(!acquired)failure(409,'ADVANCE_IN_PROGRESS','Outra operação financeira está em andamento. Tente novamente.');
      locks.push(lockRef);
    }
    const committed=(await opRef.get()).val();
    if(committed?.advance)return {advance:committed.advance,bankMovement:committed.bankMovement||null,cheques:committed.cheques||[],entries:advanceRecords((await db.ref('erp/adiantamentos/'+fornCod).get()).val()),alreadyCommitted:true};
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
        // The old CC+bank+number key silently collided for distinct third-party cheques.
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
        descricao:'Adiantamento: '+(clean(supplier?.nome)||fornCod)+(ticket?' Ticket '+ticket:''),tipo:'Saida',valor:value};
      updates['lancBanco/'+movementId]=movement;
    }
    const entries=[...records,advance];
    updates['adiantamentos/'+fornCod]=entries;
    updates['financeAdvanceOperations/'+operationKey]={advance,bankMovement:movement,cheques:createdCheques,
      createdAt:new Date(now()).toISOString(),createdBy:clean(identity.erpUser||identity.uid)};
    updates._ts=now();
    await db.ref('erp').update(updates);
    return {advance,bankMovement:movement,cheques:createdCheques,entries,alreadyCommitted:false};
  }finally{
    for(const lockRef of locks.reverse()){
      try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}catch(error){console.error('finance.advance.lock.release',error);}
    }
  }
}

function expectedMatches(previous,expected){
  if(!expected||typeof expected!=='object'||Array.isArray(expected))return false;
  const fields=['cod','valor','data','forma','bancoCod','movBancoId','status','ticket','empresa','obs'];
  return fields.every(key=>String(previous[key]??'')===String(expected[key]??''));
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
  const keys=[...new Set([fornCod,newFornCod,'__global_cheques__'])].sort();
  const owner=uuid();
  const locks=[];
  try{
    for(const key of keys){
      const lockRef=db.ref('erpFinanceAdvanceLocks/'+key);
      const acquired=await acquireAdvanceLock(lockRef,owner,now);
      if(!acquired)failure(409,'ADVANCE_IN_PROGRESS','Outra alteração está em andamento para este fornecedor. Tente novamente.');
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
    if(oldMovementId&&(!originalMovement||Math.abs(Number(originalMovement.valor)-Number(previous.valor))>0.009||
      originalMovement.bancoCod!==previous.bancoCod||!String(originalMovement.descricao||'').startsWith('Adiantamento: ')))
      failure(409,'BANK_LEDGER_CHANGED','Movimento bancário vinculado foi alterado. A operação foi bloqueada para evitar divergências.');
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
          descricao:'Adiantamento: '+(clean(supplier?.nome)||newFornCod)+(changed.ticket?' Ticket '+changed.ticket:''),tipo:'Saida',valor:value};
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
    if(newFornCod!==fornCod)updates['adiantamentos/'+newFornCod]=target;
    const result={action,advance:changed,removedCode:action==='delete'?adtCod:null,
      bankMovement:movement,movementRemovedId,entries:nextSource,
      targetEntries:newFornCod!==fornCod?target:null,fornCod,newFornCod};
    const {entries,targetEntries,...receipt}=result;
    updates['financeAdvanceOperations/'+opPath.slice('erp/financeAdvanceOperations/'.length)]={action,adtCod,result:receipt,createdAt:new Date(now()).toISOString(),createdBy:clean(identity.erpUser)};
    updates._ts=now();
    await db.ref('erp').update(updates);
    return {...result,alreadyCommitted:false};
  }finally{
    for(const lockRef of locks.reverse()){
      try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}
      catch(error){console.error('finance.advance.lock.release',error);}
    }
  }
}
