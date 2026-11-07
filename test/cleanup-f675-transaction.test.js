import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planSupplierTestCleanup,executeControlledCleanup} from '../scripts/cleanup-test-supplier-f675.mjs';

function fixture(){
  return {erp:{
    adiantamentos:{F675:[
      {cod:'ADTMW3ZCB9K3E9382B3',valor:100,bancoCod:'BC-012',status:'Quitado',movBancoId:'LB-1793909404443-411c253f',ticket:'T275'},
      {cod:'ADTMW5EI8XVDCB9BAE9',valor:35,bancoCod:'BC-005',status:'Quitado',movBancoId:'LB-1793995341766-d9d87583',ticket:'T303',valorCompensado:35},
      {cod:'ADTMW5EJE9G02C2C589',valor:25,bancoCod:'BC-005',status:'Pendente',movBancoId:'LB-1793995395318-0d760685',valorCompensado:75},
      {cod:'ADTmw5fd5m45869e921',valor:15,bancoCod:'BC-005',status:'Quitado',origem:'compensacao_cp',ticket:'T303',movBancoId:''}
    ]},
    contasPagar:{
      CPPO_T303:{id:'CPPO_T303',ticket:'T303',fornCod:'F675',cred:'TESTE NAO APAGAR',valor:0,valorPago:0,status:'Pago',pagamentos:[{valor:0,adt:50}]},
      CPPO_T309:{id:'CPPO_T309',ticket:'T309',fornCod:'F675',cred:'TESTE NAO APAGAR',valor:50,valorPago:200,status:'Pendente',pagamentos:[
        {valor:50,adt:0,movBancoId:'LB-PG-1793999084675-c53e2681'},
        {valor:50,adt:0,movBancoId:'LB-PG-1793999234976-46dd0e59'},
        {valor:50,adt:0,movBancoId:'LB-PG-1794001531014-e2fcaf89'},
        {valor:50,adt:0,movBancoId:'LB-PG-1794001697320-3f127753'}
      ]}
    },
    lancBanco:{
      'LB-1793995341766-d9d87583':{id:'LB-1793995341766-d9d87583',valor:35,tipo:'Saida',bancoCod:'BC-005',advanceCode:'ADTMW5EI8XVDCB9BAE9'},
      'LB-1793995395318-0d760685':{id:'LB-1793995395318-0d760685',valor:100,tipo:'Saida',bancoCod:'BC-005',advanceCode:'ADTMW5EJE9G02C2C589'},
      ...Object.fromEntries(['LB-PG-1793999084675-c53e2681','LB-PG-1793999234976-46dd0e59','LB-PG-1794001531014-e2fcaf89','LB-PG-1794001697320-3f127753'].map(id=>[id,{id,valor:50,tipo:'Saida',bancoCod:'BC-005',payableId:'CPPO_T309'}]))
    },financeAdvanceOperations:{receipt:{action:'create',result:{advance:{cod:'ADTMW5EI8XVDCB9BAE9'}}}},financePayableOperations:{receipt:{result:{payable:{id:'CPPO_T309'}}}},
    saldoDevedor:{F675:{ticket:'T284',valor:200}},
    saldos:{F675:{ticket:'T284',valor:200}},
    fornecedores:{f1:{cod:'F675',nome:'TESTE NAO APAGAR'}}
  }};
}
const clone=structuredClone;
function mockDB(data){
  const state=clone(data);
  const read=p=>p.split('/').filter(Boolean).reduce((cur,k)=>cur?.[k],state);
  const put=(p,val)=>{const parts=p.split('/').filter(Boolean),key=parts.pop();let parent=state;for(const part of parts)parent=parent[part]??={};if(val===null)delete parent[key];else parent[key]=clone(val);};
  return {state,ref(path=''){return {
    async get(){return {val:()=>clone(read(path)??null)};},
    async transaction(fn){const next=fn(clone(read(path)??null));if(next===undefined)return {committed:false};put(path,next);return {committed:true};},
    async update(values){for(const [key,val] of Object.entries(values))put([path,key].filter(Boolean).join('/'),val);}
  };}};
}

test('prévia do F675 identifica exatamente 4 adiantamentos, 2 contas e 6 movimentos sem alterar o snapshot',()=>{
  const f=fixture(),before=JSON.stringify(f),plan=planSupplierTestCleanup(f);
  assert.deepEqual({a:plan.advances,p:plan.payables,m:plan.bankMovements,c:plan.bankMovementsTotalCents},{a:4,p:2,m:6,c:33500});
  assert.equal(plan.readyForControlledCleanup,true,plan.blockers.join('; '));
  assert.equal(JSON.stringify(f),before);
  assert.equal(plan.planHash.length,64);
});

test('qualquer ticket ainda ativo bloqueia limpeza',()=>{
  const f=fixture();f.erp.tickets={T303:{ticket:'T303',fornecedorCod:'F675'}};
  assert.equal(planSupplierTestCleanup(f).readyForControlledCleanup,false);
});

test('novo adiantamento, pagamento ou movimento inesperado bloqueia a operação',()=>{
  const f=fixture();f.erp.adiantamentos.F675.push({cod:'EXTRA',valor:12,status:'Pendente',bancoCod:'BC-005'});
  assert.equal(planSupplierTestCleanup(f).readyForControlledCleanup,false);
  const g=fixture();g.erp.contasPagar.CPPO_T309.pagamentos.push({valor:50,adt:0});
  assert.equal(planSupplierTestCleanup(g).readyForControlledCleanup,false);
  const h=fixture();h.erp.lancBanco.EXTRA={id:'EXTRA',valor:50,bancoCod:'BC-005',tipo:'Saida',payableId:'CPPO_T309'};
  assert.equal(planSupplierTestCleanup(h).readyForControlledCleanup,false);
});

test('referência inesperada em cheque bloqueia a exclusão',()=>{
  const f=fixture();f.erp.chequesControle={x:{advanceCode:'ADTMW5EI8XVDCB9BAE9'}};
  assert.equal(planSupplierTestCleanup(f).readyForControlledCleanup,false);
});

test('sem confirmação ou prévia correta, não altera o banco',async()=>{
  const f=fixture(),db=mockDB(f),before=JSON.stringify(db.state);
  const plan=planSupplierTestCleanup(f);
  await assert.rejects(()=>executeControlledCleanup(db,{planHash:plan.planHash,confirm:'NÃO'}),/Confirmação literal/);
  await assert.rejects(()=>executeControlledCleanup(db,{planHash:'0'.repeat(64),confirm:'CONFIRMO_EXCLUSAO_SOMENTE_TESTES_F675_SEM_PIX_REAL'}),/Firebase alterado/);
  assert.equal(JSON.stringify(db.state.erp),JSON.stringify(f.erp));
});

test('limpeza confirmada remove somente registros previstos, preservando recibos e fornecedor',async()=>{
  const f=fixture(),db=mockDB(f),dir=await mkdtemp(join(tmpdir(),'f675-test-'));
  try{
    const plan=planSupplierTestCleanup(f);
    const result=await executeControlledCleanup(db,{planHash:plan.planHash,
      confirm:'CONFIRMO_EXCLUSAO_SOMENTE_TESTES_F675_SEM_PIX_REAL',backupDir:dir,
      now:()=>1794009000000,uuid:()=> 'test-operation-id'});
    assert.equal(result.status,'CONFIRMED');
    assert.equal(db.state.erp.adiantamentos.F675,undefined);
    assert.equal(db.state.erp.saldoDevedor.F675,undefined);
    assert.equal(db.state.erp.saldos.F675,undefined);
    assert.equal(db.state.erp.contasPagar.CPPO_T303,undefined);
    assert.equal(db.state.erp.contasPagar.CPPO_T309,undefined);
    assert.equal(Object.keys(db.state.erp.lancBanco).length,0);
    assert.equal(db.state.erp.contasPagarDeleted.CPPO_T309,true);
    assert.equal(db.state.erp.financeAdvanceDeleted.F675.ADTMW3ZCB9K3E9382B3.reason,'supplier_test_cleanup');
    assert.equal(Object.keys(db.state.erp.financeAdvanceOperations).length,1);
    assert.equal(Object.keys(db.state.erp.financePayableOperations).length,1);
    assert.equal(db.state.erp.fornecedores.f1.nome,'TESTE NAO APAGAR');
    assert.equal(db.state.erpFinanceAdvanceLocks?.F675,undefined);
    const backup=JSON.parse(await readFile(result.backupPath,'utf8'));
    assert.equal(Object.keys(backup.bankMovements).length,6);
    assert.deepEqual(backup.legacyBalances.saldoDevedor,{ticket:'T284',valor:200});
    assert.deepEqual(backup.legacyBalances.saldos,{ticket:'T284',valor:200});
    assert.equal(Object.keys(backup.advanceReceipts).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('aceita exclusivamente os dois saldos legados de T284 por R$ 200',()=>{
  const f=fixture(),plan=planSupplierTestCleanup(f);
  assert.equal(plan.readyForControlledCleanup,true,plan.blockers.join('; '));
  assert.equal(plan.legacyBalances,2);
  assert.equal(plan.legacyBalanceEachCents,20000);
});

test('não aceita saldo legado diferente, ausente ou com campos adicionais',()=>{
  const scenarios=[
    f=>{f.erp.saldoDevedor.F675.valor=250;},
    f=>{f.erp.saldos.F675.ticket='T309';},
    f=>{delete f.erp.saldoDevedor.F675;},
    f=>{f.erp.saldos.F675.origem='outra_operacao';},
    f=>{f.erp.saldos.F675=null;},
  ];
  for(const mutate of scenarios){
    const f=fixture();mutate(f);
    const plan=planSupplierTestCleanup(f);
    assert.equal(plan.readyForControlledCleanup,false,JSON.stringify(plan));
  }
});

test('mudança somente no saldo legado invalida o hash da prévia',async()=>{
  const f=fixture(),db=mockDB(f),plan=planSupplierTestCleanup(f);
  db.state.erp.saldos.F675.valor=201;
  await assert.rejects(()=>executeControlledCleanup(db,{planHash:plan.planHash,
    confirm:'CONFIRMO_EXCLUSAO_SOMENTE_TESTES_F675_SEM_PIX_REAL'}),/Bloqueio de integridade/);
  assert.deepEqual(db.state.erp.saldos.F675,{ticket:'T284',valor:201});
});
