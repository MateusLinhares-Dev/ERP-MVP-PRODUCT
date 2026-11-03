import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/modules/maintenance/fiscal-advance-fix.js'), 'utf8');
function setup({mode = 'ok'} = {}) {
  const suppliers = [{cod:'F001',nome:'FERRO VELHO BOA VISTA'}, {cod:'F002',nome:'OUTRO FORNECEDOR'}];
  const initial = {F001:[
    {cod:'ADT582451',data:'19/10/2026',valor:114770,status:'Pendente'},
    {cod:'ADT549529',data:'07/10/2026',valor:44910,status:'Pendente'}
  ],F002:[{cod:'ADT582451',valor:10}]};
  const remote = structuredClone(initial);
  const calls = {transactions:[],reads:0,bankChanges:0,cold:0};
  if(mode === 'missing') remote.F001 = [];
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
    _removerMovBancoDeAdiantamento(){calls.bankChanges++},
    confirm:()=>true,alert(msg){this.alerts.push(msg)},
    _fbDB:{ref(path){
      assert.ok(path.startsWith('erp/adiantamentos/'));
      const supplierCode=path.split('/').at(-1);
      return {
        async once(){calls.reads++;return {val:()=>structuredClone(remote[supplierCode])}},
        child(key){return {
          async transaction(update){
            calls.transactions.push(`${supplierCode}/${key}`);
            if(mode==='permission')throw new Error('permission_denied');
            if(mode==='race')remote[supplierCode][Number(key)]={cod:'ALTERADO',valor:100};
            if(mode==='cold') {
              calls.cold++;
              assert.equal(update(null),null,'primeira chamada em cache vazio não pode abortar');
            }
            const old = remote[supplierCode]?.[Number(key)] ?? null;
            const value=update(old);
            if(value===undefined)return {committed:false,snapshot:{val:()=>old}};
            if(value===null){delete remote[supplierCode][Number(key)];}
            else remote[supplierCode][Number(key)]=value;
            return {committed:true,snapshot:{val:()=>value}};
          }
        };}
      };
    }}
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(code,ctx,{filename:'fiscal-advance-fix.js'});
  return {ctx,remote,calls};
}

const codes = list => Object.values(list || {}).filter(Boolean).map(x=>x.cod);

test('saldo AS na Gratus é derivado somente das NFs da empresa',()=>{
  const {ctx}=setup();
  const a=ctx.ERPFiscalAdvanceFix.stockOrigins('AS');
  assert.deepEqual(Array.from(a,x=>x.number),['21','232']);
  assert.equal(a.reduce((sum,x)=>sum+(x.source==='entradas'?x.amount:-x.amount),0),111);
});

test('exclusão atua somente no item; outros cheques/adiantamentos e fornecedor ficam intactos',async()=>{
  const {ctx,remote,calls}=setup();
  const ok=await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451');
  assert.equal(ok,true);
  assert.deepEqual(codes(remote.F001), ['ADT549529']);
  assert.deepEqual(codes(remote.F002), ['ADT582451']);
  assert.deepEqual(calls.transactions,['F001/0']);
  assert.equal(ctx.ADT_POR_FORN.F001.length,1);
  assert.equal(ctx._DEL_SETS.adtItens.has('F001::ADT582451'),true);
  assert.equal(ctx.histories.length,1);
  assert.equal(calls.bankChanges,0);
  assert.equal(ctx.saves,1);
});

test('cache inicial vazio não aborta a exclusão do registro já existente',async()=>{
  const {ctx,remote,calls}=setup({mode:'cold'});
  assert.equal(await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451'),true);
  assert.equal(calls.cold,1);
  assert.deepEqual(codes(remote.F001),['ADT549529']);
});

test('falha de permissão não exclui nem muda a lista local',async()=>{
  const {ctx,remote}=setup({mode:'permission'});
  assert.equal(await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451'),false);
  assert.deepEqual(codes(remote.F001),['ADT582451','ADT549529']);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(ctx._DEL_SETS.adtItens.size,0);
  assert.equal(ctx.saves,0);
  assert.equal(ctx.histories.length,0);
  assert.ok(ctx.alerts.some(x=>x.includes('permission_denied')));
});

test('registro ausente na nuvem não é marcado como excluído',async()=>{
  const {ctx}=setup({mode:'missing'});
  assert.equal(await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451'),false);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(ctx.histories.length,0);
});

test('edição simultânea da entrada bloqueia a exclusão por posição',async()=>{
  const {ctx,remote}=setup({mode:'race'});
  assert.equal(await ctx.ERPFiscalAdvanceFix.deleteAdvance('F001','ADT582451'),false);
  assert.ok(remote.F001[0]);
  assert.equal(remote.F001[0].cod,'ALTERADO');
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(ctx.histories.length,0);
});

test('exclusão via botão diferencia fornecedores com mesmo código de adiantamento',async()=>{
  const {ctx,remote,calls}=setup();
  const btn={dataset:{cod:'ADT582451',forn:'OUTRO FORNECEDOR'},textContent:'Excluir',disabled:false};
  assert.equal(await ctx.excluirAdiantamentoLista(btn),true);
  assert.deepEqual(codes(remote.F001),['ADT582451','ADT549529']);
  assert.deepEqual(codes(remote.F002),[]);
  assert.deepEqual(calls.transactions,['F002/0']);
});
