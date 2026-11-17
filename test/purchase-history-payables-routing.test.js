import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
function fnSource(name,next){
  const start=core.indexOf('function '+name+'(');
  const end=core.indexOf(next,start);
  assert.ok(start>=0&&end>start,`missing ${name}`);
  return core.slice(start,end);
}

test('Histórico não marca ticket pago localmente; encaminha a conta ao mesmo modal de Contas a Pagar',()=>{
  const render=core.slice(core.indexOf('function renderTickets(){'),core.indexOf('function excluirEntradaCompra(',core.indexOf('function renderTickets(){')));
  assert.match(render,/abrirBaixaCompraNoFinanceiro\(this\.dataset\.ticket\)/);
  assert.doesNotMatch(render,/onclick="marcarCompraPaga/);
  const calls=[],messages=[];
  const payable={id:'CP-T303',ticket:'T303',valor:50,status:'Pendente'};
  const env={CONTAS_PAGAR:[payable],pagarContaRapido:(idx,id)=>calls.push({idx,id}),showToast:(message)=>messages.push(message)};
  runInNewContext(fnSource('abrirBaixaCompraNoFinanceiro','async function desmarcarCompraPaga(')+';abrirBaixaCompraNoFinanceiro("T303");',env);
  assert.deepEqual(calls,[{idx:0,id:'CP-T303'}]);
  assert.equal(payable.status,'Pendente');
  assert.equal(payable.valor,50);
  assert.equal(messages.length,0);
});

test('Histórico não dá baixa nem altera dados se a conta não existe ou houver duas contas',()=>{
  for(const contas of [[],[{id:'a',ticket:'T303',valor:20,status:'Pendente'},{id:'b',ticket:'T303',valor:30,status:'Pendente'}]]){
    let opened=0;const messages=[];
    const env={CONTAS_PAGAR:contas,pagarContaRapido:()=>opened++,showToast:(m)=>messages.push(m)};
    runInNewContext(fnSource('abrirBaixaCompraNoFinanceiro','async function desmarcarCompraPaga(')+';abrirBaixaCompraNoFinanceiro("T303");',env);
    assert.equal(opened,0);
    assert.equal(messages.length,1);
  }
});

test('Contas a Pagar não abate automaticamente créditos disponíveis; banco pode ser escolhido',async()=>{
  const {advanceOptions}=await import('../web/modules/payables/domain/payment.ts');
  const options=advanceOptions({fornCod:'F675',ticket:'T303',advances:[{status:'Pendente',valor:35},{status:'Pendente',valor:15},{status:'Pendente',valor:99,ticket:'T999'},{status:'Quitado',valor:7}]},50);
  assert.deepEqual(options,{available:50,limit:50,blocked:1});
  const dialog=readFileSync(new URL('../web/modules/payables/ui/PaymentDialogs.tsx',import.meta.url),'utf8');
  assert.match(dialog,/advance: '0',/,'abre sem abater crédito');
  assert.match(dialog,/Crédito disponível: \{money\(options\.available\)\}/);
  assert.match(dialog,/Para pagar só pelo banco, deixe 0/);
  assert.match(dialog,/id="erp-cp-pay-bank"/);
});

test('banco habilita quando a compensação é zero e desabilita só se não há débito',async()=>{
  const {bankDebit}=await import('../web/modules/payables/domain/payment.ts');
  assert.equal(bankDebit({total:'50',advance:'0'}),50);
  assert.equal(bankDebit({total:'50',advance:'50'}),0);
  assert.equal(bankDebit({total:'50,10',advance:'20,05'}),30.05);
  const dialog=readFileSync(new URL('../web/modules/payables/ui/PaymentDialogs.tsx',import.meta.url),'utf8');
  assert.match(dialog,/disabled=\{blocked \|\| cash === 0\}/);
});

