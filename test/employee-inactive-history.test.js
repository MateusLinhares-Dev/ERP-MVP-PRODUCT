import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.template.html', import.meta.url), 'utf8');
const ux = fs.readFileSync(new URL('../public/modules/phase1/phase1-usability.js', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Trecho não encontrado: ${start} ... ${end}`);
  return src.slice(a, b);
};
const helpers = between('// Consulta histórica: a inativação nunca remove vínculos', 'function getFolhaMes(){');
const funcionarios = [
  {mat:'F001', nome:'FUNC ATIVO', cargo:'RH', status:'Ativo', sal:2200},
  {mat:'F002', nome:'FUNC INATIVO', cargo:'Fiscal', status:'Inativo', sal:2000},
  {mat:'F003', nome:'FUNC SEM HISTÓRICO', cargo:'RH', status:'Inativo', sal:2000},
];
const ponto = [
  {mat:'F001', tipo:'Falta', data:'10/10/2026', horas:8},
  {mat:'F002', tipo:'HE', data:'12/10/2026', horas:2},
];
const docFactory = (fields = {}) => {
  const nodes = new Map(Object.entries(fields).map(([k,v]) => [k, typeof v === 'object' && v !== null ? v : {value:v}]));
  return { document: {getElementById: id => nodes.get(id)||null}, nodes };
};
function makeContext({filters={}, folha={}}={}) {
  const {document, nodes} = docFactory({
    'tb-ponto':{innerHTML:''},
    'tb-folha':{innerHTML:''},
    'tb-vales':{innerHTML:''},
    'tb-epi':{innerHTML:''},
    'ponto-mes':{value:'2026-10'},
    'folha-mes':{value:'2026-10'},
    'ponto-situacao':{value:'ativos'},
    'folha-situacao':{value:'ativos'},
    'vales-situacao':{value:'ativos'},
    'epi-situacao':{value:'ativos'},
    'folha-historico-aviso':{hidden:true},
    'epi-fil-func':{value:'',innerHTML:''},
    'epi-fil-mes':{value:''},
    ...filters,
  });
  const messages=[];
  const ctx=vm.createContext({
    document, FUNCIONARIOS:structuredClone(funcionarios),
    PONTO_DB:structuredClone(ponto), PONTO_BATIDAS_DB:[], FOLHA_DB:folha,
    VALES_DB:[{mat:'F001',data:'11/10/2026',valor:30},{mat:'F002',data:'11/10/2026',valor:40}],
    EPI_DB:[{id:'EP1',mat:'F001',data:'15/10/2026',epi:'Luva'},{id:'EP2',mat:'F002',data:'18/10/2026',epi:'Óculos'}],
    VIAGEM_DB:[], ERP_BUSINESS_CONFIG:{employeeBenefits:{}},
    _numFinito:(x,fallback=0)=>Number(x)||fallback,
    _diasUteisNoMes:()=>22,
    _syncPonto:{limparDuplicatasExatas:()=>false,remover:()=>{throw Error('não permitido apagar') }},
    esc:s=>String(s ?? ''), fmtDate:v=>v, _fmtDataBR:v=>v,
    showToast:(...args)=>messages.push(args), alert:m=>messages.push(['alert',m]),
    confirm:()=>true,saveDB:()=>{throw Error('salvamento inesperado')},
    localStorage:{setItem:()=>{}}, fbSalvar:()=>{}, renderTbFuncionarios:()=>{},
    EPI_HELPER_STUB:null,
  });
  vm.runInContext(helpers,ctx);
  return {ctx,nodes,messages};
}

test('Ponto: ativo é padrão, inativo apenas no histórico do mês com registros, sem apagar dados',()=>{
  const {ctx,nodes}=makeContext();
  vm.runInContext(between('function renderPontoTab(){','function _popularSelectPontoFuncionarios(){'),ctx);
  vm.runInContext('renderPontoTab()',ctx);
  assert.match(nodes.get('tb-ponto').innerHTML,/FUNC ATIVO/);
  assert.doesNotMatch(nodes.get('tb-ponto').innerHTML,/FUNC INATIVO/);
  assert.equal(ctx.PONTO_DB.length,2);
  nodes.get('ponto-situacao').value='inativos';
  vm.runInContext('renderPontoTab()',ctx);
  assert.match(nodes.get('tb-ponto').innerHTML,/FUNC INATIVO/);
  assert.doesNotMatch(nodes.get('tb-ponto').innerHTML,/FUNC SEM HISTÓRICO|FUNC ATIVO/);
  assert.match(nodes.get('tb-ponto').innerHTML,/Somente leitura/);
  assert.doesNotMatch(nodes.get('tb-ponto').innerHTML,/excluirPontoFunc/);
  nodes.get('ponto-mes').value='2026-09';
  vm.runInContext('renderPontoTab()',ctx);
  assert.match(nodes.get('tb-ponto').innerHTML,/Nenhum registro de ponto/);
  assert.equal(ctx.PONTO_DB.length,2);
});

test('Folha: inativos entram somente no filtro histórico e em modo de leitura',()=>{
  const {ctx,nodes}=makeContext({folha:{'2026-10-F002':{adicional:50,abono:0}}});
  vm.runInContext(between('function getFolhaMes(){','function setFolhaValor('),ctx);
  vm.runInContext(between('function renderFolha(){','function verCustoAnual(){'),ctx);
  vm.runInContext('renderFolha()',ctx);
  assert.match(nodes.get('tb-folha').innerHTML,/FUNC ATIVO/);
  assert.doesNotMatch(nodes.get('tb-folha').innerHTML,/FUNC INATIVO/);
  nodes.get('folha-situacao').value='inativos';
  vm.runInContext('renderFolha()',ctx);
  const table=nodes.get('tb-folha').innerHTML;
  assert.match(table,/FUNC INATIVO/);
  assert.doesNotMatch(table,/FUNC SEM HISTÓRICO|FUNC ATIVO/);
  assert.match(table,/Somente leitura/);
  assert.doesNotMatch(table,/<input|excluirFuncionario|toggleInativarFunc/);
  assert.equal(nodes.get('folha-historico-aviso').hidden,false);
});

test('Vales: registros antigos preservados, com consulta sem edição/exclusão',()=>{
  const {ctx,nodes}=makeContext();
  vm.runInContext(between('function _valeMesChave(v){','function _valeReciboHtml('),ctx);
  vm.runInContext(between('function renderVales(){','function salvarPontoLancamento(){'),ctx);
  vm.runInContext('renderVales()',ctx);
  assert.match(nodes.get('tb-vales').innerHTML,/FUNC ATIVO/);
  assert.doesNotMatch(nodes.get('tb-vales').innerHTML,/FUNC INATIVO/);
  nodes.get('vales-situacao').value='inativos';
  vm.runInContext('renderVales()',ctx);
  assert.match(nodes.get('tb-vales').innerHTML,/FUNC INATIVO/);
  assert.match(nodes.get('tb-vales').innerHTML,/Somente leitura/);
  assert.doesNotMatch(nodes.get('tb-vales').innerHTML,/excluirVale|editVale/);
  assert.equal(ctx.VALES_DB.length,2);
});

test('EPI: histórico preservado, sem ações de exclusão para inativos',()=>{
  const {ctx,nodes}=makeContext();
  vm.runInContext(between('function renderEpi(){','function novoEpiModal('),ctx);
  vm.runInContext('renderEpi()',ctx);
  assert.match(nodes.get('tb-epi').innerHTML,/FUNC ATIVO/);
  assert.doesNotMatch(nodes.get('tb-epi').innerHTML,/FUNC INATIVO/);
  nodes.get('epi-situacao').value='inativos';
  vm.runInContext('renderEpi()',ctx);
  const table=nodes.get('tb-epi').innerHTML;
  assert.match(table,/FUNC INATIVO/);
  assert.match(table,/Somente leitura/);
  assert.doesNotMatch(table,/excluirEpi|epiAssinarModal/);
  assert.equal(ctx.EPI_DB.length,2);
});

test('Exclusão permanente é bloqueada quando há histórico',()=>{
  const {ctx,messages}=makeContext();
  ctx.renderTbFuncionarios=()=>{throw Error('não deveria renderizar')};
  vm.runInContext(between('function excluirFuncionario(mat){','function salvarNovoFuncionario(){'),ctx);
  vm.runInContext("excluirFuncionario('F002')",ctx);
  assert.equal(ctx.FUNCIONARIOS.length,3);
  assert.match(String(messages.at(-1)?.[1]),/Inative-o em vez de excluir/);
});

test('Novos lançamentos só apresentam funcionários ativos; seletores históricos não são removidos',()=>{
  for (const id of ['ponto-situacao','folha-situacao','vales-situacao','epi-situacao']){
    assert.match(html,new RegExp(`id="${id}"`));
  }
  assert.match(ux,/ponto-cartao-func/);
  assert.match(ux,/epi-fil-func/);
  assert.match(src,/Funcionário inativo\. Novos lançamentos são bloqueados/);
  assert.match(src,/não é permitido registrar nova entrega/);
  assert.match(src,/function fecharFolha\(\)/);
  assert.match(src,/const lista=FUNCIONARIOS\.filter\(_erpFuncionarioAtivo\)/);
});

test('Exclusão de ponto é restrita ao mês selecionado e não apaga históricos anteriores',()=>{
  const {ctx,nodes}=makeContext();
  ctx.PONTO_DB.push({mat:'F001',tipo:'HE',data:'21/09/2026',horas:1});
  let writes=0;
  ctx._syncPonto.remover=(index)=>ctx.PONTO_DB.splice(index,1);
  ctx.saveDB=()=>writes++;
  ctx.renderPontoTab=()=>{};
  vm.runInContext(between('function excluirPontoFunc(mat){','function adtTipoTab('),ctx);
  vm.runInContext("excluirPontoFunc('F001')",ctx);
  assert.equal(writes,1);
  assert.deepEqual(ctx.PONTO_DB.filter(x=>x.mat==='F001').map(x=>x.data),['21/09/2026']);
  vm.runInContext("excluirPontoFunc('F002')",ctx);
  assert.equal(ctx.PONTO_DB.filter(x=>x.mat==='F002').length,1);
  assert.equal(nodes.get('ponto-mes').value,'2026-10');
});

test('Fechamento da folha não pode ser disparado na consulta histórica',()=>{
  const {ctx,messages}=makeContext({filters:{'folha-situacao':{value:'inativos'}}});
  vm.runInContext(between('function fecharFolha(){','function renderFolha(){'),ctx);
  vm.runInContext('fecharFolha()',ctx);
  assert.match(messages.at(-1)[0],/Selecione Ativos para fechar/);
});

test('Não permite nova entrega de EPI para funcionário inativo',()=>{
  const {ctx,nodes,messages}=makeContext({filters:{
    'ei-func':{value:'F002'},'ei-epi':{value:'Luva'},'ei-data':{value:'2026-10-25'},
  }});
  vm.runInContext(between('function salvarEpiEntrega(){','function excluirEpi(id){'),ctx);
  vm.runInContext('salvarEpiEntrega()',ctx);
  assert.equal(ctx.EPI_DB.length,2);
  assert.match(messages.at(-1)[0],/Funcionário inativo/);
  assert.equal(nodes.get('ei-func').value,'F002');
});

test('Histórico considera datas ISO e brasileiras, inclusive status desligado',()=>{
  const {ctx}=makeContext();
  assert.equal(vm.runInContext("_erpRegistroMes('05/10/2026','2026-10')",ctx),true);
  assert.equal(vm.runInContext("_erpRegistroMes('2026-10-05','2026-10')",ctx),true);
  assert.equal(vm.runInContext("_erpRegistroMes('05/09/2026','2026-10')",ctx),false);
  assert.equal(vm.runInContext("_erpFuncionarioAtivo({status:'Desligado'})",ctx),false);
  assert.equal(vm.runInContext("_erpFuncionarioAtivo({status:'Ativo'})",ctx),true);
  assert.equal(vm.runInContext("_erpFuncionarioAtivo({status:'Ativo', ativo:false})",ctx),false);
});

test('Fluxos alternativos de EPI em Phase 1 / Phase 2 também bloqueiam inativos',()=>{
  const phase1=fs.readFileSync(new URL('../public/modules/phase1/phase1-operations.js',import.meta.url),'utf8');
  const phase2=fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
  assert.match(phase1,/activeEmployee\(employee\)/);
  assert.match(phase1,/activeEmployee\(\(FUNCIONARIOS\|\|\[\]\)\.find\(f=>f&&f\.mat===value\('ei-func'\)\)\)/);
  assert.match(phase2,/if\(!activeEmployee\(emp\)\)/);
  assert.match(phase2,/Histórico de funcionário inativo: somente leitura/);
});
