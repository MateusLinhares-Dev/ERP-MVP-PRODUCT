import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,getAdvanceOperationStatus} from '../server/application/finance-advances.js';

const operationId1='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const operationId2='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const actor={uid:'user1',erpUser:'elaine',erpAccess:true,canAdvances:true};
const base={operationId:operationId1,fornCod:'F-001',data:'2026-11-05',valor:1,forma:'PIX',bancoCod:'BC-003',empresa:'Gratus Metais',ticket:'',obs:'Teste'};

function memoryDb(){
  const state={erp:{bancos:{b1:{cod:'BC-003',banco:'Conta de teste'}},fornecedores:{f1:{cod:'F-001',nome:'Teste Não Apagar'}},adiantamentos:{'F-001':[]}}};
  const valueOf=path=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],state);
  const assign=(path,value)=>{const parts=path.split('/').filter(Boolean),key=parts.pop();let target=state;for(const part of parts)target=target[part]??={};if(value===null)delete target[key];else target[key]=structuredClone(value);};
  let failReleaseOnce=false;
  const db={state,
    failOneRelease(){failReleaseOnce=true;},
    ref(path){return {
      async get(){return {val:()=>structuredClone(valueOf(path)??null)};},
      async update(batch){for(const [key,value] of Object.entries(batch))assign(path+'/'+key,value);},
      async transaction(transform){
        const old=structuredClone(valueOf(path)??null);
        const next=transform(old);
        if(next===undefined)return {committed:false,snapshot:{val:()=>old}};
        if(failReleaseOnce&&path.startsWith('erpFinanceAdvanceLocks/')&&next===null){failReleaseOnce=false;throw new Error('Temporary release failure');}
        assign(path,next);
        return {committed:true,snapshot:{val:()=>structuredClone(next)}};
      }
    };}
  };
  return db;
}

test('duas operações sucessivas do mesmo fornecedor geram dois recibos e dois débitos, sem bloqueio entre elas',async()=>{
  const db=memoryDb();
  const first=await createAdvance(actor,base,{db,now:()=>100000});
  const second=await createAdvance(actor,{...base,operationId:operationId2,valor:2},{db,now:()=>100100});
  assert.notEqual(first.advance.cod,second.advance.cod);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,2);
  assert.equal(db.state.erpFinanceAdvanceLocks?.['F-001'],undefined);
});

test('trava abandonada de operação COM recibo confirmado é recuperada sem esperar dois minutos',async()=>{
  const db=memoryDb(),now=()=>100000;
  const previous=await createAdvance(actor,base,{db,now});
  const key='user1_'+operationId1;
  const fingerprint=db.state.erp.financeAdvanceOperations[key].requestFingerprint;
  db.state.erpFinanceAdvanceLocks={'F-001':{
    owner:'invocacao-encerrada',operationKey:key,kind:'create',fornCod:'F-001',requestFingerprint:fingerprint,
    startedAt:90000,expiresAt:220000
  }};
  const next=await createAdvance(actor,{...base,operationId:operationId2,valor:2},{db,now});
  assert.equal(next.advance.valor,2);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,2);
  assert.equal(db.state.erpFinanceAdvanceLocks['F-001'],undefined);
  const previousStatus=await getAdvanceOperationStatus(actor,{operationId:operationId1,fornCod:'F-001'},{db,now});
  assert.equal(previousStatus.state,'confirmed');
  assert.equal(previousStatus.advance.cod,previous.advance.cod);
});

// Executa apenas a máquina de trava para testar recusas legítimas sem 5 s de espera real.
const source=readFileSync(new URL('../server/application/finance-advances.js',import.meta.url),'utf8');
const lockSource=source.slice(source.indexOf('async function acquireAdvanceLock('),source.indexOf('export async function createAdvance('));
function lockAcquirer(){const ctx={setTimeout};runInNewContext(lockSource+';this.take=acquireAdvanceLock;',ctx);return ctx.take;}

test('trava ativa SEM recibo confirmado não é tomada nem se identificador estiver presente',async()=>{
  const db=memoryDb(),now=()=>100000;
  const original={owner:'processo-ainda-executando',operationKey:'user1_'+operationId1,kind:'create',fornCod:'F-001',requestFingerprint:'fingerprint',expiresAt:220000};
  db.state.erpFinanceAdvanceLocks={'F-001':structuredClone(original)};
  const acquired=await lockAcquirer()(db.ref('erpFinanceAdvanceLocks/F-001'),'nova-requisicao',now,{db,operationKey:'user1_'+operationId2,fornCod:'F-001',kind:'create',requestFingerprint:'new',sleep:async()=>{}});
  assert.equal(acquired,false);
  assert.deepEqual(db.state.erpFinanceAdvanceLocks['F-001'],original);
});

test('recibo com fingerprint divergente não autoriza reaproveitar trava',async()=>{
  const db=memoryDb(),now=()=>100000;
  await createAdvance(actor,base,{db,now});
  const old={owner:'processo',operationKey:'user1_'+operationId1,kind:'create',fornCod:'F-001',requestFingerprint:'ALTERADO',expiresAt:220000};
  db.state.erpFinanceAdvanceLocks={'F-001':structuredClone(old)};
  const acquired=await lockAcquirer()(db.ref('erpFinanceAdvanceLocks/F-001'),'nova-requisicao',now,{db,operationKey:'user1_'+operationId2,fornCod:'F-001',kind:'create',requestFingerprint:'new',sleep:async()=>{}});
  assert.equal(acquired,false);
  assert.deepEqual(db.state.erpFinanceAdvanceLocks['F-001'],old);
});

test('falha transitória ao liberar a trava é recuperada, sem bloquear o próximo adiantamento',async()=>{
  const db=memoryDb();
  db.failOneRelease();
  await createAdvance(actor,base,{db,now:()=>100000});
  assert.equal(db.state.erpFinanceAdvanceLocks?.['F-001'],undefined);
  await createAdvance(actor,{...base,operationId:operationId2,valor:2},{db,now:()=>100100});
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
  assert.equal(Object.keys(db.state.erp.lancBanco).length,2);
});
