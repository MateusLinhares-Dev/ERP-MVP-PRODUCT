import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const guard=read('public/legacy/module-access-guard.js');
const ownerSource=read('public/modules/phase3/phase3-homologation.js');
const ownerChunk=ownerSource.split('/* Contas pessoais da Dona — separadas por imóvel, sem alterar pagamentos anteriores */')[1]?.split('/* Adiantamentos: ticket selecionável')[0];
assert.ok(ownerChunk);

function guardCase(profile){
 const opened=[],toasts=[];
 const scope={cu:profile,cuKey:'elaine',window:{},console:{warn(){}},document:{getElementById:()=>({})},switchTab:tab=>opened.push(tab),showToast:(msg)=>toasts.push(msg)};
 vm.runInNewContext(guard,scope);
 return {can:scope.window.erpCanAccessTab,open:scope.window.switchTab,opened,toasts};
}

test('Conta da Dona e aba dinamica acessivel para perfil admin, sem exigir tab legada',()=>{
 const profile=guardCase({admin:true,role:'Dona / Financeiro',tabs:['bancos']});
 assert.equal(profile.can('contas_dona'),true);
 assert.equal(profile.open('contas_dona'),true);
 assert.deepEqual(profile.opened,['contas_dona']);
 assert.deepEqual(profile.toasts,[]);
});

test('Conta da Dona permanece negada para usuario financeiro comum',()=>{
 const profile=guardCase({admin:false,role:'Financeiro',tabs:['contas_pagar','bancos']});
 assert.equal(profile.can('contas_dona'),false);
 assert.equal(profile.open('contas_dona'),false);
 assert.deepEqual(profile.opened,[]);
 assert.equal(profile.toasts.length,1);
});

test('falha de leitura de Contas da Dona exibe erro e nao falsifica saldo R$ 0,00',async()=>{
 const display={dataset:{},innerHTML:''};
 const scope={global:{__businessRepository:{read:async()=>{throw Error('permission_denied');}}},store:{load:async()=>({})},$:s=>s==='#phase2-owner-bills'?display:null,$$:()=>[],console:{warn(){}},today:()=> '2026-11-03',money:x=>String(x),norm:x=>String(x),esc:x=>String(x),toBR:x=>String(x),notify(){},setTimeout:()=>0};
 vm.createContext(scope);vm.runInContext('/* Contas pessoais */'+ownerChunk,scope);
 await scope.loadOwnerBills();
 assert.match(display.innerHTML,/Firebase recusou a leitura/);
 assert.doesNotMatch(display.innerHTML,/Previsto \(geral\)/);
});

test('leitura real prevalece sobre cache vazio e recupera os dados da proprietaria',async()=>{
 const display={dataset:{},innerHTML:''};
 const scope={global:{__businessRepository:{read:async()=>({c1:{id:'c1',desc:'Faculdade',value:300,dueDay:4,payments:{},propertyId:'casa-gloria'}})}},store:{load:async()=>({})},$:s=>s==='#phase2-owner-bills'?display:null,$$:()=>[],console:{warn(){}},today:()=> '2026-11-03',money:x=>Number(x||0).toFixed(2),norm:x=>String(x),esc:x=>String(x),toBR:x=>String(x),notify(){},setTimeout:()=>0};
 vm.createContext(scope);vm.runInContext('/* Contas pessoais */'+ownerChunk,scope);
 await scope.loadOwnerBills();
 assert.match(display.innerHTML,/Faculdade/);
 assert.match(display.innerHTML,/300.00/);
});

test('consulta fiscal e protegida por canFiscalRead nos dois modulos sem mudar permissao de producao',()=>{
 for(const path of ['public/modules/phase1/phase1-fiscal-admin.js','public/modules/phase2/phase2-feedback.js']){
   const code=read(path);
   assert.match(code,/getIdTokenResult\(\)/);
   assert.match(code,/canFiscalRead!==true/);
 }
});

test('o formulario da Dona tem botao Cancelar estilizado e sem alteracao de persistencia',()=>{
 const css=read('public/modules/phase3/phase3-homologation.css');
 assert.match(ownerSource,/class="p3-owner-cancel" onclick="cm\(\)"/);
 assert.match(css,/#modal-body \.modal-ft\.p3-owner-modal-actions button\.p3-owner-cancel/);
});

test('Fiscal nao inicia leituras nem listeners sem claim de leitura fiscal',async()=>{
 const phase2=read('public/modules/phase2/phase2-feedback.js');
 const chunk=phase2.split('let fiscalParties={};')[1]?.split('global.phase2FiscalReload=loadFiscalParties;')[0];
 assert.ok(chunk);
 let reads=0,subscriptions=0;
 const scope={
   global:{firebase:{auth:()=>({currentUser:{getIdTokenResult:async()=>({claims:{erpAccess:true,canFiscalRead:false,admin:false}})}})},_fbDB:{ref:()=>{reads++;return {once:async()=>({val:()=>({})}),on:()=>subscriptions++}}}},
   store:null,renderFiscalRegistry(){},$:()=>null,console:{warn(){}},Date
 };
 vm.createContext(scope);
 vm.runInContext('let fiscalParties={};'+chunk+'\n global.phase2FiscalReload=loadFiscalParties;',scope);
 await scope.global.phase2FiscalReload();
 assert.equal(reads,0);
 assert.equal(subscriptions,0);
});

test('Falha de permissao fiscal nao provoca tempestade de novas leituras',async()=>{
 const phase2=read('public/modules/phase2/phase2-feedback.js');
 const chunk=phase2.split('let fiscalParties={};')[1]?.split('global.phase2FiscalReload=loadFiscalParties;')[0];
 let reads=0;
 const scope={
  global:{firebase:{auth:()=>({currentUser:{getIdTokenResult:async()=>({claims:{erpAccess:true,canFiscalRead:true,admin:false}})}})},_fbDB:{ref:()=>{reads++;return {once:async()=>{throw Error('permission_denied')},on(){},off(){}}}}},
  store:null,renderFiscalRegistry(){},$:()=>null,console:{warn(){}},Date
 };
 vm.createContext(scope);
 vm.runInContext('let fiscalParties={};'+chunk+'\n global.phase2FiscalReload=loadFiscalParties;',scope);
 await scope.global.phase2FiscalReload();
 const before=reads;
 for(let i=0;i<20;i++)await scope.global.phase2FiscalReload();
 assert.equal(reads,before);
});
