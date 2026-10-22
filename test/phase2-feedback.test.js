import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const js=fs.readFileSync(path.join(root,'public/modules/phase2/phase2-feedback.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/modules/phase2/phase2-feedback.css'),'utf8');
const boot=fs.readFileSync(path.join(root,'public/app/bootstrap.js'),'utf8');

function has(...parts){for(const p of parts) assert.ok(js.includes(p),`Esperado no phase2-feedback.js: ${p}`);}

test('bootstrap carrega a revisão de homologação depois da Fase 1',()=>{
  assert.ok(boot.includes("loadStyle('/modules/phase2/phase2-feedback.css')"));
  assert.ok(boot.includes("loadClassic('/modules/phase2/phase2-feedback.js')"));
  assert.ok(boot.indexOf('/modules/phase2/phase2-feedback.js')>boot.indexOf('/modules/phase1/phase1-fiscal-admin.js'));
});

test('histórico de Compra de Sucata permite editar observação do material',()=>{
  has('enhancePurchaseHistory','phase2PurchaseObsSave','Observação deste material');
});

test('multibanco permanece apenas em Clientes e não estoura o modal',()=>{
  has("#tb-fornecedores-list .phase1-party-bank-btn");
  assert.ok(css.includes('.phase1-bank-row{grid-template-columns:minmax(0,1.2fr)'));
  assert.ok(css.includes('.phase1-bank-row input{min-width:0'));
});

test('inputs numéricos não exibem spinners nativos',()=>{
  has('removeNumberSpinners','phase2-no-spinner');
  assert.ok(css.includes('::-webkit-inner-spin-button'));
  assert.ok(css.includes('-moz-appearance:textfield'));
});

test('preços possuem busca por pessoa e material',()=>{
  has('phase2-price-party-search','phase2-price-material-search','tab-precos_fornecedores','tab-precos_clientes');
});

test('cheques usam os campos reais b/n e detectam lacunas e duplicidades',()=>{
  has("c?.n||c?.num","c?.b||c?.banco",'chequeSequenceByBank','Você está pulando','Esse número de cheque já existe neste banco');
  assert.ok(js.includes('Números faltantes'));
  assert.ok(js.includes('sincronizar aba antiga'));
});

test('busca de cheque não rerenderiza a tela a cada caractere',()=>{
  has('phase2FilterChequeRows','search.removeAttribute(\'oninput\')');
  assert.ok(js.includes("global.chqSetBusca=function(v){try{_chqFbusca=norm(v);}catch(e){}phase2FilterChequeRows(v);}"));
});

test('Contas pessoais da dona ficam separadas do Contas a Pagar empresarial',()=>{
  has('contas_dona','Contas Pessoais da Dona','ownerBills','fixedPayables','phase2OpenOwnerBills');
  assert.ok(!fs.readFileSync(path.join(root,'public/modules/phase1/phase1-finance.js'),'utf8').includes('ensureFixedAccounts();\n  ensureSimplePayables();'));
});

test('Adiantamentos explicam compra relacionada e destacam histórico',()=>{
  has('Compra relacionada (opcional)','Histórico / quitados','phase2-adt-intro');
});

test('Almoxarifado e EPI usam fluxo único com estoque real e quantidade inteira',()=>{
  has('isDiscreteItem','isEpiItem','phase2AlxEpiOpen','epiInventory','Não existe segunda baixa','repairDiscreteStocks');
  assert.ok(js.includes("filter(x=>isEpiItem(x)&&Number(x.qtd||0)>0)"));
  assert.ok(js.includes('Number.isInteger(qty)'));
});

test('EPI mostra somente histórico do funcionário selecionado e permite editar',()=>{
  has("filter(e=>e&&e.mat===mat)",'phase2EpiEditRecord','phase2EpiSaveRecord');
});

test('Frota e viagens recebem visual orientado a histórico e etapas',()=>{
  has('p2-frota-timeline','Todos os status','phase2DateKey','phase2-step','phase2-trip-history-cards','Ver tabela detalhada','v.totalRefeicoes','v.totalDiarias','v.acertoDevolucao');
});

test('Fiscal possui cadastro independente completo e lançamento usa somente cadastro fiscal',()=>{
  has('fiscalParties','Inscrição Estadual','Indicador IE','SUFRAMA','Regime tributário','E-mail para NF-e / XML','Código IBGE Município','phase2FiscalOnly');
  has('bindFiscalModal','Fornecedores Fiscais','Clientes Fiscais','legacyFiscalConfigPessoa','legacyFiscalPopularPessoas');
});

test('Administração cobre renomear contrato, consolidar Casa Glória e limpar despesas',()=>{
  has('phase2ContractRename','arquivoNome','casa gloria','switchDespTab(\'extrato\')');
});

test('Coordenação exclui inativos, restaura tipos e explica bags',()=>{
  has('filterCoordFunctionCards','DDS — Diálogo Diário de Segurança','não é necessário cadastrar em outra tela','Fornecedor de origem','Registrar retorno ao fornecedor');
});


test('Contas da Dona não depende da permissão de uma tab inexistente no legado',()=>{
  assert.ok(js.includes("global.phase2OpenOwnerBills=function()"));
  assert.ok(!js.includes("switchTab('contas_dona');renderOwnerBills()"));
});

test('viagem usa os campos reais persistidos pelo legado e pela Fase 1',()=>{
  has('v.totalRefeicoes','v.gastosExtras','v.dinheiroAlim','v.totalDiarias','v.acertoDevolucao');
  assert.ok(css.includes('.phase2-trip-history-item .settle.warn b'));
});

test('fiscal reaplica a fonte fiscal mesmo se o legado tentar popular pessoas novamente',()=>{
  has('global.fiscalConfigurarPessoa=function','global.fiscalPopularPessoas=function','phase2FiscalOnly');
});
