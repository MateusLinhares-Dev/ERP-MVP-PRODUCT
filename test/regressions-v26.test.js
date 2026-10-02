import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const sync=fs.readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');

function between(src,a,b){
  const i=src.indexOf(a); assert.ok(i>=0,`missing ${a}`);
  const j=src.indexOf(b,i+a.length); assert.ok(j>i,`missing ${b}`);
  return src.slice(i,j);
}

test('v26 Modo Balança Tablet existe no DOM principal e não dentro do HTML de impressão',()=>{
  assert.match(html,/id="modo-balanca-overlay"/);
  assert.doesNotMatch(core,/<div id="modo-balanca-overlay">/);
  assert.match(core,/function abrirModoBalanca\(\)[\s\S]*getElementById\('modo-balanca-overlay'\)/);
});

test('v26 Balanceiro tem um único branch funcional e recebe tickets em tempo real sem F5',()=>{
  assert.equal((core.match(/else if\(tid==='balanceiro'\)/g)||[]).length,1);
  assert.match(core,/tid==='balanceiro'[\s\S]*renderBalanceiro\(\)[\s\S]*balAtualizarTicketsDoBanco\(\)/);
  assert.match(sync,/ref\('erp\/tickets'\)\.on\('value'/);
  assert.match(sync,/renderBalanceiro\(\)/);
});

test('v26 Compra/Venda usam data local de calendário',()=>{
  const compra=between(core,'function buildCompraForm(){','function addCompraRow(){');
  const venda=between(core,'function buildVendaForm(){','function addVendaRow(){');
  assert.match(compra,/id="c-data"[^>]*value="\$\{_hojeISO\(\)\}"/);
  assert.match(venda,/id="v-data"[^>]*value="\$\{_hojeISO\(\)\}"/);
});

test('v26 preço por cliente é aplicado automaticamente na venda sem sobrescrever valor manual positivo',()=>{
  assert.match(core,/function _precoClienteVenda\(/);
  assert.match(core,/function aplicarPrecoClienteVendaRow\(/);
  assert.match(core,/preco>0 && \(force \|\| atual<=0\)/);
  assert.match(core,/onchange="aplicarPrecoClienteVendaRow\(\$\{n\},false\);calcVenda/);
  assert.match(core,/function vClienteInfo\(\)[\s\S]*aplicarPrecosClienteVenda\(\)/);
});

test('v26 cheque sugere cliente cadastrado e Ficha do Cliente lê vínculo explícito do controle',()=>{
  assert.match(core,/id="chqm-c" list="chqm-clientes-list"/);
  assert.match(core,/obj\.clienteNome=_cliObj\.nome/);
  const fc=between(core,'function _fcMovimentos(cli){','function _fcTotais(cli){');
  assert.match(fc,/Object\.values\(CHQ_CTRL\|\|\{\}\)/);
  assert.match(fc,/c\.clienteNome===cli/);
});

test('v26 bancos atualizam do RTDB após criar e snapshot restaura por substituição exata',()=>{
  assert.match(core,/async function recarregarBancosDoBanco\(\)/);
  assert.match(core,/__businessRepository\.read\('bancos'\)/);
  assert.match(core,/await window\.__businessRepository\.upsert\('bancos',novo\.id,novo\)/);
  assert.match(core,/async function restaurarSnapshot\(dataKey\)/);
  assert.match(core,/api\/admin\/snapshots/);
  assert.match(core,/bancosDeletedV2/);
});

test('v26 Lançar Ponto repopula funcionários no momento de abrir o modal',()=>{
  const om=between(core,'function om(k){','function cm(){');
  assert.match(om,/k==='ponto_lancamento'/);
  assert.match(om,/getElementById\('pt-func'\)/);
  assert.match(om,/FUNCIONARIOS\|\|\[\]/);
});

test('v26 Fiscal sugere clientes/fornecedores e orientação PIS COFINS aponta Lançamento Mensal',()=>{
  assert.match(core,/function fiscalPopularPessoas\(\)/);
  assert.match(core,/id="ne-forn" list="fiscal-list-fornecedores"/);
  assert.match(core,/id="ns-cli" list="fiscal-list-clientes"/);
  assert.match(html,/id="fe-pessoa" list="fiscal-list-fornecedores"/);
  assert.match(core,/Lançamento Mensal antes de calcular o PIS\/COFINS/);
});

test('v26 Despesas Grupo e Contratos sugerem cadastros sem tirar entrada livre',()=>{
  const bf=between(core,'function buildFornList(){','function despCpStatus');
  assert.match(bf,/FORNECEDORES\|\|\[\]/);
  assert.match(bf,/FORNECEDORES_DESPESA/);
  assert.match(core,/function popularDatalistContrato\(\)/);
  assert.match(core,/setAttribute\('list','ct-forn-list'\)/);
});

test('v26 suporte não executa JavaScript arbitrário e renderiza corretamente ao abrir a aba',()=>{
  assert.doesNotMatch(core,/new Function\(/);
  assert.match(core,/Patches JavaScript remotos estão desativados por segurança/);
  assert.match(html,/Patches JavaScript remotos foram <strong>desativados por segurança<\/strong>/);
  assert.match(core,/if\(tid!=='chat'\)[\s\S]*if\(tid==='suporte_tecnico'\) renderSuporteTecnico\(\)/);
});

test('v26 preserva comportamentos legados: Vale não cria CP, Quem pediu continua livre, Config continua consulta',()=>{
  const vale=between(core,'function salvarValeFunc(){','function excluirVale');
  assert.doesNotMatch(vale,/CONTAS_PAGAR\.push/);
  assert.match(html,/id="lc-quem"/);
  assert.doesNotMatch(html,/id="lc-quem"[^>]*<select/);
  assert.match(html,/id="tab-config"/);
});
