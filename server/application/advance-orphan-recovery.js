import {createHash,randomUUID} from 'node:crypto';

// Operação excepcional. Não reconcilia pagamentos reais e não altera o extrato:
// só remove um registro sem movimento, sem uso e com atestado administrativo.
const fail=(status,code,message)=>{const e=new Error(message);e.status=status;e.code=code;throw e;};
const key=value=>{
  const v=String(value??'').trim();
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(v))fail(422,'INVALID_KEY','Código inválido.');
  return v;
};
const items=value=>Object.entries(value&&typeof value==='object'?value:{}).filter(([,v])=>v&&typeof v==='object');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Responsável financeiro do ERP, não administrador técnico do Firebase.
const requireFinancialManager=identity=>{
  if(identity?.erpAccess!==true||identity?.canAdvances!==true||identity?.canBanking!==true)
    fail(403,'FINANCIAL_REVIEW_REQUIRED','A conferência exige acesso a Adiantamentos e Bancos.');
};
async function resolve(db){if(db)return db;return (await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;}
const checkedPaths=[
  'bancos','fornecedores','adiantamentos','lancBanco','tickets','contasPagar','chequesControle','chequesCli',
  'financePayableOperations','purchaseCreateOperations','purchaseEditOperations',
  'financeAdvanceOperations','financeAdvanceRecoveryAudit','saldoDevedor','saldos',
  'cheques','chequesControle_del'
];
function containsId(value,id){return JSON.stringify(value??null).includes('"'+id+'"');}

async function inspect(db,fornCod,adtCod){
  const [advSnap,...other]=await Promise.all([
    db.ref('erp/adiantamentos/'+fornCod).get(),
    ...checkedPaths.map(path=>db.ref('erp/'+path).get())
  ]);
  const current=advSnap.val();
  const records=items(current);
  const matches=records.filter(([,a])=>String(a.cod)===adtCod);
  const advance=matches.length===1?matches[0][1]:null;
  const paths=Object.fromEntries(checkedPaths.map((p,i)=>[p,other[i].val()]));
  const issues=[];
  if(!Array.isArray(current))issues.push('O cadastro não usa a estrutura de lista esperada: revisão manual obrigatória.');
  if(matches.length!==1)issues.push('Registro ausente ou duplicado dentro do fornecedor.');
  if(advance){
    if(advance.status!=='Pendente')issues.push('Adiantamento não está pendente.');
    if(!['PIX','TED','Dinheiro','Transferência'].includes(String(advance.forma)))issues.push('Forma de pagamento não elegível.');
    if(!advance.movBancoId)issues.push('Adiantamento sem identificador bancário: exige investigação separada.');
    if(advance.ticket||advance.ticketOrigem||advance.adiantamentoOrigem)issues.push('Existe vínculo com compra ou outra compensação.');
    if(Number(advance.valorCompensado||0)!==0||Number(advance.valorAplicado||0)!==0||
      (advance.valorOriginal!=null&&Math.abs(Number(advance.valorOriginal)-Number(advance.valor))>0.009)||
      (advance.valorDisponivel!=null&&Math.abs(Number(advance.valorDisponivel)-Number(advance.valor))>0.009))
      issues.push('Adiantamento possui evidência de utilização parcial.');
    if((advance.chequeIds&&advance.chequeIds.length)||advance.chequeFingerprints||advance.origem)
      issues.push('Registro com origem especial ou cheques associados.');
    if(!Number.isFinite(Number(advance.valor))||Number(advance.valor)<=0)issues.push('Valor inválido.');
    const bankRows=items(paths.lancBanco);
    if(bankRows.some(([id,m])=>id===advance.movBancoId||String(m.id||'')===advance.movBancoId||String(m.advanceCode||'')===adtCod))
      issues.push('Existe movimentação bancária que precisa ser conciliada.');
    for(const [supplier,otherRecords] of items(paths.adiantamentos)){
      const duplicate=items(otherRecords).filter(([,a])=>String(a.cod||'')===adtCod);
      if(supplier!==fornCod&&duplicate.length)issues.push('O código aparece em outro fornecedor.');
    }
    for(const name of ['tickets','contasPagar','chequesControle','chequesCli',
      'financePayableOperations','purchaseCreateOperations','purchaseEditOperations',
      'saldoDevedor','saldos','cheques','chequesControle_del']){
      if(containsId(paths[name],adtCod))issues.push('Referência financeira detectada em '+name+'.');
    }
    const receipts=items(paths.financeAdvanceOperations).filter(([,op])=>containsId(op,adtCod));
    const previousDeleteConfirmed=receipts.some(([,op])=>op.action==='delete'&&
      op.result?.removedCode===adtCod&&op.result?.fornCod===fornCod&&
      String(op.result?.movementRemovedId||'')===String(advance.movBancoId||''));
    for(const [,op] of receipts){
      // Um DELETE já concluído não é utilização de crédito. O registro pode
      // ter sido restaurado por um cliente antigo; apenas a API de exclusão
      // pode reaplicar a baixa confirmada, sem manipular o banco novamente.
      if(op.action==='delete'&&op.result?.removedCode===adtCod&&
        op.result?.fornCod===fornCod&&
        String(op.result?.movementRemovedId||'')===String(advance.movBancoId||''))continue;
      // Uma criação original não é aplicação de saldo. Preservaremos o recibo.
      if(String(op.advance?.cod)!==adtCod||op.action||op.result||
        (op.fornCod&&op.fornCod!==fornCod)){
        issues.push('Outra operação financeira utiliza esse adiantamento.');
      }else if(Number(op.advance.valor)!==Number(advance.valor)||
        String(op.advance.bancoCod||'')!==String(advance.bancoCod||'')||
        String(op.advance.movBancoId||'')!==String(advance.movBancoId||'')||
        (op.bankMovement&&(
          String(op.bankMovement.id||'')!==String(advance.movBancoId)||
          String(op.bankMovement.advanceCode||'')!==adtCod))){
        issues.push('O recibo original não corresponde ao adiantamento atual.');
      }
    }
    if(previousDeleteConfirmed)
      issues.push('O servidor já confirmou a exclusão anterior. Feche esta conferência e use a lixeira do adiantamento para finalizar a retirada do registro que reapareceu, sem nova movimentação bancária.');
    if(items(paths.financeAdvanceRecoveryAudit).some(([,op])=>op.adtCod===adtCod))
      issues.push('Este adiantamento já possui recuperação registrada.');
  }
  const bank=Object.values(paths.bancos||{}).find(b=>b&&typeof b==='object'&&
    String(b.cod||b.codigo||b.id||'')===String(advance?.bancoCod||''));
  const supplier=Object.values(paths.fornecedores||{}).find(f=>f&&String(f.cod||'')===fornCod);
  const bankName=String(bank?.banco||bank?.nome||bank?.nomeBanco||advance?.bancoNome||'Conta não identificada');
  const supplierName=String(supplier?.nome||fornCod);
  const receipt=items(paths.financeAdvanceOperations)
    .find(([,op])=>op?.advance?.cod===adtCod&&(!op.action)&&(!op.result))?.[1];
  const originalMovement=receipt?.bankMovement;
  if(originalMovement){
    if((originalMovement.valor!=null&&Number(originalMovement.valor)!==Number(advance?.valor))||
      (originalMovement.bancoCod&&String(originalMovement.bancoCod)!==String(advance?.bancoCod))||
      (originalMovement.id&&String(originalMovement.id)!==String(advance?.movBancoId)))
      issues.push('Dados bancários divergentes entre a criação e o cadastro.');
  }
  // Valores/documentos de outras saídas no mesmo dia podem indicar uma gravação
  // reidentificada. A reconciliação automática não pode criar um débito duplicado.
  const similarMovements=items(paths.lancBanco).filter(([,m])=>m&&
    String(m.bancoCod||'')===String(advance?.bancoCod||'')&&
    Number(m.valor)===Number(advance?.valor)&&
    String(m.data||'')===String(advance?.data||'')&&
    /adiantamento/i.test(String(m.descricao||''))&&
    String(m.descricao||'').toLowerCase().includes(supplierName.toLowerCase()));
  const canRecordTransfer=Boolean(bank&&advance?.movBancoId&&similarMovements.length===0);
  const signature=hash({fornCod,adtCod,current,paths});
  return {advance,entries:current,issues:[...new Set(issues)],signature,
    checkedPaths:[...checkedPaths],bankName,supplierName,canRecordTransfer,similarMovements,originalMovement};
}

export async function previewOrphanAdvance(identity,input,{db}={}){
  requireFinancialManager(identity);
  const fornCod=key(input?.fornCod),adtCod=key(input?.adtCod);
  db=await resolve(db);
  const result=await inspect(db,fornCod,adtCod);
  const lock=(await db.ref('erpFinanceAdvanceLocks/'+fornCod).get()).val();
  if(lock&&Number(lock.expiresAt)>Date.now())result.issues.push('Outra operação do fornecedor está ativa.');
  return {fornCod,adtCod,eligible:result.issues.length===0,issues:result.issues,
    amount:result.advance?.valor??null,bankCode:result.advance?.bancoCod??null,
    bankName:result.bankName,supplierName:result.supplierName,date:result.advance?.data||'',
    canRecordTransfer:result.canRecordTransfer,
    missingMovementId:result.advance?.movBancoId??null,signature:result.signature,
    checkedPaths:result.checkedPaths};
}

export async function recoverOrphanAdvance(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  requireFinancialManager(identity);
  const fornCod=key(input?.fornCod),adtCod=key(input?.adtCod),operationId=key(input?.operationId);
  if(!/^[0-9a-f-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Identificador da operação inválido.');
  if(String(input?.confirmCode||'')!==adtCod||input?.confirmedNoRealTransfer!==true)
    fail(422,'RECONCILIATION_REQUIRED','É obrigatório confirmar o código e que NÃO houve saída bancária real.');
  const reason=String(input?.reason||'').trim();
  if(reason.length<25||reason.length>500)fail(422,'REASON_REQUIRED','Informe justificativa de auditoria com ao menos 25 caracteres.');
  const expected=String(input?.signature||'');
  if(!/^[0-9a-f]{64}$/i.test(expected))fail(422,'INVALID_PREVIEW','Prévia inválida. Consulte novamente.');
  db=await resolve(db);
  const opKey=key(String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const auditRef=db.ref('erp/financeAdvanceRecoveryAudit/'+opKey);
  const existing=(await auditRef.get()).val();
  if(existing){
    if(existing.adtCod!==adtCod||existing.fornCod!==fornCod||existing.signature!==expected||existing.action!=='orphan-delete')
      fail(409,'OPERATION_REUSED','Identificador já utilizado para outra recuperação.');
    return {confirmed:true,alreadyCommitted:true,removedCode:adtCod,fornCod};
  }
  const lockRef=db.ref('erpFinanceAdvanceLocks/'+fornCod),owner=uuid();
  const acquired=await lockRef.transaction(current=>current&&Number(current.expiresAt)>now()?undefined:
    {owner,kind:'orphan-recovery',fornCod,operationKey:opKey,expiresAt:now()+120000},undefined,false);
  if(!acquired.committed)fail(409,'ADVANCE_IN_PROGRESS','Outra operação financeira está em andamento.');
  let committed=false;
  try{
    const fresh=await inspect(db,fornCod,adtCod);
    if(fresh.issues.length)fail(409,'ORPHAN_NOT_SAFE','Recuperação bloqueada: '+fresh.issues.join(' '));
    if(fresh.signature!==expected)fail(409,'RECONCILIATION_CHANGED','Os dados mudaram desde a prévia. Refaça a conferência.');
    const existingReceipt=(await auditRef.get()).val();
    if(existingReceipt)fail(409,'OPERATION_REUSED','Outra sessão já realizou a recuperação.');
    const active=(await lockRef.get()).val();
    if(active?.owner!==owner||Number(active.expiresAt)<=now())fail(409,'ADVANCE_LOCK_LOST','Reserva financeira expirada.');
    const record=fresh.advance;
    const entries=fresh.entries.filter(a=>String(a?.cod)!==adtCod);
    const receipt={action:'orphan-delete',adtCod,fornCod,operationId,signature:expected,
      previousRecord:record,missingMovementId:record.movBancoId,bankCode:record.bancoCod||'',
      actor:String(identity.erpUser||identity.uid||''),actorUid:String(identity.uid||''),
      performedAt:new Date(now()).toISOString(),reason,attestation:'no_external_bank_transfer',
      checkedPaths:fresh.checkedPaths};
    // Adiantamento, comprovante da recuperação e liberação da trava na mesma gravação.
    await db.ref('/').update({
      ['erp/adiantamentos/'+fornCod]:entries,
      ['erp/financeAdvanceDeleted/'+fornCod+'/'+adtCod]:{removedCode:adtCod,removedAt:now(),reason:'audited_orphan_delete'},
      ['erp/financeAdvanceRecoveryAudit/'+opKey]:receipt,
      'erp/_ts':now(),
      ['erpFinanceAdvanceLocks/'+fornCod]:null
    });
    committed=true;
    return {confirmed:true,alreadyCommitted:false,removedCode:adtCod,fornCod,entries};
  }finally{
    if(!committed){
      try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}
      catch(error){console.error('orphan.recovery.release.failed',error);}
    }
  }
}

/**
 * Conferência financeira de uma transferência que de fato ocorreu fora do ERP.
 * Reconstitui o registro bancário ausente no ID original, SEM enviar PIX e SEM
 * lançar outro adiantamento. O valor, a conta e o fornecedor não são editáveis.
 * Nenhuma ação é feita sem confirmação explícita do extrato real e comprovante.
 */
export async function recordVerifiedOrphanTransfer(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  requireFinancialManager(identity);
  const fornCod=key(input?.fornCod),adtCod=key(input?.adtCod),operationId=key(input?.operationId);
  if(!/^[0-9a-f-]{36}$/i.test(operationId))fail(422,'INVALID_OPERATION','Identificador da operação inválido.');
  if(input?.confirmedRealTransfer!==true||input?.confirmedBankAmount!==true)
    fail(422,'BANK_CONFIRMATION_REQUIRED','Confira o extrato bancário e confirme o pagamento e seu valor.');
  const statementReference=String(input?.statementReference||'').trim();
  const reason=String(input?.reason||'').trim();
  if(statementReference.length<6||statementReference.length>120)
    fail(422,'STATEMENT_REQUIRED','Informe a referência do comprovante ou identificador da transferência.');
  if(reason.length<25||reason.length>500)
    fail(422,'REASON_REQUIRED','Registre uma observação sobre a conferência financeira.');
  const expected=String(input?.signature||'');
  if(!/^[0-9a-f]{64}$/i.test(expected))fail(422,'INVALID_PREVIEW','Prévia inválida. Consulte novamente.');
  db=await resolve(db);
  const opKey=key(String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_'))+'_'+operationId;
  const auditRef=db.ref('erp/financeAdvanceRecoveryAudit/'+opKey);
  const existing=(await auditRef.get()).val();
  if(existing){
    if(existing.adtCod!==adtCod||existing.fornCod!==fornCod||existing.signature!==expected||existing.action!=='restore-missing-bank-movement')
      fail(409,'OPERATION_REUSED','Conferência já registrada com outros dados.');
    return {confirmed:true,alreadyCommitted:true,action:'restore-missing-bank-movement',adtCod,fornCod};
  }
  const lockRef=db.ref('erpFinanceAdvanceLocks/'+fornCod),owner=uuid();
  const acquired=await lockRef.transaction(current=>current&&Number(current.expiresAt)>now()?undefined:
    {owner,kind:'bank-reconciliation',fornCod,operationKey:opKey,expiresAt:now()+120000},undefined,false);
  if(!acquired.committed)fail(409,'ADVANCE_IN_PROGRESS','Outra operação deste fornecedor está em andamento.');
  let committed=false;
  try{
    const fresh=await inspect(db,fornCod,adtCod);
    if(fresh.issues.length||!fresh.canRecordTransfer)
      fail(409,'RECONCILIATION_NOT_SAFE','Existem informações que exigem conferência antes de registrar a movimentação.');
    if(fresh.signature!==expected)fail(409,'RECONCILIATION_CHANGED','Os dados mudaram desde a conferência. Revise novamente.');
    const existingReceipt=(await auditRef.get()).val();
    if(existingReceipt)fail(409,'OPERATION_REUSED','Outra sessão já concluiu esta conferência.');
    const active=(await lockRef.get()).val();
    if(active?.owner!==owner||Number(active.expiresAt)<=now())fail(409,'ADVANCE_LOCK_LOST','A reserva financeira não está mais válida.');
    const a=fresh.advance;
    const movementId=key(a.movBancoId);
    // ID único original. Não se cria outra chave bancária nem operação de pagamento externo.
    if((await db.ref('erp/lancBanco/'+movementId).get()).val())
      fail(409,'BANK_MOVEMENT_EXISTS','Já existe lançamento com esse identificador. Confira o extrato.');
    const original=fresh.originalMovement||{};
    const movement={id:movementId,bancoCod:a.bancoCod,data:a.data,
      descricao:original.descricao&&String(original.descricao).startsWith('Adiantamento: ')
        ?original.descricao:'Adiantamento: '+fresh.supplierName+(a.ticket?' Ticket '+a.ticket:''),
      tipo:'Saida',valor:Number(a.valor),advanceCode:adtCod,source:'advance',
      reconciledFromStatement:true,reconciliationReference:statementReference,
      reconciledAt:new Date(now()).toISOString()};
    const receipt={action:'restore-missing-bank-movement',adtCod,fornCod,operationId,
      signature:expected,bankMovement:movement,actor:String(identity.erpUser||identity.uid||''),
      actorUid:String(identity.uid||''),performedAt:new Date(now()).toISOString(),
      statementReference,reason,attestation:'external_transfer_verified',
      checkedPaths:fresh.checkedPaths};
    await db.ref('/').update({
      ['erp/lancBanco/'+movementId]:movement,
      ['erp/financeAdvanceRecoveryAudit/'+opKey]:receipt,
      'erp/_ts':now(),
      ['erpFinanceAdvanceLocks/'+fornCod]:null
    });
    committed=true;
    return {confirmed:true,alreadyCommitted:false,action:'restore-missing-bank-movement',adtCod,fornCod};
  }finally{
    if(!committed){
      try{await lockRef.transaction(current=>current?.owner===owner?null:undefined,undefined,false);}
      catch(error){console.error('advance.bank.reconciliation.release.failed',error);}
    }
  }
}
