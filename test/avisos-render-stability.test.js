import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../public/legacy/app-avisos.js',import.meta.url),'utf8');

function createEnvironment(){
  let bodyWrites=0,badgeWrites=0;
  const box={_html:'',get innerHTML(){return this._html;},set innerHTML(html){this._html=html;bodyWrites++;},querySelector(sel){return sel==='[data-erp-avisos-main]'&&this._html.includes('data-erp-avisos-main')?{}:null;}};
  const badge={dataset:{},_html:'',get innerHTML(){return this._html;},set innerHTML(html){this._html=html;badgeWrites++;}};
  const employees=[{nome:'Funcionario Exemplo',status:'Ativo',nascimento:'1991-12-10',valeTransporte:150}];
  const doc={getElementById(id){return id==='tab-avisos'?box:null;},querySelector(selector){return selector==='.nav-tab[data-tab="avisos"] .nt-label'?badge:null;}};
  const w={erpCanAccessTab(){return true;}};
  const context={window:w,document:doc,FUNCIONARIOS:employees,AFAZERES_DB:[],esc:v=>String(v),setTimeout,console,Date};
  vm.runInNewContext(source,context,{filename:'app-avisos.js'});
  return {w,employees,box,badge,writes:()=>({bodyWrites,badgeWrites})};
}

test('render de Avisos nao substitui a tela repetidamente quando dados sao identicos',()=>{
  const {w,box,employees,writes}=createEnvironment();
  for(let i=0;i<30;i++)w.renderAvisos();
  assert.equal(writes().bodyWrites,1);
  assert.ok(box.innerHTML.includes('Funcionario Exemplo'));
  employees[0].nome='Nome atualizado';
  w.renderAvisos();
  assert.equal(writes().bodyWrites,2);
  assert.ok(box.innerHTML.includes('Nome atualizado'));
});

test('badge de Avisos nao reescreve o HTML e interrompe ciclos MutationObserver',()=>{
  const {w,writes}=createEnvironment();
  for(let i=0;i<20;i++)w.avisosAtualizarBadge();
  assert.equal(writes().badgeWrites,1);
});

test('camadas de agenda usam atualizacao idempotente, sem remover cartoes antigos',()=>{
  const phase1=readFileSync(new URL('../public/modules/phase1/phase1-alerts.js',import.meta.url),'utf8');
  const phase3=readFileSync(new URL('../public/modules/phase3/phase3-homologation.js',import.meta.url),'utf8');
  assert.match(phase1,/if\(card\.innerHTML!==html\)card\.innerHTML=html/);
  assert.match(phase3,/if\(card\.innerHTML!==html\)card\.innerHTML=html/);
  assert.doesNotMatch(phase3,/\$\('#phase3-calendar-alerts'\)\?\.remove\(\)/);
});
