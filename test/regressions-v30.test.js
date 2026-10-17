import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const vercel = JSON.parse(fs.readFileSync('vercel.json','utf8'));
const hml = fs.readFileSync('.env.hml.example','utf8');
const prod = fs.readFileSync('.env.production.example','utf8');
const ignore = fs.readFileSync('.vercelignore','utf8');
const configApi = fs.readFileSync('api/config.js','utf8');
const runtime = fs.readFileSync('server/config/runtime-security.js','utf8');
const guide = fs.readFileSync('docs/DEPLOY_LOCAL_HML_PROD_V30.md','utf8');
const verifier = fs.readFileSync('scripts/verify-deployment-artifacts.mjs','utf8');

test('v30 fixes Node 24 and Vercel build uses dist',()=>{
  assert.equal(pkg.engines.node,'24.x');
  assert.equal(vercel.buildCommand,'npm run build');
  assert.equal(vercel.outputDirectory,'dist');
  assert.equal(vercel.framework,null);
});

test('v30 keeps Preview/HML and Production isolated',()=>{
  assert.match(hml,/APP_ENV=homolog/);
  assert.match(prod,/APP_ENV=production/);
  assert.match(hml,/USE_FIREBASE_EMULATORS=false/);
  assert.match(prod,/USE_FIREBASE_EMULATORS=false/);
  assert.match(runtime,/Vercel Production deve usar APP_ENV=production/);
  assert.match(runtime,/Vercel Preview não pode apontar para APP_ENV=production/);
});

test('v30 server secrets are not part of browser config response',()=>{
  assert.match(configApi,/apiKey:/);
  assert.doesNotMatch(configApi,/serviceAccount:\s*process\.env/);
  assert.doesNotMatch(configApi,/LOGIN_RATE_LIMIT_SECRET/);
});

test('v30 excludes envs, service accounts and emulator fixtures from Vercel upload',()=>{
  for(const item of ['.env*','service-account*.json','scripts/dev-users.json','scripts/dev-materials.json','scripts/dev-business-data.json']) {
    assert.ok(ignore.includes(item), item);
  }
});

test('v30 release verifier scans dist for private keys and server secrets',()=>{
  assert.match(verifier,/PRIVATE KEY/);
  assert.match(verifier,/FIREBASE_SERVICE_ACCOUNT_B64/);
  assert.match(verifier,/LOGIN_RATE_LIMIT_SECRET/);
  assert.match(verifier,/outputDirectory/);
});

test('v30 deployment guide documents local HML prod and Vercel Functions split',()=>{
  assert.match(guide,/LOCAL/);
  assert.match(guide,/HML/);
  assert.match(guide,/PROD/);
  assert.match(guide,/Vercel Preview/);
  assert.match(guide,/Vercel Production/);
  assert.match(guide,/Vercel Functions/);
  assert.match(guide,/dist\//);
});

const appCoreV30 = fs.readFileSync('public/legacy/app-core.js','utf8');
const legacyStylesV30 = fs.readFileSync('public/legacy/styles.css','utf8');
const emulatorLauncherV30 = fs.readFileSync('scripts/emulators.mjs','utf8');
const vercelLauncherV30 = fs.readFileSync('scripts/vercel-dev.mjs','utf8');

test('v30 Balanceiro uses the canonical active supplier view and does not accept generic overwrite',()=>{
  const renderStart=appCoreV30.indexOf('function renderBalanceiro()');
  const renderEnd=appCoreV30.indexOf('function balFiltrar', renderStart);
  const renderBlock=appCoreV30.slice(renderStart,renderEnd>renderStart?renderEnd:renderStart+6000);
  assert.match(renderBlock,/getFornAtivos\(\)/);
  assert.doesNotMatch(renderBlock,/FORNECEDORES\.slice\(\)/);
  const popStart=appCoreV30.indexOf('function populateFornSelects()');
  const popEnd=appCoreV30.indexOf('function _fornBuscaResolverCod',popStart);
  const popBlock=appCoreV30.slice(popStart,popEnd);
  assert.doesNotMatch(popBlock,/['\"]bal-novo-forn['\"]/);
});

test('v30 Compra Sucata never treats missing financial totals as paid/NaN',()=>{
  const start=appCoreV30.indexOf('function renderTickets()');
  const end=appCoreV30.indexOf('// ── Save adiantamento',start);
  const block=appCoreV30.slice(start,end);
  assert.match(block,/Number\.isFinite/);
  assert.match(block,/Aguard\. Preço/);
  assert.match(block,/const totalCell=.*'—'/);
  assert.match(block,/const adtCell=.*'—'/);
  assert.match(block,/statusEspecial/);
});

test('v30 contains reproducible Docker local environment without changing cloud architecture',()=>{
  for(const file of ['Dockerfile','compose.yaml','firebase.docker.json','.dockerignore','docs/DOCKER_LOCAL_V30.md']){
    assert.equal(fs.existsSync(file),true,file);
  }
  const dockerfile=fs.readFileSync('Dockerfile','utf8');
  const compose=fs.readFileSync('compose.yaml','utf8');
  const firebaseDocker=fs.readFileSync('firebase.docker.json','utf8');
  assert.match(dockerfile,/node:24-/);
  assert.match(dockerfile,/openjdk-17-jre-headless/);
  assert.match(compose,/127\.0\.0\.1:3000:3000/);
  assert.match(compose,/erp_emulator_data/);
  assert.match(firebaseDocker,/"host": "0\.0\.0\.0"/);
  assert.match(emulatorLauncherV30,/DOCKER_DEV/);
  assert.match(vercelLauncherV30,/0\.0\.0\.0:3000/);
});

const firebaseSyncV30 = fs.readFileSync('public/legacy/firebase-sync.js','utf8');

test('v30 tank sync is keyed, tombstoned and keeps the shared array reference',()=>{
  assert.match(appCoreV30,/const _syncTanque = _criarSincroniaPorChave\('tanque', TANQUE_DB, 'TK'\)/);
  assert.match(appCoreV30,/_syncTanque\.remover\(idx\)/);
  assert.match(appCoreV30,/mm_tanque_pendente/);
  assert.match(appCoreV30,/TANQUE_DB\.length=0/);
  assert.doesNotMatch(appCoreV30,/TANQUE_DB=JSON\.parse\(tk2\)/);
  assert.match(firebaseSyncV30,/_patchIncremental\(dados, 'tanque', _syncTanque\.paraObjeto\(\), _syncTanque\.deletedSet\)/);
  assert.match(firebaseSyncV30,/tanqueDeleted: \[\.\.\._syncTanque\.deletedSet\]/);
  assert.match(firebaseSyncV30,/'tanqueDeletedV2'/);
});

test('v30 tank cloud state wins unless that module has an actual local pending change',()=>{
  assert.match(firebaseSyncV30,/function _tanqueTemPendenteLocal\(\)/);
  assert.match(firebaseSyncV30,/_syncTanque\.carregarDeRemoto\(remoto,!!confiavel&&!preservarLocal\)/);
  assert.match(firebaseSyncV30,/__ERP_TANK_LISTENER_STARTED__/);
  assert.match(firebaseSyncV30,/window\._fbDB\.ref\('erp\/tanque'\)/);
  assert.match(firebaseSyncV30,/window\._fbDB\.ref\('erp\/tanqueDeletedV2'\)/);
});

test('v30 never pushes a stale pending snapshot before reading the cloud',()=>{
  assert.match(firebaseSyncV30,/alterações locais pendentes — mesclando a nuvem antes de salvar/);
  assert.match(firebaseSyncV30,/_fbCarregarDaNuvem\(callback,true\)/);
  assert.doesNotMatch(firebaseSyncV30,/push em segundo plano, pull quando confirmar/);
  assert.doesNotMatch(firebaseSyncV30,/const _flushAntes = _fbTimer/);
  assert.match(firebaseSyncV30,/const _fbConf2 = !!d\._ts && !_temPendenteLocal/);
});

test('v30 reconnect does not blindly overwrite cloud and deletions are never skipped by write cache',()=>{
  const connectedStart=firebaseSyncV30.indexOf("window._fbDB.ref('.info/connected')");
  const connectedEnd=firebaseSyncV30.indexOf("window._fbDB.ref('erp/_ts')",connectedStart);
  const connectedBlock=firebaseSyncV30.slice(connectedStart,connectedEnd);
  assert.match(connectedBlock,/fbCarregar\(function\(\)\{\}\)/);
  assert.doesNotMatch(connectedBlock,/setTimeout\(_fbSalvarAgora/);
  assert.match(firebaseSyncV30,/if\(dados\[k\]===null\)\{ filtrado\[k\]=null; return; \}/);
});

test('v30 successful save only clears pending state when no newer change arrived',()=>{
  assert.match(firebaseSyncV30,/let _fbChangeVersion = 0/);
  assert.match(firebaseSyncV30,/_fbChangeVersion\+\+/);
  assert.match(firebaseSyncV30,/const _versaoSalvar=_fbChangeVersion/);
  assert.match(firebaseSyncV30,/const _semMudancaNova=_fbChangeVersion===_versaoSalvar/);
});


test('v30 inventory keeps every material condition as its own stock key',()=>{
  assert.match(appCoreV30,/const IDENT_SEPARA_ESTOQUE = new Set\(IDENT\)/);
  assert.match(appCoreV30,/function _materialEfetivoDoItem\(item\)/);
  assert.match(appCoreV30,/const matEstoque=_matEfetivoEstoque\(mat,id\)/);
  assert.match(appCoreV30,/const mat=_matEfetivoEstoque\(matBase,ident\)/);
  assert.match(appCoreV30,/itens\.push\(\{mat,matBase,ident,qt,pr,total:qt\*pr\}\)/);
});

test('v30 inventory resolves legacy purchase and sale items by material plus identifier',()=>{
  const entradasStart=appCoreV30.indexOf('function getEntradasMaterial(mat)');
  const entradasEnd=appCoreV30.indexOf('function _dedupeMetais()',entradasStart);
  const entradasBlock=appCoreV30.slice(entradasStart,entradasEnd);
  assert.match(entradasBlock,/_materialEfetivoDoItem\(it\)/);
  assert.match(entradasBlock,/_normalizarChaveMaterialEstoque/);
  const recuperarStart=appCoreV30.indexOf('function _recuperarMateriaisComMovimento');
  const recuperarEnd=appCoreV30.indexOf('function renderEstoque()',recuperarStart);
  const recuperarBlock=appCoreV30.slice(recuperarStart,recuperarEnd);
  assert.match(recuperarBlock,/_materialEfetivoDoItem\(it\)/);
  assert.doesNotMatch(recuperarBlock,/nomes\.add\(it\.matBase\)/);
});

test('v30 stock screen never consolidates LIMPO MISTO 100 percent or other forms',()=>{
  const renderStart=appCoreV30.indexOf('function renderEstoque()');
  const renderEnd=appCoreV30.indexOf('function excluirMaterial',renderStart);
  const renderBlock=appCoreV30.slice(renderStart,renderEnd);
  assert.doesNotMatch(renderBlock,/grupos/);
  assert.doesNotMatch(renderBlock,/formas/);
  assert.doesNotMatch(renderBlock,/_baseMaterial/);
  assert.match(renderBlock,/const materiais=\(METAIS\|\|\[\]\)/);
  assert.match(renderBlock,/getEntradasMaterial\(mat\)/);
  assert.match(renderBlock,/getSaidasMaterial\(mat\)/);
});

test('v30 supplier price editor clearly marks the row being edited by keyboard or mouse',()=>{
  const renderStart=appCoreV30.indexOf('function renderPrecosFornTab()');
  const renderEnd=appCoreV30.indexOf('function _hojeFormatado()',renderStart);
  const renderBlock=appCoreV30.slice(renderStart,renderEnd);
  assert.match(renderBlock,/id="pf-edit-context"/);
  assert.match(renderBlock,/class="price-edit-row"/);
  assert.match(renderBlock,/class="price-edit-input"/);
  assert.match(renderBlock,/class="price-edit-badge">EDITANDO/);
  assert.match(renderBlock,/onfocus="precoAtivarLinha\(this,'pf'\)"/);
  assert.match(renderBlock,/oninput="precoAtualizarContexto\(this,'pf'\)"/);
  assert.match(renderBlock,/onblur="precoDesativarLinha\(this,'pf'\)"/);
  assert.match(appCoreV30,/function precoAtivarLinha\(el,prefix\)/);
  assert.match(appCoreV30,/function precoAtualizarContexto\(el,prefix\)/);
  assert.match(appCoreV30,/function precoDesativarLinha\(el,prefix\)/);
  assert.match(appCoreV30,/linha '\+String\(idx\+1\)\+' de '/);
  assert.match(legacyStylesV30,/\.price-edit-row\.is-editing td/);
  assert.match(legacyStylesV30,/\.price-edit-row:focus-within td/);
  assert.match(legacyStylesV30,/\.price-edit-input:focus/);
  assert.match(legacyStylesV30,/box-shadow:inset 5px 0 0 var\(--accent\)/);
});


test('v30 purchase receipt snapshots and renders every advance and cheque that composes the deduction',()=>{
  const saveStart=appCoreV30.indexOf('function salvarCompra(');
  const saveEnd=appCoreV30.indexOf('function limparCompra',saveStart);
  const saveBlock=appCoreV30.slice(saveStart,saveEnd>saveStart?saveEnd:saveStart+30000);
  assert.match(saveBlock,/const _reciboAdiantamentos=pendentesAdt\.map/);
  assert.match(saveBlock,/const _reciboCheques=pendentesCheq\.map/);
  assert.match(saveBlock,/valorAplicado:_r2\(usado\)/);
  assert.match(saveBlock,/_detAdt\.valorPendente=_r2\(Math\.max\(0,vAdt-usado\)\)/);
  assert.match(saveBlock,/reciboFinanceiro:\{versao:1,total:_r2\(adtEfetivo\),adiantamentos:_reciboAdiantamentos,cheques:_reciboCheques\}/);

  assert.match(appCoreV30,/function _reciboFinanceiroDoTicket\(tk\)/);
  assert.match(appCoreV30,/function _abatimentosReciboRowsHtml\(tk,fmt,pad\)/);
  assert.match(appCoreV30,/Adiantamento não quitado/);
  assert.match(appCoreV30,/Cheque\$\{rotulo\} pendente/);
  assert.match(appCoreV30,/Adiantamento \/ saldo financeiro registrado no ticket/);
  assert.match(appCoreV30,/function _abatimentosReciboTexto\(tk,fmt\)/);

  const printStart=appCoreV30.indexOf('function imprimirCanhoto()');
  const printEnd=appCoreV30.indexOf('async function compartilharImagem()',printStart);
  const printBlock=appCoreV30.slice(printStart,printEnd);
  assert.match(printBlock,/_adtDescontadosRowsHtml\(tk,fmt\)/);
  assert.doesNotMatch(printBlock,/const adtsNaoQuit=/);

  const imageStart=appCoreV30.indexOf('async function compartilharImagem()');
  const imageEnd=appCoreV30.indexOf('function ',imageStart+20);
  const imageBlock=appCoreV30.slice(imageStart,imageEnd>imageStart?imageEnd:imageStart+16000);
  assert.match(imageBlock,/_adtDescontadosRowsHtml\(tk,fmt,7\)/);
  assert.doesNotMatch(imageBlock,/const adtsNaoQuit=/);
});

test('v30 cheque templates are local static assets and do not depend on SheetJS to download',()=>{
  assert.ok(fs.existsSync('public/templates/cheques_clientes.xlsx'));
  assert.ok(fs.existsSync('public/templates/controle_cheques.xlsx'));
  assert.match(appCoreV30,/function _baixarTemplateEstatico\(caminho,nome\)/);

  const cliStart=appCoreV30.indexOf('function downloadTemplateChequesCli()');
  const cliEnd=appCoreV30.indexOf('function salvarChequesCli()',cliStart);
  const cliBlock=appCoreV30.slice(cliStart,cliEnd);
  assert.match(cliBlock,/\/templates\/cheques_clientes\.xlsx/);
  assert.doesNotMatch(cliBlock,/_loadSheetJS/);
  assert.doesNotMatch(cliBlock,/XLSX\.writeFile/);

  const ctrlStart=appCoreV30.indexOf('function downloadTemplateCheques()');
  const ctrlEnd=appCoreV30.indexOf('function addCheqRow()',ctrlStart);
  const ctrlBlock=appCoreV30.slice(ctrlStart,ctrlEnd);
  assert.match(ctrlBlock,/\/templates\/controle_cheques\.xlsx/);
  assert.doesNotMatch(ctrlBlock,/_loadSheetJS/);
  assert.doesNotMatch(ctrlBlock,/XLSX\.writeFile/);
});

test('v30 personal cost area tab highlight follows the selected area in legacy and dynamic markup',()=>{
  const start=appCoreV30.indexOf('function _ccRenderAreaTabs()');
  const end=appCoreV30.indexOf('function ccSetArea(',start);
  const block=appCoreV30.slice(start,end);
  assert.match(block,/document\.getElementById\('cc-area-tabs'\)/);
  assert.match(block,/document\.getElementById\('cc-aba-'\+item\.name\)/);
  assert.match(block,/btn\.style\.borderBottomColor=ativo\?'#1a5e2a':'transparent'/);
  assert.match(block,/btn\.style\.color=ativo\?'#1a5e2a':'#999'/);
  assert.match(block,/aria-selected/);
});

test('v30 supplier advance value accepts pasted Brazilian currency without losing thousands',()=>{
  assert.match(appCoreV30,/id="adt-valor" type="text" inputmode="decimal"/);
  assert.match(appCoreV30,/onblur="_adtFormatValorPrincipal\(\)"/);
  const parserStart=appCoreV30.indexOf('function _adtParseVal(s)');
  const parserEnd=appCoreV30.indexOf('function _populateBancosSelects()',parserStart);
  const parserBlock=appCoreV30.slice(parserStart,parserEnd);
  assert.match(parserBlock,/ultimaVirgula/);
  assert.match(parserBlock,/ultimoPonto/);
  assert.match(parserBlock,/s=s\.replace\(\/\\\.\/g,''\)\.replace\(',','\.'\)/);
  assert.match(parserBlock,/function _adtFormatValorPrincipal\(\)/);
  const saveStart=appCoreV30.indexOf('function salvarAdiantamento()');
  const saveEnd=appCoreV30.indexOf('function ',saveStart+30);
  const saveBlock=appCoreV30.slice(saveStart,saveEnd>saveStart?saveEnd:saveStart+12000);
  assert.match(saveBlock,/_adtParseVal\(document\.getElementById\('adt-valor'\)/);
  assert.doesNotMatch(saveBlock,/parseFloat\(document\.getElementById\('adt-valor'\)/);
});

test('v30 deleted stock materials stay deleted even when old purchases or sales still reference them',()=>{
  assert.match(appCoreV30,/function _estoqueMaterialExcluido\(nome\)/);
  assert.match(appCoreV30,/function _estoqueLimparExclusao\(nome\)/);

  const recuperarStart=appCoreV30.indexOf('function _recuperarMateriaisComMovimento');
  const recuperarEnd=appCoreV30.indexOf('function renderEstoque()',recuperarStart);
  const recuperarBlock=appCoreV30.slice(recuperarStart,recuperarEnd);
  assert.match(recuperarBlock,/if\(!m \|\| _estoqueMaterialExcluido\(m\)\) return/);
  assert.doesNotMatch(recuperarBlock,/_DEL_SETS\.estoque\.delete\(m\)/);

  const renderStart=appCoreV30.indexOf('function renderEstoque()');
  const renderEnd=appCoreV30.indexOf('function excluirMaterial',renderStart);
  const renderBlock=appCoreV30.slice(renderStart,renderEnd);
  assert.match(renderBlock,/!_estoqueMaterialExcluido\(m\)/);

  const deleteStart=appCoreV30.indexOf('function excluirMaterial(mat)');
  const deleteEnd=appCoreV30.indexOf('function editEstoque',deleteStart);
  const deleteBlock=appCoreV30.slice(deleteStart,deleteEnd);
  assert.match(deleteBlock,/_apagarChave\('estoque', ESTOQUE_DB, mat\)/);
  assert.match(deleteBlock,/_normalizarTombstoneEstoque\(METAIS\[i\]\)===alvoExclusao/);
});

test('v30 stock tombstone is only cleared by an explicit material reactivation',()=>{
  const addStart=appCoreV30.indexOf('function _garantirMetalCadastrado(nome)');
  const addEnd=appCoreV30.indexOf('function _r2(',addStart);
  const addBlock=appCoreV30.slice(addStart,addEnd);
  assert.match(addBlock,/_estoqueLimparExclusao\(nome\)/);

  const novoStart=appCoreV30.indexOf('function salvarNovoMaterial()');
  const novoEnd=appCoreV30.indexOf('function salvarEditEstoque()',novoStart);
  const novoBlock=appCoreV30.slice(novoStart,novoEnd);
  assert.match(novoBlock,/_estoqueLimparExclusao\(nome\)/);

  const restoreStart=appCoreV30.indexOf("} else if(h.modulo==='Estoque'){");
  const restoreEnd=appCoreV30.indexOf('} else {',restoreStart+10);
  const restoreBlock=appCoreV30.slice(restoreStart,restoreEnd);
  assert.match(restoreBlock,/_estoqueLimparExclusao\(mat\)/);
});
