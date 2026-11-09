import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const avisos=read('public/legacy/app-avisos.js');
const core=read('public/legacy/app-core.js');
const matrix=read('public/modules/final-ops/final-ops.js');
const backend=read('api/training/matrix.js');

function birthdayHarness(day=3){
  const source=avisos.slice(avisos.indexOf('  function _isLegacyBirthdayTask('),avisos.indexOf('  function _fimExperiencia()'));
  const staff=[
    {mat:'F007',nome:'EVELIN NATALIA HENRIQUE',nascimento:'1998-11-02'},
    {mat:'F008',nome:'MARIANA',nascimento:'2000-11-03'},
    {mat:'F009',nome:'RODRIGO',nascimento:'1990-11-12'}
  ];
  const tasks=[];let saves=0;
  const context={window:{__FB_DATA_READY__:true},AFAZERES_DB:tasks,
    _canRH:()=>true,_canAfazeres:()=>true,_fA:()=>staff,
    _parseNasc:s=>{const [y,m,d]=s.split('-').map(Number);return {y,m,d};},
    _hojeD:()=>({y:2026,m:11,d:day}),saveAfazeres:()=>{saves++;},
    console};
  vm.runInNewContext(source+'\nthis.ensureBirthdayAgenda=_ensureBirthdayAgenda;this.getBirthdays=_aniversariantes;this.isLegacyBirthday=_isLegacyBirthdayTask;',context);
  return {context,staff,tasks,getSaves:()=>saves};
}

test('aniversário de ontem desaparece automaticamente, sem exigir baixa',()=>{
  const h=birthdayHarness(3);
  h.context.ensureBirthdayAgenda();h.context.ensureBirthdayAgenda();
  assert.equal(h.tasks.length,0);
  assert.equal(h.getSaves(),0);
  const list=h.context.getBirthdays();
  assert.equal(list.mes.some(x=>x.nome==='EVELIN NATALIA HENRIQUE'),false);
  assert.equal(list.hoje.length,1);
  assert.equal(list.hoje[0].nome,'MARIANA');
  assert.equal(list.mes.length,2);
});

test('aniversário é exibido no dia certo e desaparece no seguinte; tarefas antigas são reconhecidas',()=>{
  const yesterday=birthdayHarness(2),today=birthdayHarness(3);
  assert.equal(yesterday.context.getBirthdays().hoje[0].nome,'EVELIN NATALIA HENRIQUE');
  assert.equal(today.context.getBirthdays().hoje.some(x=>x.nome==='EVELIN NATALIA HENRIQUE'),false);
  assert.equal(today.context.isLegacyBirthday({id:'AFBIRTH_2026_F007'}),true);
  assert.equal(today.context.isLegacyBirthday({tipo:'aniversario'}),true);
  assert.equal(today.context.isLegacyBirthday({id:'AF123',tipo:'servico'}),false);
  assert.match(core,/function _afBirthdayOld\(a\)/);
  assert.match(core,/afVisiveis=AFAZERES_DB.filter\(a=>a&&!_afBirthdayOld\(a\)\)/);
});

async function stockHarness({claims={erpAccess:true,canInventory:true},entries=0,fail=false}={}){
  const source=core.slice(core.indexOf('async function excluirMaterial(mat){'),core.indexOf('\nfunction editEstoque(mat){'));
  const calls=[],stock={ALUMINIO:{mat:'ALUMINIO',inicial:0,saidas:0}},names=['ALUMINIO'];
  const db={ref:path=>({
    transaction:async callback=>{calls.push('transaction:'+path);if(fail)throw Error('PERMISSION_DENIED');return {committed:true,snapshot:{val:()=>callback([])}};},
    remove:async()=>{calls.push('remove:'+path);}
  })};
  const context={window:{_fbDB:db,__fbRaw:{auth:{currentUser:{getIdTokenResult:async()=>({claims})}}}},
    ESTOQUE_DB:stock,METAIS:names,showToast:()=>{},console,confirm:()=>true,
    _normalizarTombstoneEstoque:s=>s.toUpperCase(),
    getEntradasMaterial:()=>entries,getSaidasMaterial:()=>0,
    _apagarChave:(name,store,key)=>{delete store[key];calls.push('local-deleted');},
    saveEstoque:()=>calls.push('save'),registrarHistorico:()=>{},renderEstoque:()=>{}};
  vm.runInNewContext(source+'\nthis.deleteStock=excluirMaterial;',context);
  return {context,calls,stock,names};
}

test('estoque exige claim canInventory, inclusive para usuário com o módulo visível',async()=>{
  const h=await stockHarness({claims:{erpAccess:true,canInventory:false}});
  await h.context.deleteStock('ALUMINIO');
  assert.equal(h.names.length,1);assert.deepEqual(h.calls,[]);
});

test('estoque não apaga materiais utilizados em compras e vendas',async()=>{
  const h=await stockHarness({entries:25});await h.context.deleteStock('ALUMINIO');
  assert.equal(h.names.length,1);assert.deepEqual(h.calls,[]);
});

test('estoque só altera a lista local após confirmar Firebase',async()=>{
  const h=await stockHarness();await h.context.deleteStock('ALUMINIO');
  assert.deepEqual(h.calls,['transaction:erp/estoqueDeleted','remove:erp/estoque/ALUMINIO','local-deleted','save']);
  assert.equal(h.names.length,0);
});

test('erro Firebase não exclui material local',async()=>{
  const h=await stockHarness({fail:true});await h.context.deleteStock('ALUMINIO');
  assert.equal(h.names.length,1);assert.ok(h.stock.ALUMINIO);
  assert.ok(!h.calls.includes('local-deleted'));
});

test('matriz apresenta pesquisa, edição de curso e exclusão de vínculo auditada',()=>{
  assert.match(matrix,/ERPEnhanceSearchableSelect\?\.\(select/);
  assert.match(matrix,/data-edit-course/);
  assert.match(matrix,/data-remove-enroll/);
  assert.match(matrix,/e\.notes\?/);
  assert.match(backend,/action==='removeEnrollment'/);
  assert.match(backend,/\['enrollments\/'\+key\]:null/);
  assert.match(backend,/await commit\(\{/);
  assert.match(backend,/root\.child\('enrollmentLocks\/'\+pairKey\)/);
  assert.match(backend,/Esse funcionário já possui vínculo ativo/);
  assert.match(backend,/Esse vínculo possui certificado/);
});

async function trainingApiHarness(){
  const domain=await import('../server/modules/training/domain/training.js');
  const {runTransaction}=await import('../server/shared/firebase/rtdb-transaction.js');
  const {randomUUID}=await import('node:crypto');
  const state={erpTraining:{courses:{COURSE001:{id:'COURSE001',title:'Operador de empilhadeira',active:true,renewalMonths:12,noticeDays:30}},enrollments:{},documents:{},audit:{}},erp:{funcEdit:[{mat:'F007',nome:'JOS CEMAR',status:'Ativo'}]},erpAuth:{users:{elaine:{login:'elaine',name:'Elaine'}}}};
  let sequence=0;
  const getPath=path=>path.split('/').filter(Boolean).reduce((obj,key)=>obj?.[key],state);
  const setPath=(path,value)=>{const parts=path.split('/').filter(Boolean);let root=state;
    for(let i=0;i<parts.length-1;i++)root=root[parts[i]]??=(/^\d+$/.test(parts[i+1])?[]:{});
    if(value===null)delete root[parts.at(-1)];else root[parts.at(-1)]=value;
  };
  const snapshots=path=>({val:()=>getPath(path),exists:()=>getPath(path)!=null});
  const ref=path=>({
    get:async()=>snapshots(path),
    child:sub=>ref(path+'/'+sub),
    push:()=>({key:'AU'+String(++sequence).padStart(6,'0')}),
    update:async changes=>{for(const [key,value] of Object.entries(changes))setPath(path+'/'+key,value);},
    transaction:async(fn)=>{const current=getPath(path)??null;const next=fn(current);
      if(next===undefined)return {committed:false,snapshot:snapshots(path)};
      setPath(path,next);return {committed:true,snapshot:snapshots(path)};}
  });
  const context={
    console,crypto:{randomUUID},runTransaction,
    getFirebaseAdmin:()=>({db:{ref},storage:{bucket:()=>({})}}),
    loginFromStorageKey:x=>x,
    requireIdentity:async()=>({admin:true,erpUser:'elaine',uid:'TEST_USER'}),
    applyApiSecurityHeaders:()=>{},assertSameOrigin:()=>{},assertJsonBody:()=>{},
    sendError:(res,e)=>res.status(e.status||500).json({message:e.message,code:e.code}),
    ...domain
  };
  const script=backend.replace(/^import .+;\n/gm,'').replace('export default async function handler','async function handler');
  vm.runInNewContext(script+'\nthis.handler=handler;',context);
  const post=async(body)=>{let status=200;const res={status(n){status=n;return this;},json(data){return {status,data};}};
    return context.handler({method:'POST',body,query:{}},res);
  };
  return {state,post};
}

test('API persiste observações e permite corrigir o vínculo existente sem duplicar',async()=>{
  const {state,post}=await trainingApiHarness();
  const b={action:'enroll',employeeId:'F007',courseId:'COURSE001',status:'concluido',completedAt:'2026-11-02',notes:'Treinamento acompanhado pela Thaís',notifyEnabled:false};
  const first=await post(b);
  assert.equal(first.status,200,JSON.stringify(first));
  const key=first.data.id;
  assert.equal(state.erpTraining.enrollments[key].notes,'Treinamento acompanhado pela Thaís');
  const duplicate=await post(b);assert.equal(duplicate.status,409);
  const edit=await post({...b,id:key,notes:'Observação atualizada'});
  assert.equal(edit.status,200,JSON.stringify(edit));
  assert.equal(state.erpTraining.enrollments[key].notes,'Observação atualizada');
  assert.equal(Object.keys(state.erpTraining.enrollments).length,1);
});

test('API exclui vínculo duplicado sem certificado e mantém auditoria; protege o que possui documento',async()=>{
  const {state,post}=await trainingApiHarness();
  const added=await post({action:'enroll',employeeId:'F007',courseId:'COURSE001',status:'planejado'});
  const id=added.data.id;
  state.erpTraining.documents.DOCUMENT1={id:'DOCUMENT1',enrollmentId:id};
  const blocked=await post({action:'removeEnrollment',id});
  assert.equal(blocked.status,409);assert.ok(state.erpTraining.enrollments[id]);
  delete state.erpTraining.documents.DOCUMENT1;
  const removed=await post({action:'removeEnrollment',id});
  assert.equal(removed.status,200);assert.equal(state.erpTraining.enrollments[id],undefined);
  assert.ok(Object.values(state.erpTraining.audit).some(x=>x.action==='removeEnrollment'&&x.recordId===id));
});

test('API permite editar curso inativo sem ativá-lo; reativação usa ação explícita',async()=>{
  const {state,post}=await trainingApiHarness();
  const inactive=await post({action:'archive',kind:'courses',id:'COURSE001'});
  assert.equal(inactive.status,200);
  const edited=await post({action:'course',id:'COURSE001',title:'Curso de Empilhadeira',category:'Operação',description:'Nova observação',renewalMonths:12,noticeDays:20});
  assert.equal(edited.status,200);
  assert.equal(state.erpTraining.courses.COURSE001.active,false);
  assert.equal(state.erpTraining.courses.COURSE001.description,'Nova observação');
  const restored=await post({action:'activate',id:'COURSE001'});
  assert.equal(restored.status,200);
  assert.equal(state.erpTraining.courses.COURSE001.active,true);
});
