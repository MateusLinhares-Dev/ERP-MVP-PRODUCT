import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const extract=(a,b)=>{
  const start=code.indexOf(a),end=code.indexOf(b,start+a.length);
  assert.ok(start>=0 && end>start,`não encontrei ${a} -> ${b}`);
  return code.slice(start,end);
};
const json=value=>JSON.parse(JSON.stringify(value));
const saveAndDelete=extract('async function salvarLancBanco(cod){','function toggleCpfCnpj(fgId, tipo){');
const edit=extract('function _bancoValorMonetarioValido(valor){','function excluirAdiantamento(');
const apply=extract('function _bancoTirarLocal(id){','let _extratoBancoAberto=');

function setup(){
  const entries=[];
  const fields={
    'lb-data':'2026-10-24','lb-desc':'Depósito','lb-tipo':'Entrada','lb-valor':'125.45',
    'elb-data':'2026-10-25','elb-desc':'Depósito corrigido','elb-tipo':'Saída','elb-valor':'20.25'
  };
  const notifications=[];const calls=[];
  let statementRenders=0;
  const document={getElementById(id){return id in fields?{value:fields[id]}:null;}};
  const context={
    document,Math,Number,Date,Object,
    window:{erpBankLedger:{isoDate(v){return /^\d{4}-\d\d-\d\d$/.test(v)?v:'';}}},
    LANC_BANCO_DB:entries,CHQ_CTRL:{},ADT_POR_FORN:{},
    _bancoApi:async body=>{calls.push(json(body));return {};},
    verExtratoBanco(){statementRenders++;},
    confirm(){return true;},
    alert(message){notifications.push(message);},
    cm(){},showToast(){},
    esc(v){return String(v).replaceAll('"','&quot;');},
    om(){},
  };
  runInNewContext(edit+saveAndDelete,context);
  return {context,entries,fields,notifications,calls,statementRenders:()=>statementRenders};
}

test('lançamento manual vai ao servidor com data, descrição, tipo e valor, e redesenha o extrato',async()=>{
  const p=setup();
  await p.context.salvarLancBanco('BC-001');
  assert.deepEqual(p.calls,[{action:'add-entry',bankCode:'BC-001',entry:{data:'2026-10-24',descricao:'Depósito',tipo:'Entrada',valor:125.45}}]);
  assert.equal(p.entries.length,0,'a tela não inclui nada sozinha: aplica o que o servidor devolveu');
  assert.equal(p.statementRenders(),1);
});

test('edição e exclusão mandam a versão que a tela viu para o servidor recusar se mudou',async()=>{
  const p=setup();
  p.entries.push({id:'LB-1',bancoCod:'BC-001',data:'2026-10-24',descricao:'Depósito',tipo:'Entrada',valor:125.45});
  await p.context.salvarEditLancBanco('LB-1','BC-001');
  await p.context.excluirLancBanco('LB-1','BC-001');
  const expected={data:'2026-10-24',descricao:'Depósito',tipo:'Entrada',valor:125.45};
  assert.deepEqual(p.calls,[
    {action:'update-entry',id:'LB-1',expected,entry:{data:'2026-10-25',descricao:'Depósito corrigido',tipo:'Saída',valor:20.25}},
    {action:'delete-entry',id:'LB-1',expected},
  ]);
});

test('lançamento fora da precisão monetária não chega ao servidor',async()=>{
  const p=setup();
  p.fields['lb-valor']='12222222222222220000000000000000';
  await p.context.salvarLancBanco('BC-001');
  assert.equal(p.calls.length,0);
  assert.match(p.notifications.join(' '),/precisão em centavos/);
});

test('formulário de edição oferece tipos compatíveis e data ISO para input date',()=>{
  const markup=extract('function editLancBanco(id, cod){','async function salvarEditLancBanco(id, cod){');
  assert.match(markup,/value=\\?"Entrada\\?"/);
  assert.match(markup,/value=\\?"Saída\\?"/);
  assert.match(markup,/erpBankLedger\?\.isoDate\(l\.data\)/);
  assert.match(markup,/esc\(l\.descricao\|\|''\)/);
});

test('movimento de pagamento ou de adiantamento não é editado nem excluído pelo extrato',async()=>{
  const p=setup();
  p.entries.push({id:'LB-PG-1-abc',bancoCod:'BC-001',data:'24/10/2026',descricao:'Pagto: Luz',tipo:'Saida',valor:50,payableId:'CP1'});
  p.entries.push({id:'LB-A',bancoCod:'BC-001',data:'24/10/2026',descricao:'Adiantamento: CICLO',tipo:'Saida',valor:50});
  await p.context.excluirLancBanco('LB-PG-1-abc','BC-001');
  await p.context.salvarEditLancBanco('LB-A','BC-001');
  assert.equal(p.calls.length,0);
});

test('extrato marca como automático: pagamento, venda, recebimento, adiantamento e cheque compensado',()=>{
  const p=setup();
  p.context.CHQ_CTRL.C1={movBancoId:'LB-77'};
  const auto=m=>p.context._bancoMovimentoAutomatico(m);
  assert.equal(auto({id:'LB-PG-1'}),true);
  assert.equal(auto({id:'LB-VD-1'}),true);
  assert.equal(auto({id:'LB-CR-1'}),true);
  assert.equal(auto({id:'LB-CHQ-1'}),true);
  assert.equal(auto({id:'LB-77'}),true);
  assert.equal(auto({id:'LB-9',source:'advance'}),true);
  assert.equal(auto({id:'LB-9',descricao:'Tarifa'}),false);
  assert.match(code,/const travado=_bancoMovimentoAutomatico\(entry\);/);
});

test('resultado do servidor atualiza contas, extrato e cheques na tela sem F5',()=>{
  const banks=[{id:'BC1',cod:'BC-001',banco:'Sicredi'},{id:'BC2',cod:'BC-002',banco:'Itaú'}];
  const entries=[{id:'LB-1',bancoCod:'BC-002'},{id:'LB-2',bancoCod:'BC-001'}];
  const removed={banks:[],entries:[]};let renders=0,chequeRenders=0;
  const ctx={BANCOS_DB:banks,LANC_BANCO_DB:entries,CHQ_CTRL:{C1:{s:'A'},C2:{s:'C',movBancoId:'LB-2'}},_chqDel:{},
    _syncLancBanco:{remover(i){removed.entries.push(entries[i].id);entries.splice(i,1);}},
    _syncBancos:{remover(i){removed.banks.push(banks[i].id);banks.splice(i,1);}},
    window:{erpBankMovementAdded(m){const i=entries.findIndex(l=>l.id===m.id);if(i>=0)entries[i]=m;else entries.push(m);}},
    localStorage:{setItem(){}},renderBancos(){renders++;},rebuildBancosDropdowns(){},renderChequesCompensar(){chequeRenders++;}};
  runInNewContext(apply+';this.apply=_bancoAplicarResultado;',ctx);
  ctx.apply({action:'create-account',account:{id:'BC3',cod:'BC-003',banco:'Bradesco'}});
  ctx.apply({action:'update-account',account:{id:'BC2',cod:'BC-009',banco:'Itaú'},codeChange:{from:'BC-002',to:'BC-009',movedEntries:1}});
  assert.equal(JSON.stringify(banks.map(b=>b.cod)),JSON.stringify(['BC-001','BC-009','BC-003']));
  assert.equal(entries[0].bancoCod,'BC-009');
  ctx.apply({action:'add-entry',movement:{id:'LB-3',bancoCod:'BC-001'}});
  ctx.apply({action:'delete-entry',id:'LB-1'});
  ctx.apply({action:'clear-cheques',date:'17/11/2026',cleared:[{id:'C1',movBancoId:'LB-4'}],movements:[{id:'LB-4',bancoCod:'BC-001'}]});
  assert.equal(JSON.stringify(ctx.CHQ_CTRL.C1),JSON.stringify({s:'C',cd:'17/11/2026',movBancoId:'LB-4'}));
  ctx.apply({action:'reopen-cheque',id:'C2',removedMovementId:'LB-2'});
  assert.equal(JSON.stringify(ctx.CHQ_CTRL.C2),JSON.stringify({s:'A',cd:''}));
  ctx.apply({action:'delete-cheque',id:'C1',removedMovementId:'LB-4'});
  assert.equal(ctx.CHQ_CTRL.C1,undefined);assert.equal(ctx._chqDel.C1,true);
  ctx.apply({action:'delete-account',id:'BC3'});
  assert.equal(JSON.stringify(entries.map(l=>l.id)),JSON.stringify(['LB-3']));
  assert.equal(JSON.stringify(removed),JSON.stringify({banks:['BC3'],entries:['LB-1','LB-2','LB-4']}));
  assert.equal(renders,8);assert.equal(chequeRenders,3);
});
