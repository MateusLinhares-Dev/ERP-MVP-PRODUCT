import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/modules/maintenance/fiscal-advance-fix.js'), 'utf8');
function setup({fail = false, remoteMissing = false} = {}) {
  const suppliers = [{cod:'F001',nome:'FERRO VELHO BOA VISTA'}, {cod:'F002',nome:'OUTRO FORNECEDOR'}];
  const initial = {F001:[{cod:'ADT582451',data:'19/10/2026',valor:114770,status:'Pendente'}, {cod:'ADT549529',valor:44910,status:'Pendente'}],F002:[{cod:'ADT582451',valor:10}]};
  const remote = {F001: (remoteMissing ? [] : structuredClone(initial.F001)), F002:structuredClone(initial.F002)};
  const ctx = { console, Set, Date, Number, Object, String, Array, Map, JSON, Error, Promise,
    setTimeout(){}, document: undefined, alerts:[], saves:0, rerenders:0, histories:[],
    FISCAL_DB: {'g-2026-10':{entradas:[{num:'21',data:'17/10/2026',itens:[{produto:'AS',kg:123}]}],saidas:[{num:'232',data:'17/10/2026',itens:[{produto:'AS',kg:12}]}]}, '2026-10':{entradas:[{num:'999',itens:[{produto:'AS',kg:998}]}]}},
    _fiscalEmpresa:'gratus',
    _fiscalKeyMatchesCompany: (key,company)=>company==='gratus'?key.startsWith('g-'):!key.startsWith('g-'),
    _categoriaProdutoNF:(it)=>it.produto,
    _kgDoItem:(it)=>it.kg,
    ADT_POR_FORN:structuredClone(initial),
    FORNECEDORES:suppliers,
    _DEL_SETS:{adtItens:new Set()},_DEL_LS_KEY:{adtItens:'del-adv'},
    localStorage:{values:new Map(),setItem(k,v){this.values.set(k,v)}},
    saveDB(){ctx.saves++},renderAdiantamentos(){ctx.rerenders++},
    registrarHistorico(...args){ctx.histories.push(args)},
    confirm:()=>true,alert(msg){this.alerts.push(msg)},
    _fbDB:{ ref(path){ const supplierCode = path.split('/').at(-1);return {
      async once(){return {val:()=>remote[supplierCode]}}
      ,async transaction(update){if(fail)throw new Error('permission_denied'); const value=update(remote[supplierCode]);if(value===undefined)return {committed:false,snapshot:{val:()=>remote[supplierCode]}};remote[supplierCode]=value;return {committed:true,snapshot:{val:()=>value}};}
    };}}
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(code,ctx,{filename:'fiscal-advance-fix.js'});
  return {ctx,remote};
}

test('estoque fiscal consolida origens somente da empresa selecionada',()=>{
  const {ctx}=setup();
  const a=ctx.ERPFiscalAdvanceFix.stockOrigins('AS');
  assert.equal(a.length,2);
  assert.deepEqual(Array.from(a,x=>x.number),['21','232']);
  assert.equal(a.reduce((sum,x)=>sum+(x.source==='entradas'?x.amount:-x.amount),0),111);
});

test('exclusão por código confirma transação e preserva lançamentos não envolvidos',async()=>{
  const {ctx,remote}=setup();
  const ok=await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451');
  assert.equal(ok,true);
  assert.deepEqual(remote.F001.map(x=>x.cod), ['ADT549529']);
  assert.equal(remote.F002.length,1,'não toca fornecedor com mesmo código de adiantamento');
  assert.equal(ctx.ADT_POR_FORN.F001.length,1);
  assert.equal(ctx._DEL_SETS.adtItens.has('F001::ADT582451'),true);
  assert.equal(ctx.histories.length,1);
  assert.ok(ctx.alerts.some(x=>x.includes('confirmado')));
});

test('falha de permissão não apaga localmente, não confirma e não altera tombstones',async()=>{
  const {ctx,remote}=setup({fail:true});
  const ok=await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451');
  assert.equal(ok,false);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(remote.F001.length,2);
  assert.equal(ctx._DEL_SETS.adtItens.size,0);
  assert.ok(ctx.alerts.some(x=>x.includes('permission_denied')));
});

test('registro ausente do Firebase não é considerado excluído',async()=>{
  const {ctx}=setup({remoteMissing:true});
  assert.equal(await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451'),false);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(ctx.histories.length,0);
});

test('seleção por fornecedor evita excluir adiantamentos homônimos de outro cadastro',async()=>{
  const {ctx,remote}=setup();
  const btn={dataset:{cod:'ADT582451',forn:'OUTRO FORNECEDOR'},textContent:'Excluir',disabled:false};
  const result=await ctx.excluirAdiantamentoLista(btn);
  assert.equal(result,true);
  assert.equal(remote.F001.length,2);
  assert.equal(remote.F002,null);
});
