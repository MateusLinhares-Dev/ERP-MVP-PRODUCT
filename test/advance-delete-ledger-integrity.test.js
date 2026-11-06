import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,changeAdvance} from '../server/application/finance-advances.js';

const clone=x=>x===undefined?undefined:structuredClone(x);
function dbFixture(){
  const state={erp:{bancos:{b1:{cod:'B1',banco:'Conta de teste'}},fornecedores:{f1:{cod:'F1',nome:'Fornecedor de teste'}},adiantamentos:{F1:[]}}};
  const get=p=>p.split('/').filter(Boolean).reduce((o,k)=>o?.[k],state);
  const put=(p,v)=>{const parts=p.split('/').filter(Boolean),key=parts.pop();let parent=state;for(const k of parts)parent=parent[k]??={};if(v===null)delete parent[key];else parent[key]=clone(v);};
  return {state,get,ref(path=''){return {
    async get(){return {val:()=>clone(get(path)??null)};},
    async transaction(fn){const old=clone(get(path)??null),next=fn(old);if(next===undefined)return {committed:false};put(path,next);return {committed:true};},
    async update(values){for(const [key,value] of Object.entries(values))put([path,key].filter(Boolean).join('/'),value);}
  };}};
}
const who={uid:'operator',erpUser:'Operador',erpAccess:true,canAdvances:true};
const op=n=>'acafe000-'+String(n).padStart(4,'0')+'-4000-8000-'+String(n).padStart(12,'0');
const values={fornCod:'F1',data:'2026-11-06',forma:'PIX',bancoCod:'B1',empresa:'Teste',ticket:'',obs:'Homologacao'};
const make=async(db,n,valor)=>createAdvance(who,{...values,valor,operationId:op(n)},{db});
const remove=async(db,advance,n)=>changeAdvance(who,{action:'delete',fornCod:'F1',adtCod:advance.cod,expected:advance,operationId:op(n)},{db});

test('movimento adulterado é rejeitado ANTES do lock; próximo adiantamento íntegro continua excluível',async()=>{
  const db=dbFixture();
  const a=await make(db,1,124),b=await make(db,2,12);
  const reference=db.state.erp.lancBanco[a.bankMovement.id];
  reference.valor=1000;
  await assert.rejects(()=>remove(db,a.advance,3),{code:'BANK_LEDGER_CHANGED',status:409});
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined,'erro de integridade não deve reservar o fornecedor');
  assert.equal(db.get('erp/adiantamentos/F1').length,2,'não pode excluir o registro divergente');
  const next=await remove(db,b.advance,4);
  assert.equal(next.action,'delete');
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined);
  assert.equal(db.get('erp/lancBanco/'+b.bankMovement.id),undefined);
  assert.equal(db.get('erp/adiantamentos/F1').length,1);
  reference.valor=124;
  await remove(db,a.advance,5);
  assert.equal(db.get('erp/adiantamentos/F1').length,0);
});

test('movimento faltante ou com identificador errado nunca é excluído por aproximação de valor',async()=>{
  const db=dbFixture();
  const a=await make(db,6,124);
  db.state.erp.lancBanco[a.bankMovement.id].advanceCode='OUTRO';
  await assert.rejects(()=>remove(db,a.advance,7),{code:'BANK_LEDGER_CHANGED'});
  assert.equal(db.get('erpFinanceAdvanceLocks/F1'),undefined);
  delete db.state.erp.lancBanco[a.bankMovement.id];
  await assert.rejects(()=>remove(db,a.advance,8),{code:'BANK_LEDGER_CHANGED'});
  assert.equal(db.get('erp/adiantamentos/F1').length,1);
});

test('extrato bancário bloqueia a edição/exclusão direta de movimentos de adiantamentos',()=>{
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  const start=core.indexOf('function _movimentoPertenceAdiantamento('),end=core.indexOf('function editLancBanco(',start);
  assert.ok(start>0&&end>start);
  const alerts=[];
  const context={ADT_POR_FORN:{F1:[{cod:'A1',movBancoId:'LB-OLD'}]},showToast:(m)=>alerts.push(m)};
  runInNewContext(core.slice(start,end)+';this.isProtected=_movimentoPertenceAdiantamento;this.block=_bloquearEdicaoMovimentoAdiantamento;',context);
  assert.equal(context.isProtected({id:'LB-1',descricao:'Adiantamento: Fornecedor de teste'}),true);
  assert.equal(context.isProtected({id:'LB-OLD',descricao:'Descricao alterada'}),true);
  assert.equal(context.isProtected({id:'LB-OTHER',descricao:'Compra independente'}),false);
  assert.equal(context.block({id:'LB-OLD'}),true);
  assert.match(alerts[0],/Financeiro/);
  assert.match(core,/function excluirLancBanco\(id,cod\)\{[\s\S]{0,230}_bloquearEdicaoMovimentoAdiantamento/);
});

test('sincronização geral não reenvia movimentos de adiantamentos administrados pela API',()=>{
  const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
  const start=sync.indexOf('      const _lancamentosLegados=_syncLancBanco.paraObjeto();');
  const end=sync.indexOf("      _patchIncremental(dados, 'viagem'",start);
  assert.ok(start>0&&end>start);
  const ctx={
    dados:{},
    ADT_POR_FORN:{F1:[{cod:'ADT1',movBancoId:'LB1'}]},
    _syncLancBanco:{deletedSet:new Set(),paraObjeto:()=>({
      LB1:{id:'LB1',descricao:'Mudou a descrição'},
      LB2:{id:'LB2',descricao:'Adiantamento: Teste'},
      LB3:{id:'LB3',descricao:'Pagamento livre'},
      LB4:{id:'LB4',source:'advance'}
    })},
    _patchIncremental:(data,path,obj)=>Object.entries(obj).forEach(([key,value])=>{data[path+'/'+key]=value;})
  };
  runInNewContext(sync.slice(start,end),ctx);
  assert.deepEqual(Object.keys(ctx.dados),['lancBanco/LB3']);
});

test('auditoria somente leitura identifica divergência do movimento sem alterar snapshot',async()=>{
  const {inspectAdvanceLedger}=await import('../scripts/audit-advance-ledger.mjs');
  const data={erp:{adiantamentos:{F1:[{cod:'ADT124',valor:124,bancoCod:'B1',movBancoId:'LB1',status:'Pendente'}]},lancBanco:{LB1:{id:'LB1',valor:124,bancoCod:'B1',descricao:'Adiantamento: Teste'}}}};
  const before=JSON.stringify(data);
  const result=inspectAdvanceLedger(data,'ADT124');
  assert.equal(result.length,1);
  assert.equal(result[0].ledgerConsistent,true);
  data.erp.lancBanco.LB1.valor=125;
  const invalid=inspectAdvanceLedger(data,'ADT124');
  assert.equal(invalid[0].ledgerConsistent,false);
  assert.equal(invalid[0].amountMatches,false);
  assert.match(invalid[0].recommendation,/conciliar/);
  assert.equal(before.includes('ADT124'),true);
  assert.equal(data.erp.adiantamentos.F1[0].valor,124);
});
