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
  runInNewContext(fnSource('abrirBaixaCompraNoFinanceiro','function marcarCompraPaga(')+';abrirBaixaCompraNoFinanceiro("T303");',env);
  assert.deepEqual(calls,[{idx:0,id:'CP-T303'}]);
  assert.equal(payable.status,'Pendente');
  assert.equal(payable.valor,50);
  assert.equal(messages.length,0);
});

test('Histórico não dá baixa nem altera dados se a conta não existe ou houver duas contas',()=>{
  for(const contas of [[],[{id:'a',ticket:'T303',valor:20,status:'Pendente'},{id:'b',ticket:'T303',valor:30,status:'Pendente'}]]){
    let opened=0;const messages=[];
    const env={CONTAS_PAGAR:contas,pagarContaRapido:()=>opened++,showToast:(m)=>messages.push(m)};
    runInNewContext(fnSource('abrirBaixaCompraNoFinanceiro','function marcarCompraPaga(')+';abrirBaixaCompraNoFinanceiro("T303");',env);
    assert.equal(opened,0);
    assert.equal(messages.length,1);
  }
});

test('Contas a Pagar não abate automaticamente créditos disponíveis; banco pode ser escolhido',()=>{
  const start=core.indexOf('function pagarContaRapido(');
  const end=core.indexOf('function atualizarLiquidoCP(',start);
  assert.ok(start>=0&&end>start);
  const body={className:'',innerHTML:'',dataset:{},querySelectorAll:()=>[]};
  const elements={
    'modal-body':body,
    'modal-ov':{classList:{add(){}}},
    'btn-so-compensar':{addEventListener(){}},
    'btn-pagar-tudo':{addEventListener(){}}
  };
  const env={
    _numFinito:(n,d)=>Number.isFinite(Number(n))?Number(n):d,
    _cpIdxPorId:()=>0,
    CONTAS_PAGAR:[{id:'CP-T303',ticket:'T303',fornCod:'F675',valor:50,status:'Pendente',desc:'Compra T303'}],
    ADT_POR_FORN:{F675:[{status:'Pendente',valor:35},{status:'Pendente',valor:15}]},
    TICKETS_DB:{},FORNECEDORES:[],document:{getElementById:(id)=>elements[id]||null},
    crypto:{randomUUID:()=> 'aaaa-bbbb'},esc:(v)=>String(v),
    _cpConsultarContasBancarias(){},atualizarLiquidoCP(){},
  };
  runInNewContext('const _cpPendingPayments=new Map();'+core.slice(start,end)+';pagarContaRapido(0,"CP-T303");',env);
  assert.match(body.innerHTML,/id="pcp-adt"[^>]*value="0\.00"/);
  assert.match(body.innerHTML,/Crédito disponível: R\$ 50,00/);
  assert.match(body.innerHTML,/Para pagar pelo banco, mantenha 0,00/);
  assert.match(body.innerHTML,/id="pcp-banco"/);
});


test('banco habilita quando a compensação é zero e desabilita só se não há débito',()=>{
  const src=fnSource('atualizarLiquidoCP','async function confirmarPagarCP(');
  const bank={value:'',disabled:true,options:[{value:''},{value:'BC-005'}],dataset:{}};
  const adt={value:'0'},total={value:'50'},label={textContent:''};
  const elements={'pcp-adt':adt,'pcp-valor-pagar':total,'pcp-banco':bank,'pcp-liquido-label':label};
  const env={document:{getElementById:id=>elements[id]||null}};
  runInNewContext(src+';atualizarLiquidoCP(50);',env);
  assert.equal(bank.disabled,false);
  assert.match(label.textContent,/50,00/);
  adt.value='50';
  runInNewContext(src+';atualizarLiquidoCP(50);',env);
  assert.equal(bank.disabled,true);
  assert.match(label.textContent,/0,00/);
});
