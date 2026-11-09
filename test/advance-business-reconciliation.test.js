import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOrphanAdvance,recordVerifiedOrphanTransfer} from '../server/modules/advances/application/orphan-recovery.js';
const person={uid:'owner1',erpUser:'elaine',erpAccess:true,canAdvances:true,canBanking:true,admin:false};
const advanceCode='ADT_BANCO_124';
const movementId='LB_MISSING_124';
const base={fornCod:'F675',adtCod:advanceCode};
const original={cod:advanceCode,status:'Pendente',forma:'PIX',valor:124,bancoCod:'BC-005',movBancoId:movementId,data:'05/11/2026',ticket:''};
function dbFixture(){
  const state={erp:{adiantamentos:{F675:[structuredClone(original)]},
    bancos:{b:{cod:'BC-005',banco:'acred gratus'}},
    fornecedores:{f:{cod:'F675',nome:'TESTE NAO APAGAR'}},
    lancBanco:{},
    financeAdvanceOperations:{'create':{fornCod:'F675',advance:structuredClone(original),
      bankMovement:{id:movementId,advanceCode,bancoCod:'BC-005',valor:124,descricao:'Adiantamento: TESTE NAO APAGAR'}}}}};
  const read=path=>String(path).split('/').filter(Boolean).reduce((a,k)=>a?.[k],state);
  const write=(path,val)=>{let chunks=String(path).split('/').filter(Boolean);const end=chunks.pop();let obj=state;for(const key of chunks)obj=obj[key]??={};if(val===null)delete obj[end];else obj[end]=structuredClone(val);};
  const calls=[];let fail=false;
  return {state,calls,read,failNext(){fail=true;},ref(path){return {
    get:async()=>({val:()=>structuredClone(read(path)??null)}),
    transaction:async fn=>{const old=read(path)??null;const next=fn(structuredClone(old));if(next===undefined)return {committed:false};write(path,next);return {committed:true};},
    update:async changes=>{calls.push(structuredClone(changes));if(fail){fail=false;throw Error('Database offline');}for(const [p,v] of Object.entries(changes))write(path+'/'+p,v);}
  };}};
}
const operationId='11111111-2222-4333-8444-555555555555';
const payload=p=>({...base,signature:p.signature,operationId,confirmedRealTransfer:true,confirmedBankAmount:true,
  statementReference:'PIX-BC005-REAL-12345',reason:'Conferi no extrato externo o PIX efetivamente realizado para o fornecedor.'});

test('responsável financeiro negocial pode consultar, sem claim admin técnico',async()=>{
  const db=dbFixture();const p=await previewOrphanAdvance(person,base,{db});
  assert.equal(p.eligible,true);assert.equal(p.canRecordTransfer,true);assert.equal(p.bankName,'acred gratus');
  assert.equal(p.amount,124);
});

test('PIX real registrado no extrato recompõe movimento original com gravação atômica e auditoria',async()=>{
  const db=dbFixture();const p=await previewOrphanAdvance(person,base,{db});
  const result=await recordVerifiedOrphanTransfer(person,payload(p),{db,now:()=>12340000,uuid:()=> 'owner1'});
  assert.equal(result.confirmed,true);
  assert.equal(db.read('erp/lancBanco/'+movementId).advanceCode,advanceCode);
  assert.equal(db.read('erp/lancBanco/'+movementId).valor,124);
  assert.equal(db.read('erp/lancBanco/'+movementId).bancoCod,'BC-005');
  assert.equal(db.read('erp/adiantamentos/F675').length,1);
  assert.equal(db.read('erpFinanceAdvanceLocks/F675'),undefined);
  assert.equal(db.read('erp/financeAdvanceRecoveryAudit/owner1_'+operationId).action,'restore-missing-bank-movement');
  assert.equal(db.calls.length,1);assert.equal(db.calls[0]['erpFinanceAdvanceLocks/F675'],null);
});

test('repetir mesma solicitação é idempotente e não duplica débito',async()=>{
  const db=dbFixture(),p=await previewOrphanAdvance(person,base,{db});
  await recordVerifiedOrphanTransfer(person,payload(p),{db});
  const result=await recordVerifiedOrphanTransfer(person,payload(p),{db});
  assert.equal(result.alreadyCommitted,true);
  assert.equal(Object.keys(db.read('erp/lancBanco')).length,1);
  assert.equal(db.calls.length,1);
});

test('operação sem extrato confirmado, referência e explicação não grava',async()=>{
  const db=dbFixture(),p=await previewOrphanAdvance(person,base,{db});
  for(const extra of [{confirmedRealTransfer:false},{confirmedBankAmount:false},{statementReference:'PIX'},{reason:'teste'}])
    await assert.rejects(()=>recordVerifiedOrphanTransfer(person,{...payload(p),...extra},{db}),/./);
  assert.deepEqual(db.read('erp/lancBanco'),{});
});

test('se existir outro lançamento semelhante, bloqueia reconstrução para não duplicar dinheiro',async()=>{
  const db=dbFixture();db.state.erp.lancBanco.OTHER={id:'OTHER',bancoCod:'BC-005',valor:124,
    data:'05/11/2026',descricao:'Adiantamento: TESTE NAO APAGAR',tipo:'Saida'};
  const p=await previewOrphanAdvance(person,base,{db});
  assert.equal(p.canRecordTransfer,false);
  await assert.rejects(()=>recordVerifiedOrphanTransfer(person,payload(p),{db}),{code:'RECONCILIATION_NOT_SAFE'});
  assert.equal(Object.keys(db.read('erp/lancBanco')).length,1);
});

test('movimento aparecendo após prévia e operação usada impedem recomposição',async()=>{
  for(const change of [db=>{db.state.erp.lancBanco.OTHER={id:movementId,bancoCod:'BC-005',valor:124};},
    db=>{db.state.erp.tickets={T1:{advanceCode}};}]){
    const db=dbFixture(),p=await previewOrphanAdvance(person,base,{db});change(db);
    await assert.rejects(()=>recordVerifiedOrphanTransfer(person,payload(p),{db}),{code:'RECONCILIATION_NOT_SAFE'});
    assert.equal(db.read('erp/financeAdvanceRecoveryAudit'),undefined);
  }
});

test('falha de gravação não lança débito parcial nem deixa trava própria',async()=>{
  const db=dbFixture(),p=await previewOrphanAdvance(person,base,{db});db.failNext();
  await assert.rejects(()=>recordVerifiedOrphanTransfer(person,payload(p),{db}),/Database offline/);
  assert.deepEqual(db.read('erp/lancBanco'),{});
  assert.equal(db.read('erpFinanceAdvanceLocks/F675'),undefined);
  assert.equal(db.read('erp/financeAdvanceRecoveryAudit'),undefined);
});

test('sem canBanking não pode registrar movimento bancário',async()=>{
  const db=dbFixture(),p=await previewOrphanAdvance(person,base,{db});
  await assert.rejects(()=>recordVerifiedOrphanTransfer({...person,canBanking:false},payload(p),{db}),{code:'FINANCIAL_REVIEW_REQUIRED'});
});
