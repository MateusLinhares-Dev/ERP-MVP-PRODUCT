import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,changeAdvance} from '../server/modules/advances/application/advances.js';

const who={uid:'operador',erpUser:'Operador',erpAccess:true,canAdvances:true};
const value={operationId:'a0d00000-1111-4111-8111-111111111111',fornCod:'F1',data:'2026-11-06',valor:12,forma:'PIX',bancoCod:'B1',empresa:'Empresa',ticket:'',obs:''};
function fakeDb(){
  const state={erp:{bancos:{one:{cod:'B1',banco:'Conta de teste'}},fornecedores:{one:{cod:'F1',nome:'Fornecedor Um'},two:{cod:'F2',nome:'Fornecedor Dois'}},adiantamentos:{F1:[],F2:[]}}};
  const touched=[];
  const get=p=>p.split('/').filter(Boolean).reduce((v,k)=>v?.[k],state);
  const assign=(path,value)=>{
    const parts=path.split('/').filter(Boolean),last=parts.pop();let parent=state;
    for(const key of parts)parent=parent[key]??={};
    if(value===null)delete parent[last];else parent[last]=structuredClone(value);
  };
  return {state,touched,ref(path){return {
    async get(){touched.push(['get',path]);return {val:()=>structuredClone(get(path)??null)};},
    async transaction(fn){touched.push(['transaction',path]); const old=structuredClone(get(path)??null),next=fn(old); if(next===undefined)return {committed:false,snapshot:{val:()=>old}};assign(path,next);return {committed:true,snapshot:{val:()=>structuredClone(next)}};},
    async update(entries){touched.push(['update',path]);for(const [key,v] of Object.entries(entries))assign(path+'/'+key,v);}
  };}};
}

test('excluir um PIX não depende da trava global de cheques ativa para outro fornecedor',async()=>{
  const db=fakeDb(),created=await createAdvance(who,value,{db});
  db.state.erpFinanceAdvanceLocks={__global_cheques__:{owner:'outro-fornecedor',kind:'create',operationKey:'outro_abc',fornCod:'F2',expiresAt:99999999999999}};
  db.touched.length=0;
  const result=await changeAdvance(who,{action:'delete',operationId:'a0d00000-2222-4222-8222-222222222222',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance},{db});
  assert.equal(result.action,'delete');
  assert.equal(db.state.erp.adiantamentos.F1.length,0);
  assert.equal(db.state.erp.lancBanco[created.bankMovement.id],undefined);
  assert.equal(db.state.erpFinanceAdvanceLocks.__global_cheques__.owner,'outro-fornecedor');
  assert.equal(db.touched.some(([,p])=>p==='erpFinanceAdvanceLocks/__global_cheques__'),false);
});

test('editar PIX também não reserva a trava de cheques e preserva a atualização atômica no banco',async()=>{
  const db=fakeDb(),created=await createAdvance(who,value,{db});
  db.state.erpFinanceAdvanceLocks={__global_cheques__:{owner:'outro',kind:'create',expiresAt:99999999999999}};
  db.touched.length=0;
  const result=await changeAdvance(who,{action:'edit',operationId:'a0d00000-3333-4333-8333-333333333333',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance,
    data:'2026-11-06',valor:15,forma:'PIX',status:'Pendente',bancoCod:'B1',empresa:'Empresa',ticket:'',obs:'editado'},{db});
  assert.equal(result.advance.valor,15);
  assert.equal(db.state.erp.lancBanco[created.bankMovement.id].valor,15);
  assert.equal(db.touched.some(([,p])=>p==='erpFinanceAdvanceLocks/__global_cheques__'),false);
});

test('edição PIX não pode virar cheque sem lançar os cheques correspondentes',async()=>{
  const db=fakeDb(),created=await createAdvance(who,value,{db});
  await assert.rejects(()=>changeAdvance(who,{action:'edit',operationId:'a0d00000-4444-4444-8444-444444444444',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance,
    data:'2026-11-06',valor:15,forma:'Cheque',status:'Pendente',empresa:'Empresa',ticket:'',obs:'editado'},{db}),{code:'CHEQUE_EDIT_RESTRICTED'});
  assert.equal(db.state.erp.lancBanco[created.bankMovement.id].valor,12);
  assert.equal(db.state.erp.adiantamentos.F1[0].forma,'PIX');
});

test('quando uma nova linha de cheque é inserida, herda o banco escolhido na última linha',()=>{
  const code=readFileSync(new URL('../public/modules/finance/advance-actions.js',import.meta.url),'utf8');
  const rows=[{value:'terceiro'}],calls=[];
  const ctx={document:{querySelectorAll:()=>rows},_adtChqAddRow:(bank,...rest)=>{calls.push({bank,rest});return bank;},console};
  ctx.window=ctx;
  runInNewContext(code,ctx);
  assert.equal(ctx._adtChqAddRow(),'terceiro');
  assert.equal(ctx._adtChqAddRow('acred gratus',123,456),'acred gratus');
  rows[0].value='Banco Diferente';
  assert.equal(ctx._adtChqAddRow(),'Banco Diferente');
  assert.deepEqual(calls.map(c=>c.bank),['terceiro','acred gratus','Banco Diferente']);
  assert.deepEqual(Array.from(calls[1].rest),[123,456]);
});

test('adiantamento com cheques mantém proteção da trava global na exclusão',async()=>{
  const db=fakeDb();
  const created=await createAdvance(who,{...value,forma:'Cheque',bancoCod:'',valor:75,
    cheques:[{b:'terceiro',n:'4321',v:75,d:'2026-11-06',cli:'Cliente Um'}]}, {db});
  db.touched.length=0;
  const deleted=await changeAdvance(who,{action:'delete',operationId:'a0d00000-5555-4555-8555-555555555555',fornCod:'F1',adtCod:created.advance.cod,expected:created.advance},{db});
  assert.equal(deleted.removedCode,created.advance.cod);
  assert.equal(db.touched.some(([method,path])=>method==='transaction'&&path==='erpFinanceAdvanceLocks/__global_cheques__'),true);
  assert.equal(db.state.erp.chequesControle?.[created.cheques[0].id],undefined);
});
