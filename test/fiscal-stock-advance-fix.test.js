import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {changeAdvance} from '../server/modules/advances/application/advances.js';

const fiscalCode=readFileSync(new URL('../public/modules/fiscal/fiscal-stock-origins.js',import.meta.url),'utf8');
const advanceCode=readFileSync(new URL('../public/modules/finance/advance-actions.js',import.meta.url),'utf8');
const identity={uid:'erp:thais',erpUser:'thais',erpAccess:true,canFinance:false,canAdvances:true,canBanking:false};
const codes=list=>Object.values(list||{}).filter(Boolean).map(item=>item.cod);

function makeDb(initial){
  const state={erp:{
    fornecedores:{f1:{cod:'F001',nome:'FERRO VELHO BOA VISTA'},f2:{cod:'F002',nome:'OUTRO FORNECEDOR'}},
    adiantamentos:structuredClone(initial),
    bancos:{b1:{cod:'BC1',banco:'Banco Exemplo'}},
    lancBanco:{'LB-ADV-1':{id:'LB-ADV-1',bancoCod:'BC1',descricao:'Adiantamento: FERRO VELHO BOA VISTA',tipo:'Saida',valor:114770}}
  }};
  let updates=0,failNext=false;
  const get=path=>path.split('/').filter(Boolean).reduce((obj,key)=>obj?.[key],state);
  const assign=(path,value)=>{
    const parts=path.split('/').filter(Boolean),leaf=parts.pop();
    let obj=state;
    for(const part of parts)obj=obj[part]??={};
    if(value===null)delete obj[leaf];else obj[leaf]=structuredClone(value);
  };
  return {
    state,
    get updates(){return updates;},
    failNext(){failNext=true;},
    ref(path){return {
      async get(){return {val:()=>structuredClone(get(path)??null)};},
      async transaction(fn){
        const current=structuredClone(get(path)??null),value=fn(current);
        if(value===undefined)return {committed:false,snapshot:{val:()=>current}};
        assign(path,value);
        return {committed:true,snapshot:{val:()=>value}};
      },
      async update(changes){
        if(failNext){failNext=false;throw Error('permission_denied');}
        const before=structuredClone(state);
        try{for(const [key,value] of Object.entries(changes))assign(path+'/'+key,value);updates++;}
        catch(error){for(const key of Object.keys(state))delete state[key];Object.assign(state,before);throw error;}
      }
    };}
  };
}

function setup({mode='ok'}={}){
  const initial={
    F001:[
      {cod:'ADT582451',data:'19/10/2026',valor:114770,status:'Pendente',bancoCod:'BC1',movBancoId:'LB-ADV-1'},
      {cod:'ADT549529',data:'07/10/2026',valor:44910,status:'Pendente'}
    ],
    F002:[{cod:'ADT582451',valor:10}]
  };
  const db=makeDb(initial);
  const calls={requests:[],histories:[],alerts:[],saves:0};
  const ctx={console,Set,Date,Number,Object,String,Array,Map,JSON,Error,Promise,
    setTimeout(){},document:undefined,
    FISCAL_DB:{'g-2026-10':{entradas:[{num:'21',data:'17/10/2026',itens:[{produto:'AS',kg:123}]}],saidas:[{num:'232',data:'17/10/2026',itens:[{produto:'AS',kg:12}]}]},'2026-10':{entradas:[{num:'999',itens:[{produto:'AS',kg:998}]}]}},
    _fiscalEmpresa:'gratus',
    _fiscalKeyMatchesCompany:(key,company)=>company==='gratus'?key.startsWith('g-'):!key.startsWith('g-'),
    _categoriaProdutoNF:item=>item.produto,
    _kgDoItem:item=>item.kg,
    ADT_POR_FORN:structuredClone(initial),
    FORNECEDORES:[{cod:'F001',nome:'FERRO VELHO BOA VISTA'},{cod:'F002',nome:'OUTRO FORNECEDOR'}],
    _DEL_SETS:{adtItens:new Set()},_DEL_LS_KEY:{adtItens:'del-adv'},
    localStorage:{setItem(){throw Error('A exclusão não deve gravar diretamente no navegador.');}},
    saveDB(){calls.saves++;},
    registrarHistorico(...args){calls.histories.push(args);},
    confirm:()=>true,
    alert(message){calls.alerts.push(message)}
  };
  ctx._adtCommitTransacional=async payload=>{
    calls.requests.push(structuredClone(payload));
    if(mode==='permission')throw Error('permission_denied');
    const result=await changeAdvance(identity,{...payload,operationId:randomUUID()},{db});
    ctx.ADT_POR_FORN[result.fornCod]=structuredClone(result.entries);
    return result;
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(fiscalCode,ctx,{filename:'fiscal-stock-origins.js'});
  vm.runInContext(advanceCode,ctx,{filename:'advance-actions.js'});
  return {ctx,db,calls};
}

test('saldo AS na Gratus é derivado somente das NFs da empresa',()=>{
  const {ctx}=setup();
  const origins=ctx.ERPFiscalStockOrigins.stockOrigins('AS');
  assert.deepEqual(Array.from(origins,item=>item.number),['21','232']);
  assert.equal(origins.reduce((sum,item)=>sum+(item.source==='entradas'?item.amount:-item.amount),0),111);
});

test('exclusão usa API atômica e remove somente o adiantamento e seu movimento vinculado',async()=>{
  const {ctx,db,calls}=setup();
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),true);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT549529']);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F002),['ADT582451']);
  assert.equal(db.state.erp.lancBanco['LB-ADV-1'],undefined);
  assert.equal(db.updates,1);
  assert.equal(calls.requests.length,1);
  assert.equal(calls.requests[0].action,'delete');
  assert.equal(calls.requests[0].fornCod,'F001');
  assert.equal(calls.requests[0].expected.movBancoId,'LB-ADV-1');
  assert.equal(ctx.ADT_POR_FORN.F001.length,1);
  assert.equal(calls.histories.length,1);
  assert.equal(calls.saves,0);
});

test('transação no servidor funciona sem acesso direto do browser a erp/adiantamentos',async()=>{
  const {ctx,db}=setup();
  ctx._fbDB={ref(){throw Error('A gravação deve ocorrer no servidor.');}};
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),true);
  assert.equal(db.updates,1);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT549529']);
});

test('negação de permissão mantém histórico, banco e cache local intactos',async()=>{
  const {ctx,db,calls}=setup({mode:'permission'});
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT582451','ADT549529']);
  assert.equal(db.state.erp.lancBanco['LB-ADV-1'].valor,114770);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(calls.histories.length,0);
  assert.ok(calls.alerts.some(message=>message.includes('não tem permissão para excluir este adiantamento')));
  assert.ok(calls.alerts.every(message=>!message.includes('permission_denied')));
});

test('falha no update remoto não remove o adiantamento nem o movimento',async()=>{
  const {ctx,db,calls}=setup();
  db.failNext();
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT582451','ADT549529']);
  assert.equal(db.state.erp.lancBanco['LB-ADV-1'].valor,114770);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(db.updates,0);
  assert.equal(calls.histories.length,0);
});

test('registro ausente na nuvem não pode ser marcado como excluído',async()=>{
  const {ctx,db,calls}=setup();
  db.state.erp.adiantamentos.F001=[];
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(calls.histories.length,0);
  assert.equal(db.updates,0);
});

test('edição concorrente bloqueia exclusão com snapshot desatualizado',async()=>{
  const {ctx,db,calls}=setup();
  db.state.erp.adiantamentos.F001[0].cod='ALTERADO';
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.equal(db.state.erp.adiantamentos.F001[0].cod,'ALTERADO');
  assert.equal(db.state.erp.lancBanco['LB-ADV-1'].valor,114770);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
  assert.equal(calls.histories.length,0);
});

test('movimento bancário alterado por outra sessão bloqueia a exclusão',async()=>{
  const {ctx,db}=setup();
  db.state.erp.lancBanco['LB-ADV-1'].valor=500;
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT582451','ADT549529']);
  assert.equal(db.state.erp.lancBanco['LB-ADV-1'].valor,500);
  assert.equal(db.updates,0);
});

test('botão de exclusão desambigua o fornecedor mesmo com código repetido',async()=>{
  const {ctx,db,calls}=setup();
  const button={dataset:{cod:'ADT582451',forn:'OUTRO FORNECEDOR'},textContent:'Excluir',disabled:false};
  assert.equal(await ctx.excluirAdiantamentoLista(button),true);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F001),['ADT582451','ADT549529']);
  assert.deepEqual(codes(db.state.erp.adiantamentos.F002),[]);
  assert.ok(db.state.erp.lancBanco['LB-ADV-1']);
  assert.equal(calls.requests[0].fornCod,'F002');
  assert.equal(db.updates,1);
});

test('serviço financeiro indisponível não permite exclusão local',async()=>{
  const {ctx,db,calls}=setup();
  delete ctx._adtCommitTransacional;
  assert.equal(await ctx.ERPAdvanceActions.deleteAdvance('F001','ADT582451'),false);
  assert.equal(db.updates,0);
  assert.equal(calls.histories.length,0);
  assert.equal(ctx.ADT_POR_FORN.F001.length,2);
});
