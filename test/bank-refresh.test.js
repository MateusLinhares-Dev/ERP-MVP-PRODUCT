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
const saveAndDelete=extract('function salvarLancBanco(cod){','function toggleCpfCnpj(fgId, tipo){');
const edit=extract('function _bancoValorMonetarioValido(valor){','function _removerMovBancoDeAdiantamento(fornCod, a){');
const guard=extract('function _bancoValorMonetarioValido(valor){','function editLancBanco(id, cod){');

function setup(){
  const entries=[];
  const fields={
    'lb-data':'2026-10-24','lb-desc':'Depósito','lb-tipo':'Entrada','lb-valor':'125.45',
    'elb-data':'2026-10-25','elb-desc':'Depósito corrigido','elb-tipo':'Saída','elb-valor':'20.25'
  };
  const notifications=[];
  let renders=0,saves=0,statementRenders=0,total=100;
  const document={getElementById(id){return id in fields?{value:fields[id]}:null;}};
  const context={
    document,Math,Number,Date,
    window:{erpBankLedger:{isoDate(v){return /^\d{4}-\d\d-\d\d$/.test(v)?v:'';}}},
    LANC_BANCO_DB:entries,
    _syncLancBanco:{remover(index){entries.splice(index,1);}},
    saveBancos(){saves++;},
    renderBancos(){renders++;total=100+entries.reduce((sum,entry)=>sum+(entry.tipo==='Entrada'?1:-1)*entry.valor,0);},
    verExtratoBanco(){statementRenders++;},
    confirm(){return true;},
    alert(message){notifications.push(message);},
    cm(){},showToast(){},
    esc(v){return String(v).replaceAll('"','&quot;');},
    om(){},
  };
  runInNewContext(guard+saveAndDelete+edit,context);
  return {context,entries,fields,notifications,snapshot:()=>({renders,saves,statementRenders,total})};
}

test('lançamento atualiza imediatamente o saldo da lista sem F5',()=>{
  const p=setup();
  p.context.salvarLancBanco('BC-001');
  assert.equal(p.entries.length,1);
  assert.equal(p.snapshot().total,225.45);
  assert.equal(p.snapshot().renders,1);
  assert.equal(p.snapshot().statementRenders,1);
  assert.equal(p.snapshot().saves,1);
});

test('exclusão atualiza o saldo sem F5',()=>{
  const p=setup();
  p.context.salvarLancBanco('BC-001');
  p.context.excluirLancBanco(p.entries[0].id,'BC-001');
  assert.equal(p.entries.length,0);
  assert.equal(p.snapshot().total,100);
  assert.equal(p.snapshot().renders,2);
});

test('edição atualiza saldo e preserva tipos aceitos pelo extrato',()=>{
  const p=setup();
  p.context.salvarLancBanco('BC-001');
  const id=p.entries[0].id;
  p.context.salvarEditLancBanco(id,'BC-001');
  assert.equal(p.entries[0].tipo,'Saída');
  assert.equal(p.snapshot().total,79.75);
  assert.equal(p.snapshot().renders,2);
});

test('lançamento fora da precisão monetária não é persistido',()=>{
  const p=setup();
  p.fields['lb-valor']='12222222222222220000000000000000';
  p.context.salvarLancBanco('BC-001');
  assert.equal(p.entries.length,0);
  assert.equal(p.snapshot().saves,0);
  assert.equal(p.snapshot().renders,0);
  assert.match(p.notifications.join(' '),/precisão em centavos/);
});

test('formulário de edição oferece tipos compatíveis e data ISO para input date',()=>{
  const markup=extract('function editLancBanco(id, cod){','function salvarEditLancBanco(id, cod){');
  assert.match(markup,/value=\\?"Entrada\\?"/);
  assert.match(markup,/value=\\?"Saída\\?"/);
  assert.match(markup,/erpBankLedger\?\.isoDate\(l\.data\)/);
  assert.match(markup,/esc\(l\.descricao\|\|''\)/);
});
