import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sync = fs.readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../public/legacy/module-access-guard.js', import.meta.url), 'utf8');
const begin = sync.indexOf('function _fbAtualizarAbaAtivaSilenciosamente(){');
const end = sync.indexOf('\n  let _fbListenerAtivo = false;', begin);
assert.ok(begin >= 0 && end > begin, 'Função de refresh silencioso não encontrada');
const helper = sync.slice(begin, end);

function runRefresh({tab='contas_dona', allowed=true}={}) {
  const calls=[],toasts=[],events=[];
  const scope={
    window:{erpCanAccessTab:()=>allowed},
    document:{querySelector:()=>tab?{id:'tab-'+tab}:null,dispatchEvent:event=>events.push(event.type)},
    CustomEvent:class CustomEvent{constructor(type){this.type=type}},
    switchTab:id=>calls.push(id),
    showToast:msg=>toasts.push(msg),
    console:{warn:()=>{}}
  };
  vm.runInNewContext(helper,scope);
  const result=vm.runInNewContext('_fbAtualizarAbaAtivaSilenciosamente()',scope);
  return {result,calls,toasts,events};
}

test('atualização de outra sessão redesenha uma aba autorizada sem toast',()=>{
  const out=runRefresh({tab:'contas_dona',allowed:true});
  assert.equal(out.result,true);
  assert.deepEqual(out.calls,[]);
  assert.deepEqual(out.events,['erp:remote-data-merged']);
  assert.deepEqual(out.toasts,[]);
});

test('atualização automática não tenta abrir um módulo sem permissão',()=>{
  const out=runRefresh({tab:'contas_dona',allowed:false});
  assert.equal(out.result,false);
  assert.deepEqual(out.calls,[]);
  assert.deepEqual(out.toasts,[]);
});

test('atualização automática ignora ausência de aba ativa',()=>{
  const out=runRefresh({tab:'',allowed:true});
  assert.equal(out.result,false);
  assert.deepEqual(out.calls,[]);
});

test('sincronização em tempo real e atualização adiada usam apenas refresh protegido',()=>{
  assert.match(sync,/ref\('erp\/_ts'\)\.on\('value'/);
  assert.match(sync,/function _fbAgendarSyncCompletoDeferido\(/);
  assert.equal((sync.match(/_fbAtualizarAbaAtivaSilenciosamente\(\);/g)||[]).length,2);
  assert.doesNotMatch(sync,/Dados atualizados por outro usuário/);
  assert.doesNotMatch(sync,/Dados da nuvem chegaram — telas atualizadas/);
});

test('acesso negado por ação explícita continua exibindo erro',()=>{
  const toasts=[];
  const scope={
    cu:{admin:false,tabs:['dashboard']}, cuKey:'funcionario',
    window:{}, console:{warn(){}},
    document:{getElementById(){return {}}},
    switchTab(){throw Error('Não deve navegar')},
    showToast:(msg,tipo)=>toasts.push([msg,tipo])
  };
  vm.runInNewContext(access,scope);
  const result=scope.window.switchTab('contas_dona');
  assert.equal(result,false);
  assert.deepEqual(toasts,[['Você não tem acesso a este módulo.','error']]);
});
