import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeEmployeeCompanies} from '../server/modules/company/index.ts';


const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const master=readFileSync(new URL('../public/modules/master-data/master-data-forms.js',import.meta.url),'utf8');
const template=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const print=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');

function pointContext(batidas,manual=[]){
  const start=core.indexOf('function _pontoMinutosRHiD(');
  const end=core.indexOf('function renderPontoTab(){',start);
  const context={PONTO_BATIDAS_DB:batidas,PONTO_DB:manual,_erpRegistroMes:(data,mes)=>String(data||'').slice(6)+'-'+String(data||'').slice(3,5)===mes};
  runInNewContext(core.slice(start,end),context);
  return context;
}

test('cadastro de empresas de RH remove duplicatas inclusive nomes com acento',()=>{
  assert.deepEqual(Array.from(normalizeEmployeeCompanies(['Manuela Metais','Física','Fisica',' Mabor ','Gratus'])),['Manuela Metais','Física','Mabor','Gratus']);
});

test('cadastro oferece criar empresa sem excluir formulário e exige API admin',()=>{
  assert.match(master,/gerenciarEmpresasFuncionarios\(\)/);
  assert.match(template,/gerenciarEmpresasFuncionarios\(\)/);
  assert.match(core,/employee-company-ov/);
  assert.match(core,/\/api\/admin\/employee-companies/);
  assert.match(core,/_erpAplicarCadastroEmpresas\(result\)/);
});

test('novos vales e lançamentos não listam funcionários inativos por rescisão',()=>{
  assert.match(core,/FUNCIONARIOS\.filter\(f=>_erpFuncionarioAtivo\(f\)\)\.map\(f=>`<option value/);
  assert.match(core,/FUNCIONARIOS\.filter\(_erpFuncionarioAtivo\)\.map\(f=>`<option value/);
  assert.match(core,/var ativos=\(FUNCIONARIOS\|\|\[\]\)\.filter\(f=>_erpFuncionarioAtivo\(f\)\)/);
});

test('vales mantêm ordenação por criação, seleção por ID e confirmação após Firebase',()=>{
  assert.match(core,/createdB-createdA\|\|db-da/);
  assert.match(core,/function valeGerarReciboPorId\(id\)/);
  assert.match(core,/function valeAssinarPorId\(id\)/);
  assert.match(core,/function valeIndicePorId\(encoded\)/);
  assert.match(core,/marcarConfirmado:marcarConfirmado/);
  assert.match(core,/ref\('erp\/vales'\)\.once\('value'\)/);
  assert.match(core,/renderVales\(\);cm\(\);showToast\('Vale registrado e confirmado/);
});

test('horas extras importadas são somadas por funcionário e mês',()=>{
  const point=pointContext([
    {mat:'F001',data:'01/10/2026',extrasTotal:'02:01'},
    {mat:'F001',data:'02/10/2026',extrasTotal:'01:36'},
    {mat:'F002',data:'01/10/2026',extrasTotal:'01:00'},
    {mat:'F001',data:'04/11/2026',extrasTotal:'20:00'}
  ]);
  const r=point._pontoResumoMensal('F001','2026-10');
  assert.equal(r.minutosExtras,217);
  assert.equal(point._pontoFormatarHoras(r.minutosExtras),'3h37');
  assert.equal(r.faltas,0);
});

test('importação conta ocorrência de falta parcial sem tratar como dia integral',()=>{
  const point=pointContext([
    {mat:'F001',data:'01/10/2026',observacao:'Falta',ent1:'',sai1:'',ent2:'',sai2:'',faltaAtraso:'08:00'},
    {mat:'F001',data:'02/10/2026',observacao:'Falta',ent1:'07:48 (C)',sai1:'12:00 (C)',faltaAtraso:'04:00'}
  ]);
  const r=point._pontoResumoMensal('F001','2026-10');
  assert.equal(r.faltas,2);
  assert.equal(r.faltasIntegrais,1);
  assert.equal(r.minutosFalta,720);
  assert.equal(point._pontoFormatarHoras(r.minutosFalta),'12h00');
});

test('ponto não duplica horas extras em dia com lançamento manual',()=>{
  const point=pointContext([{mat:'F001',data:'01/10/2026',extrasTotal:'03:00'}],[{mat:'F001',data:'01/10/2026',tipo:'HE',horas:1.5}]);
  assert.equal(point._pontoResumoMensal('F001','2026-10').minutosExtras,90);
});

test('pedido de compra aumenta letras dos itens no impresso e adapta celular',()=>{
  assert.match(print,/\.items,\.installments\{[^}]*font-size:14px/);
  assert.match(print,/@media screen and \(max-width:850px\)/);
  assert.match(print,/\.print-totals\{[^}]*font-size:13px/);
});

test('recibo identifica o vale correto mesmo após a lista mudar de ordem',()=>{
  const fragment=core.slice(core.indexOf('function valeIndicePorId('),core.indexOf('function salvarPontoLancamento(){'));
  const context={VALES_DB:[{id:'VL01',mat:'F001'},{id:'VL02',mat:'F002'}],showToast(){},valeGerarRecibo(i){context.receipt=context.VALES_DB[i].id;},valeAssinarModal(){},editVale(){},excluirVale(){}};
  runInNewContext(fragment,context);
  context.VALES_DB.unshift({id:'VL00',mat:'F003'});
  context.valeGerarReciboPorId('VL02');
  assert.equal(context.receipt,'VL02');
});

test('marcação transitória preserva vale confirmado se chegar snapshot atrasado',()=>{
  const begin=core.indexOf('function _criarSincroniaPorChave(');
  const finish=core.indexOf('return { deletedSet:deletedSet',begin);
  const end=core.indexOf('\n}',finish)+2;
  const context={localStorage:{getItem:()=>null,setItem(){}},window:{_fbDB:null},_idsDeArrayOuObjeto:()=>[],Date};
  runInNewContext(core.slice(begin,end)+'\nthis.makeSync=_criarSincroniaPorChave;',context);
  const list=[{id:'VL2026',mat:'F001',valor:750}];
  const sync=context.makeSync('vales',list,'VL');
  sync.marcarConfirmado('VL2026');
  sync.carregarDeRemoto({OTHER:{id:'OTHER',mat:'F002',valor:100}},true);
  assert.equal(list.length,2);
  assert.ok(list.some(v=>v.id==='VL2026'));
  sync.carregarDeRemoto({VL2026:{id:'VL2026',mat:'F001',valor:750},OTHER:{id:'OTHER',mat:'F002',valor:100}},true);
  assert.equal(list.filter(v=>v.id==='VL2026').length,1);
});
