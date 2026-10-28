import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const guard = fs.readFileSync(new URL('../public/legacy/module-access-guard.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const ops = fs.readFileSync(new URL('../public/modules/final-ops/final-ops.js', import.meta.url), 'utf8');
const fiscal = fs.readFileSync(new URL('../public/modules/phase1/phase1-fiscal-admin.js', import.meta.url), 'utf8');

function access(login, admin, tabs = []) {
  let opened = null;
  const sandbox = {
    cuKey: login, cu: {admin, tabs}, window: {}, console: {warn() {}},
    showToast() {}, switchTab(id) {opened=id;},
    document: {getElementById(id) {return {id};}}
  };
  vm.runInNewContext(guard, sandbox);
  return {can: sandbox.window.erpCanAccessTab, open: sandbox.window.switchTab, current: () => opened};
}

test('Elaine administra a Matriz mesmo com perfil antigo sem a aba nas tabs', () => {
  const owner = access('elaine', true, ['usuarios']);
  assert.equal(owner.can('matriz_capacitacao'), true);
  assert.equal(owner.open('matriz_capacitacao'), true);
  assert.equal(owner.current(), 'matriz_capacitacao');
});

test('Matriz bloqueada para contas comuns e outros administradores', () => {
  for (const [login, admin] of [['testeqa', false], ['outroadm', true], ['elaine', false]]) {
    const user = access(login, admin, ['matriz_capacitacao']);
    assert.equal(user.can('matriz_capacitacao'), false);
    assert.equal(user.open('matriz_capacitacao'), false);
    assert.equal(user.current(), null);
  }
});

test('Help disponível aos usuários autenticados sem permissão extra', () => {
  const user = access('testeqa', false, ['dashboard']);
  assert.equal(user.can('help_center'), true);
  assert.equal(user.open('help_center'), true);
  assert.equal(user.current(), 'help_center');
});

test('Catálogo inclui Help e Matriz no módulo de gestão de usuários', () => {
  assert.match(core, /matriz_capacitacao:\s*\{label:'Matriz'/);
  assert.match(core, /help_center:\s*\{label:'Central de ajuda'/);
  assert.match(core, /t!=='matriz_capacitacao'\|\|\(un==='elaine'/);
  assert.match(ops, /addNav\('Administração','Matriz','matriz_capacitacao'/);
});

test('Filtro de combustível repopula os motoristas ao receber dados depois da abertura', () => {
  const source=ops.slice(ops.indexOf('function ensureReports('),ops.indexOf('\nfunction printFuel('));
  const listeners={};
  let fuel=[];
  const select={options:[],value:'',add(o){this.options.push(o);},replaceChildren(...args){this.options=[...args];this.value=args[0]?.value||'';},addEventListener(type,cb){listeners[type]=cb;}};
  const input={value:'2026-10'};
  const button={};
  const box={id:'',innerHTML:'',select,input,button};
  const host={prepend() {this.box=box;}};
  const dom={createElement(){return box;},addEventListener(){}};
  const lookup=(selector,root)=>root===box?({select,input,button}[selector]):selector==='#tab-combustivel_rudnick'?host:null;
  const sandbox={
    $:lookup,document:dom,Option:function Option(label,value){this.label=label;this.value=value;},
    nowMonth:()=> '2026-10',esc:x=>x,fuelEntries:()=>fuel,tripEntries:()=>[],queueMicrotask:fn=>fn(),
  };
  vm.runInNewContext(source+'\nensureReports("tab-combustivel_rudnick","ops-fuel-print","Imprimir",(m,n)=>globalThis.report=[m,n]);',sandbox);
  assert.equal(select.options.length,1);
  fuel=[{motorista:'TESTE 2'},{motorista:'TESTE 3'}];
  listeners.focus();
  assert.deepEqual(select.options.map(x=>x.label),['Todos os motoristas','TESTE 2','TESTE 3']);
  select.value='TESTE 3';
  button.onclick();
  assert.deepEqual(Array.from(sandbox.report),['2026-10','TESTE 3']);
});

test('Fiscal recarrega cadastros em nuvem ao abrir a aba sem depender de F5', async () => {
  assert.match(fiscal,/if\(currentArea==='cadastros'\)global\.phase1FiscalPartiesReload\?\.\(\)/);
  const start=fiscal.indexOf('let fiscalPartyLoadId=0;');
  const end=fiscal.indexOf('function ensureFiscalParties()',start);
  let remote={A:{id:'A',name:'Cliente teste',type:'Cliente Fiscal',active:true}};
  let rendered=[];
  const sandbox={global:{_fbDB:{ref(path){assert.equal(path,'erp/fiscalParties');return {once:async()=>({val:()=>remote})};}}},
    store:{load:async()=>({})},renderFiscalParties(){rendered.push(true);},console:{warn() {}},document:{getElementById(){return null;}}};
  vm.runInNewContext(fiscal.slice(start,end),sandbox);
  await sandbox.global.phase1FiscalPartiesReload();
  assert.equal(vm.runInNewContext('fiscalParties.A.name',sandbox),'Cliente teste');
  remote={...remote,B:{id:'B',name:'Fornecedor novo',type:'Fornecedor Fiscal',active:true}};
  await sandbox.global.phase1FiscalPartiesReload();
  assert.equal(vm.runInNewContext('Object.keys(fiscalParties).length',sandbox),2);
  assert.equal(rendered.length,2);
});

test('Ano de custos fiscais usa lista de anos',()=>{
  assert.match(fiscal,/<select id=\\?"fis-v3-cost-year\\?">/);
  assert.doesNotMatch(fiscal,/id="fis-v3-cost-year" type="number"/);
});
