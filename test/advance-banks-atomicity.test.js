import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listAdvanceBankOptions,createAdvance,changeAdvance} from '../server/application/finance-advances.js';

const finance={uid:'erp:thais',erpUser:'thais',erpAccess:true,canFinance:true,canBanking:false};
const banking={uid:'erp:elaine',erpUser:'elaine',erpAccess:true,canFinance:false,canBanking:true};
const input={operationId:'be64924e-0123-4dee-8211-4b90d0950621',fornCod:'F-001',data:'2026-11-03',valor:10003.52,forma:'PIX',bancoCod:'BC-003',empresa:'Manuela Metais',ticket:'',obs:'Teste'};

function fakeDb(){
  const state={erp:{bancos:{id1:{id:'id1',cod:'BC-003',banco:'Conta principal',empresa:'Manuela Metais',saldo:50000,pix:'secret',conta:'12345'}},fornecedores:{f1:{cod:'F-001',nome:'Fornecedor Um'}},adiantamentos:{'F-001':[{'cod':'ADT100',data:'02/11/2026',valor:100,status:'Pendente'}]}}};
  let failure=false,updates=0;
  const get=(path)=>path.split('/').filter(Boolean).reduce((current,key)=>current?.[key],state);
  const assign=(path,value)=>{
    const keys=path.split('/').filter(Boolean),last=keys.pop();
    let parent=state;
    for(const key of keys)parent=parent[key]??={};
    if(value===null)delete parent[last];else parent[last]=structuredClone(value);
  };
  return {
    state,
    get updates(){return updates;},
    failNext(){failure=true;},
    ref(path){return {
      async get(){return {val:()=>structuredClone(get(path)??null)};},
      async update(values){
        if(failure){failure=false;throw new Error('Falha de comunicação com o Firebase.');}
        updates++;
        const copy=structuredClone(state);
        try{for(const [key,value] of Object.entries(values))assign(path+'/'+key,value);}
        catch(error){Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,copy);throw error;}
      },
      async transaction(fn){
        const previous=get(path)??null;
        const next=fn(structuredClone(previous));
        if(next===undefined)return {committed:false,snapshot:{val:()=>previous}};
        assign(path,next);
        return {committed:true,snapshot:{val:()=>next}};
      }
    };}
  };
}

test('Thaís consulta apenas os nomes e códigos dos bancos sem canBanking',async()=>{
  const db=fakeDb();
  assert.deepEqual(await listAdvanceBankOptions(finance,{db}),{banks:[{cod:'BC-003',banco:'Conta principal',empresa:'Manuela Metais'}]});
  assert.equal(finance.canBanking,false);
  await assert.rejects(()=>listAdvanceBankOptions(banking,{db}),{status:403});
});

test('servidor confirma adiantamento e débito no mesmo update atômico',async()=>{
  const db=fakeDb();
  const saved=await createAdvance(finance,input,{db,uuid:()=> 'af16be68-dead-4232-9312-d51e76439328',now:()=>1793740000000});
  assert.equal(db.updates,1);
  assert.equal(saved.advance.valor,10003.52);
  assert.equal(saved.advance.bancoNome,'Conta principal');
  assert.equal(saved.advance.movBancoId,saved.bankMovement.id);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
  assert.equal(db.state.erp.lancBanco[saved.bankMovement.id].valor,10003.52);
  assert.equal(saved.bankMovement.tipo,'Saida');
  const again=await createAdvance(finance,input,{db,uuid:()=> 'b1080066-a020-4e06-b262-58de4ab6e32d',now:()=>1793740000000});
  assert.equal(again.alreadyCommitted,true);
  assert.equal(again.advance.cod,saved.advance.cod);
  assert.equal(db.updates,1);
});

test('falha de escrita não considera nem adiantamento nem débito confirmado',async()=>{
  const db=fakeDb();
  db.failNext();
  await assert.rejects(()=>createAdvance(finance,input,{db}),/Falha de comunicação/);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,1);
  assert.equal(db.state.erp.lancBanco,undefined);
  assert.equal(db.state.erpFinanceAdvanceLocks['F-001'],undefined);
});

test('sem canFinance, sem banco legítimo, sem fornecedor e sem valor válido não grava',async()=>{
  const db=fakeDb();
  await assert.rejects(()=>createAdvance(banking,input,{db}),{status:403});
  await assert.rejects(()=>createAdvance(finance,{...input,bancoCod:'BC-404'},{db}),{status:422});
  await assert.rejects(()=>createAdvance(finance,{...input,fornCod:'FOO'},{db}),{status:422});
  await assert.rejects(()=>createAdvance(finance,{...input,valor:0.001},{db}),{status:422});
  assert.equal(db.updates,0);
});

test('aplicação não amplia regra de bancos nem publica extrato para perfil financeiro',()=>{
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8'));
  assert.match(rules.rules.erp.bancos['.read'],/canBanking/);
  assert.doesNotMatch(rules.rules.erp.bancos['.read'],/canFinance/);
  assert.match(rules.rules.erp.lancBanco['.write'],/canBanking/);
  const frontend=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  assert.match(frontend,/\/api\/finance\/advance-banks/);
  assert.match(frontend,/\/api\/finance\/advances/);
  assert.match(frontend,/__ERP_ADVANCE_BANK_OPTIONS__/);
  assert.match(frontend,/if\(!_ehCheque\)/);
});


test('edição atualiza valor, banco e adiantamento de uma só vez',async()=>{
  const db=fakeDb(),advance=await createAdvance(finance,input,{db});
  const edited=await changeAdvance(finance,{action:'edit',operationId:'b011a291-81a6-45e9-9a74-80cf79cc20c3',
    fornCod:'F-001',adtCod:advance.advance.cod,expected:advance.advance,
    data:'2026-11-04',valor:9000.25,forma:'PIX',status:'Pendente',bancoCod:'BC-003',
    empresa:'Manuela Metais',ticket:'',obs:'Corrigido'},{db});
  assert.equal(db.updates,2);
  assert.equal(edited.advance.valor,9000.25);
  assert.equal(edited.bankMovement.valor,9000.25);
  assert.equal(db.state.erp.lancBanco[edited.bankMovement.id].valor,9000.25);
  assert.equal(db.state.erp.adiantamentos['F-001'][2-1].valor,9000.25);
  const retry=await changeAdvance(finance,{action:'edit',operationId:'b011a291-81a6-45e9-9a74-80cf79cc20c3',
    fornCod:'F-001',adtCod:advance.advance.cod,expected:advance.advance},{db});
  assert.equal(retry.alreadyCommitted,true);
  assert.equal(db.updates,2);
});

test('exclusão atômica remove banco e adiantamento e rejeita snapshots antigos',async()=>{
  const db=fakeDb(),created=await createAdvance(finance,input,{db});
  const stale={...created.advance,valor:5};
  await assert.rejects(()=>changeAdvance(finance,{action:'delete',operationId:'a070d7e6-3931-4d1c-a6a7-69d9f8c78402',
    fornCod:'F-001',adtCod:created.advance.cod,expected:stale},{db}),{status:409});
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
  const result=await changeAdvance(finance,{action:'delete',operationId:'2d5c758f-a619-494e-96bd-d803546c6c6a',
    fornCod:'F-001',adtCod:created.advance.cod,expected:created.advance},{db});
  assert.equal(result.removedCode,created.advance.cod);
  assert.equal(db.updates,2);
  assert.equal(db.state.erp.adiantamentos['F-001'].length,1);
  assert.equal(db.state.erp.lancBanco[created.bankMovement.id],undefined);
});

test('uma operação não remove débito alterado por outra sessão',async()=>{
  const db=fakeDb(),created=await createAdvance(finance,input,{db});
  db.state.erp.lancBanco[created.bankMovement.id].valor=10;
  await assert.rejects(()=>changeAdvance(finance,{action:'delete',operationId:'7688369d-cd24-44c2-9c51-487d8c1451f1',
    fornCod:'F-001',adtCod:created.advance.cod,expected:created.advance},{db}),{code:'BANK_LEDGER_CHANGED'});
  assert.equal(db.state.erp.adiantamentos['F-001'].length,2);
});

test('datas impossíveis são rejeitadas sem erro interno',async()=>{
  const db=fakeDb();
  for(const data of ['2026-02-30','9999-99-99','0000-00-00']){
    await assert.rejects(()=>createAdvance(finance,{...input,data},{db}),{status:422,code:'INVALID_DATE'});
  }
  assert.equal(db.updates,0);
});

test('transferência de fornecedor atualiza as duas fichas e o movimento em um lote',async()=>{
  const db=fakeDb();
  db.state.erp.fornecedores.f2={cod:'F-002',nome:'Fornecedor Dois'};
  const created=await createAdvance(finance,input,{db});
  const changed=await changeAdvance(finance,{action:'edit',operationId:'864594b3-5971-4f6b-818d-1120f6b17325',
    fornCod:'F-001',newFornCod:'F-002',adtCod:created.advance.cod,expected:created.advance,
    data:'2026-11-05',valor:400,forma:'PIX',status:'Pendente',bancoCod:'BC-003',
    empresa:'Manuela Metais',ticket:'',obs:'Transferido'},{db});
  assert.equal(db.updates,2);
  assert.equal(db.state.erp.adiantamentos['F-001'].some(a=>a.cod===created.advance.cod),false);
  assert.equal(db.state.erp.adiantamentos['F-002'][0].valor,400);
  assert.match(db.state.erp.lancBanco[created.bankMovement.id].descricao,/Fornecedor Dois/);
  assert.equal(changed.newFornCod,'F-002');
  const receipt=Object.values(db.state.erp.financeAdvanceOperations).find(v=>v.action==='edit');
  assert.equal(Object.hasOwn(receipt.result,'entries'),false);
});

test('edição de adiantamento aguarda banco e preserva seleção após consulta',()=>{
  const frontend=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  assert.match(frontend,/eaBancoEl\.dataset\.pendingBankCode=selected/);
  assert.match(frontend,/el\.dataset\.pendingBankCode/);
  assert.match(frontend,/__ERP_ADVANCE_BANK_OPTIONS_UID__/);
});
