import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/modules/phase1/phase1-usability.css',import.meta.url),'utf8');
const helper=core.slice(core.indexOf('function _valeConfirmadoLocal('),core.indexOf('function _diasUteisNoMes('));

function setup(){
  const cloud=new Map();
  const local=[];
  let deny=false;
  const tombstones=new Set();
  const deletedSet=new Set();
  const db={ref(path){return {
    async transaction(callback){
      if(deny)throw new Error('PERMISSION_DENIED');
      const current=cloud.has(path)?JSON.parse(JSON.stringify(cloud.get(path))):null;
      const next=callback(current);
      if(next===undefined)return {committed:false,snapshot:{val:()=>current}};
      cloud.set(path,next);
      return {committed:true,snapshot:{val:()=>next}};
    },
    async set(value){if(deny)throw new Error('PERMISSION_DENIED');cloud.set(path,value);tombstones.add(path);}
  };}};
  const context={
    VALES_DB:local,
    _syncVales:{remover(id){const i=local.findIndex(item=>item.id===id);if(i>=0)local.splice(i,1);deletedSet.add(id);},novoId:()=>`VL${Math.random()}`},
    localStorage:{setItem(){}},
    window:{_fbDB:db},
    firebase:{auth:()=>({currentUser:{uid:'rh'}})},
    showToast(){},document:{getElementById:()=>null}
  };
  runInNewContext(helper,context);
  return {context,cloud,local,tombstones,deletedSet,setDenied:x=>{deny=x;}};
}
const vale=(id,mat)=>({id,mat,data:'20/10/2026',mes:'2026-10',valor:100,forma:'PIX',obs:''});

test('vales de funcionários diferentes são gravados em chaves distintas',async()=>{
  const ctx=setup();
  await ctx.context._valeCriarSeguro(vale('VLJOEL','F014'));
  await ctx.context._valeCriarSeguro(vale('VLRODRIGO','F021'));
  assert.equal(ctx.cloud.size,2);
  assert.deepEqual(ctx.local.map(x=>x.mat),['F014','F021']);
});

test('falha na gravação não cria vale local nem confirma recibo',async()=>{
  const ctx=setup();ctx.setDenied(true);
  await assert.rejects(ctx.context._valeCriarSeguro(vale('VL001','F014')),/PERMISSION_DENIED/);
  assert.equal(ctx.local.length,0);
});

test('edição simultânea é rejeitada sem sobrescrever outro usuário',async()=>{
  const ctx=setup();const item=vale('VL001','F014');
  await ctx.context._valeCriarSeguro(item);
  ctx.cloud.set('erp/vales/VL001',{...item,obs:'Edição remota'});
  await assert.rejects(ctx.context._valeAtualizarSeguro(item,{...item,obs:'Local'}),/outra sessão/);
  assert.equal(ctx.cloud.get('erp/vales/VL001').obs,'Edição remota');
  assert.equal(ctx.local[0].obs,'');
});

test('exclusão não remove vale de outro funcionário',async()=>{
  const ctx=setup();const a=vale('VL001','F014'),b=vale('VL002','F021');
  await ctx.context._valeCriarSeguro(a);await ctx.context._valeCriarSeguro(b);
  await ctx.context._valeExcluirSeguro(a);
  assert.equal(ctx.cloud.get('erp/vales/VL001'),null);
  assert.equal(ctx.cloud.get('erp/vales/VL002').mat,'F021');
  assert.deepEqual(ctx.local.map(v=>v.mat),['F021']);
  assert.ok(ctx.tombstones.has('erp/valesDeleted/VL001'));
});

test('sincronizador genérico não reenvia histórico de vales desatualizado',()=>{
  assert.doesNotMatch(sync,/_patchIncremental\(dados,\s*'vales'/);
  assert.match(sync,/delete dados\.valesDeleted/);
  assert.match(core,/nome==='vales'\?ref\.transaction/);
  assert.match(core,/prefixoId\+'LEGACY'\+index/);
});

test('recibos em lote oferecem filtros por mês, ano e dia e paginação A4',()=>{
  for(const id of ['vales-filtro-mes','vales-filtro-ano','vales-filtro-dia'])assert.ok(html.includes(`id="${id}"`));
  assert.match(html,/valeGerarTodosRecibosMes\(\)/);
  assert.match(core,/class="folha-recibos"/);
  assert.match(core,/@page\{size:A4 portrait/);
  assert.match(css,/#tab-vales #erp-list-pager-vales-search/);
});

test('ponto tem orientação de formato PDF com exemplo do RH iD',()=>{
  assert.match(html,/Como importar \/ Modelo aceito/);
  assert.match(core,/function pontoRHiDComoImportar\(\)/);
  assert.match(core,/ENT\. 1   SAI\. 1/);
  assert.match(core,/Nenhum dado foi alterado/);
});

test('comparação de edições ignora a ordem das propriedades retornadas pelo Firebase',async()=>{
  const ctx=setup();
  const item=vale('VL001','F014');
  await ctx.context._valeCriarSeguro(item);
  ctx.cloud.set('erp/vales/VL001',Object.fromEntries(Object.entries(item).reverse()));
  await ctx.context._valeAtualizarSeguro(item,{...item,obs:'Corrigido'});
  assert.equal(ctx.cloud.get('erp/vales/VL001').obs,'Corrigido');
});

test('filtros de vales distinguem dia, mês e ano independentemente',()=>{
  const start=core.indexOf('function _valeMesChave(');
  const end=core.indexOf('function _valeReciboHtml(',start);
  const source=core.slice(start,end);
  const inputs={};
  const list=[vale('1','F001'),{...vale('2','F002'),data:'04/11/2026',mes:'2026-11'},{...vale('3','F003'),data:'10/10/2025',mes:'2025-10'}];
  const context={VALES_DB:list,document:{getElementById:id=>({value:inputs[id]||''})},_erpSituacaoFiltro:()=> 'todos',FUNCIONARIOS:[],_erpFiltroFuncionario:()=>true,renderVales(){}};
  runInNewContext(source,context);
  assert.equal(context._valeListaFiltrada().length,3);
  inputs['vales-filtro-mes']='2026-10';
  assert.equal(context._valeListaFiltrada().length,1);
  delete inputs['vales-filtro-mes']; inputs['vales-filtro-ano']='2026';
  assert.equal(context._valeListaFiltrada().length,2);
  delete inputs['vales-filtro-ano']; inputs['vales-filtro-dia']='04-11-2026'.split('-').reverse().join('-');
  inputs['vales-filtro-dia']='2026-11-04';
  assert.equal(context._valeListaFiltrada().length,1);
});

test('adiantamento aguarda trava concorrente por tentativas controladas',async()=>{
  const code=readFileSync(new URL('../server/application/finance-advances.js',import.meta.url),'utf8');
  const src=code.slice(code.indexOf('async function acquireAdvanceLock('),code.indexOf('export async function createAdvance('));
  const {runTransaction,releaseLease}=await import('../server/infrastructure/rtdb-transaction.js');
  const ctx={setTimeout:callback=>callback(),runTransaction,releaseLease};
  runInNewContext(src,ctx);
  let attempts=0;
  const ref={transaction:async()=>({committed:++attempts>=3})};
  assert.equal(await ctx.acquireAdvanceLock(ref,'tester',()=>42),true);
  assert.equal(attempts,3);
});
