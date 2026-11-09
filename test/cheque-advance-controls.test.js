import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
function slice(start,end){
  const a=core.indexOf(start),b=core.indexOf(end,a);
  assert.ok(a>=0&&b>a,'trecho não encontrado: '+start);
  return core.slice(a,b);
}
const helpers=slice('function _chqHojeBR(){','function chqInit(){');
const movement=slice('function _chqPodeLancarBanco(){','function _chqMovBancoRemover(movId){');
const remove=slice('function chqReabrir(id){','function _chqCadastroDestinos(){');

test('compensação: cheque próprio de adiantamento baixa o banco; de terceiro não; legado pergunta',()=>{
  const ctx={ADT_POR_FORN:{F1:[{cod:'ADT1',forma:'Cheque'},{cod:'ADT2',forma:'PIX',movBancoId:'LB-1'}]}};
  runInNewContext(helpers+';this.auto=_chqDescontaBancoAuto;',ctx);
  assert.equal(ctx.auto({advanceCode:'ADT1',fornCod:'F1',tipoCheque:'Cheque'}),true);
  assert.equal(ctx.auto({advanceCode:'ADT1',fornCod:'F1',tipoCheque:'Cheque de Terceiro'}),false);
  assert.equal(ctx.auto({advanceCode:'ADT2',fornCod:'F1',tipoCheque:'Cheque'}),false,'adiantamento que já debitou o banco');
  assert.equal(ctx.auto({n:'123',dc:true}),null,'cheque legado: mantém a pergunta');
});

test('sem acesso a Bancos a saída não é gravada em silêncio: avisa e não cria movimento',()=>{
  const toasts=[];let saved=0;
  const make=cu=>{
    const ctx={cu,LANC_BANCO_DB:[],showToast:(m,t)=>toasts.push([m,t]),saveBancos(){saved++;},renderBancos(){},_chqFmt:v=>'R$ '+v,Date,Math,Number,Array};
    runInNewContext(movement+';this.criar=_chqMovBancoCriar;',ctx);
    return ctx;
  };
  const sem=make({tabs:['cheques_compensar']});
  assert.equal(sem.criar('B1','08/11/2026','Cheque 1',100),'');
  assert.equal(sem.LANC_BANCO_DB.length,0);
  assert.match(toasts[0][0],/NÃO foi lançada no extrato/);
  const com=make({tabs:['cheques_compensar','contas_banco']});
  assert.match(com.criar('B1','08/11/2026','Cheque 1',100),/^LB-/);
  assert.equal(com.LANC_BANCO_DB.length,1);assert.equal(saved,1);
  assert.match(make({admin:true,tabs:[]}).criar('B1','08/11/2026','x',5),/^LB-/);
});

test('cheque de adiantamento não é excluído pelo controle; cheque já debitado exige acesso a Bancos',()=>{
  const alerts=[];const removed=[];
  const make=(cheque,cu)=>{
    const ctx={CHQ_CTRL:{C1:cheque},cu,_chqDel:{},alert:m=>alerts.push(m),confirm:()=>true,showToast(){},renderChequesCompensar(){},
      _chqFmt:v=>'R$ '+v,_chqMovBancoRemover:id=>removed.push(id),
      _chqRef:()=>({child:()=>({remove:()=>Promise.resolve(),update:()=>Promise.resolve()})}),
      _chqDelRef:()=>({child:()=>({set:()=>Promise.resolve()})})};
    runInNewContext(movement.slice(0,movement.indexOf('function _chqMovBancoCriar'))+remove+';this.excluir=chqExcluir;this.reabrir=chqReabrir;',ctx);
    return ctx;
  };
  make({n:'1',b:'Itaú',v:10,advanceCode:'ADT9'},{admin:true}).excluir('C1');
  assert.match(alerts.pop(),/pertence ao adiantamento ADT9/);
  make({n:'2',b:'Itaú',v:10,movBancoId:'LB-7',s:'C'},{tabs:['cheques_compensar']}).reabrir('C1');
  assert.match(alerts.pop(),/acesso a Bancos/);
  assert.deepEqual(removed,[],'movimento do extrato preservado');
  make({n:'3',b:'Itaú',v:10,movBancoId:'LB-8',s:'C'},{tabs:['contas_banco']}).reabrir('C1');
  assert.deepEqual(removed,['LB-8']);
});
