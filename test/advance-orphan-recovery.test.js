import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOrphanAdvance,recoverOrphanAdvance} from '../server/application/advance-orphan-recovery.js';

const admin={uid:'uid-admin',erpUser:'elaine',erpAccess:true,canAdvances:true,canBanking:true,admin:true};
const basic={fornCod:'F675',adtCod:'ADTMW40XFZ82E29C267'};
const operationId='11111111-2222-4333-8444-555555555555';
const original={cod:basic.adtCod,valor:124,forma:'PIX',bancoCod:'BC-005',status:'Pendente',ticket:'',movBancoId:'LB-1793912069926-301a7b11',data:'05/11/2026'};
const copy=v=>v===undefined?undefined:structuredClone(v);
function fixture(){
  const state={erp:{adiantamentos:{F675:[copy(original)]},lancBanco:{},bancos:{one:{cod:'BC-005',banco:'acred gratus'}},fornecedores:{one:{cod:'F675',nome:'TESTE NAO APAGAR'}},financeAdvanceOperations:{'uid-admin_created':{
    fornCod:'F675',advance:copy(original),bankMovement:{id:original.movBancoId,advanceCode:original.cod,bancoCod:'BC-005',valor:124}
  }}}};
  const get=path=>String(path).split('/').filter(Boolean).reduce((obj,k)=>obj?.[k],state);
  const set=(path,value)=>{const parts=String(path).split('/').filter(Boolean),last=parts.pop();let at=state;for(const k of parts)at=at[k]??={};if(value===null)delete at[last];else at[last]=copy(value);};
  const calls=[];
  let failUpdate=false;
  const db={state,calls,get,failNextUpdate(){failUpdate=true;},ref(path){return {
    async get(){return {val:()=>copy(get(path)??null)};},
    async transaction(fn){const prev=copy(get(path)??null),next=fn(prev);if(next===undefined)return {committed:false,snapshot:{val:()=>prev}};set(path,next);return {committed:true,snapshot:{val:()=>copy(next)}};},
    async update(batch){calls.push({path,batch:copy(batch)});if(failUpdate){failUpdate=false;throw new Error('Firebase unavailable');}for(const [p,v] of Object.entries(batch))set(path+'/'+p,v);}
  };}};
  return db;
}
const request=(preview,rest={})=>({...basic,operationId,signature:preview.signature,confirmCode:basic.adtCod,confirmedNoRealTransfer:true,
  reason:'Conferido extrato externo: nenhum PIX real realizado; registro de teste órfão.',...rest});

test('somente responsável financeiro autorizado acessa a conferência',async()=>{
  const db=fixture();
  await assert.rejects(()=>previewOrphanAdvance({...admin,canBanking:false},basic,{db}),{code:'FINANCIAL_REVIEW_REQUIRED'});
  await assert.rejects(()=>previewOrphanAdvance({...admin,canAdvances:false},basic,{db}),{code:'FINANCIAL_REVIEW_REQUIRED'});
});

test('órfão pendente sem movimento e sem uso gera prévia elegível e recuperação auditada',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  assert.equal(p.eligible,true,JSON.stringify(p.issues));
  const result=await recoverOrphanAdvance(admin,request(p),{db,now:()=>12345678,uuid:()=> 'owner1'});
  assert.equal(result.confirmed,true);
  assert.equal(db.get('erp/adiantamentos/F675').length,0);
  assert.deepEqual(db.get('erp/lancBanco'),{});
  assert.equal(db.get('erpFinanceAdvanceLocks/F675'),undefined);
  const audit=db.get('erp/financeAdvanceRecoveryAudit/uid-admin_'+operationId);
  assert.equal(audit.previousRecord.valor,124);
  assert.equal(audit.missingMovementId,original.movBancoId);
  assert.equal(audit.attestation,'no_external_bank_transfer');
  assert.equal(db.calls.at(-1).path,'/');
  assert.equal(db.calls.at(-1).batch['erpFinanceAdvanceLocks/F675'],null);
  assert.deepEqual(db.get('erp/financeAdvanceOperations/uid-admin_created').advance,original);
});

test('nova execução da mesma operação não cria segunda exclusão e mantém recibo',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  const payload=request(p);
  await recoverOrphanAdvance(admin,payload,{db});
  const again=await recoverOrphanAdvance(admin,payload,{db});
  assert.equal(again.alreadyCommitted,true);
  assert.equal(db.calls.length,1);
});

test('prévia desatualizada impede exclusão e libera a própria trava',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  db.state.erp.adiantamentos.F675[0].obs='Alterado por outra sessão';
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p),{db}),{code:'RECONCILIATION_CHANGED'});
  assert.equal(db.get('erp/adiantamentos/F675').length,1);
  assert.equal(db.get('erpFinanceAdvanceLocks/F675'),undefined);
});

test('falha na gravação não exclui nem inventa sucesso; trava própria é liberada',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  db.failNextUpdate();
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p),{db}),/Firebase unavailable/);
  assert.equal(db.get('erp/adiantamentos/F675').length,1);
  assert.equal(db.get('erpFinanceAdvanceLocks/F675'),undefined);
  assert.equal(db.get('erp/financeAdvanceRecoveryAudit/uid-admin_'+operationId),undefined);
});

test('não recupera quando movimento reaparece, mesmo com outro ID',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  db.state.erp.lancBanco.OUTRO={id:'OUTRO',advanceCode:basic.adtCod,bancoCod:'BC-005',valor:124};
  const after=await previewOrphanAdvance(admin,basic,{db});
  assert.equal(after.eligible,false);
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p),{db}),{code:'ORPHAN_NOT_SAFE'});
  assert.equal(db.get('erp/adiantamentos/F675').length,1);
});

test('não recupera adiantamento quitado, compensado, com ticket ou com cheque',async()=>{
  for(const alter of [{status:'Quitado'},{valorCompensado:1},{ticket:'T284'},{chequeIds:['CHQ1']},{valorOriginal:500}]){
    const db=fixture();Object.assign(db.state.erp.adiantamentos.F675[0],alter);
    const p=await previewOrphanAdvance(admin,basic,{db});
    assert.equal(p.eligible,false,JSON.stringify(alter));
    await assert.rejects(()=>recoverOrphanAdvance(admin,request(p),{db}),{code:'ORPHAN_NOT_SAFE'});
  }
});

test('referências em compra, pagamentos ou outras operações impedem exclusão',async()=>{
  for(const path of ['tickets','contasPagar','chequesControle','financePayableOperations','purchaseCreateOperations','saldoDevedor']){
    const db=fixture();
    db.state.erp[path]={r1:{refAdvance:basic.adtCod}};
    const p=await previewOrphanAdvance(admin,basic,{db});
    assert.equal(p.eligible,false,path);
    assert.match(p.issues.join(' '),new RegExp(path));
  }
});

test('criação com recibo original preservado não equivale a consumo de crédito',async()=>{
  const db=fixture();
  const p=await previewOrphanAdvance(admin,basic,{db});
  assert.equal(p.eligible,true);
  db.state.erp.financeAdvanceOperations['outra']={action:'edit',adtCod:basic.adtCod};
  const p2=await previewOrphanAdvance(admin,basic,{db});
  assert.equal(p2.eligible,false);
});

test('não recupera sem atestado, justificativa ou confirmação do código',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p,{confirmedNoRealTransfer:false}),{db}),{code:'RECONCILIATION_REQUIRED'});
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p,{confirmCode:'ADT_ERRADO'}),{db}),{code:'RECONCILIATION_REQUIRED'});
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p,{reason:'teste'}),{db}),{code:'REASON_REQUIRED'});
});

test('outra operação bloqueia recuperação e mantém o cadastro intacto',async()=>{
  const db=fixture(),p=await previewOrphanAdvance(admin,basic,{db});
  db.state.erpFinanceAdvanceLocks={F675:{owner:'other',expiresAt:Date.now()+50000}};
  await assert.rejects(()=>recoverOrphanAdvance(admin,request(p),{db}),{code:'ADVANCE_IN_PROGRESS'});
  assert.equal(db.get('erp/adiantamentos/F675').length,1);
  assert.equal(db.get('erpFinanceAdvanceLocks/F675').owner,'other');
});

test('recibo original divergente também bloqueia recuperação administrativa',async()=>{
  const db=fixture();
  db.state.erp.financeAdvanceOperations['uid-admin_created'].bankMovement.valor=124;
  db.state.erp.financeAdvanceOperations['uid-admin_created'].bankMovement.id='LB_OUTRO';
  const p=await previewOrphanAdvance(admin,basic,{db});
  assert.equal(p.eligible,false);
  assert.match(p.issues.join(' '),/recibo original/i);
});
