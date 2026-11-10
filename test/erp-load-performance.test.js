import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('ERP baixa os scripts em paralelo e executa na ordem (async=false), sem fila de await', () => {
  const bootstrap = read('public/app/bootstrap.js');
  assert.equal((bootstrap.match(/await loadClassic\(/g) || []).length, 0, 'nenhum script espera o anterior baixar');
  assert.match(bootstrap, /await Promise\.all\(\[\n\s+loadClassic\('\/legacy\/audit-trail\.js'\),/);
  assert.match(bootstrap, /script\.async = false;/);
  const loader = read('public/app/firebase-loader.js');
  assert.match(loader, /await Promise\.all\(\[\n\s+loadScript\(`\$\{base\}\/firebase-app-compat\.js`\),/);
});

test('login antigo não responde "Senha incorreta" enquanto o login seguro não carregou', () => {
  const core = read('public/legacy/app-core.js');
  const start = core.indexOf('function doLogin() {');
  const source = core.slice(start, core.indexOf('\n}\n', start) + 3);
  const lerr = { style: {}, textContent: '' };
  const ctx = {
    window: {},
    USERS: {},
    document: { getElementById: (id) => (id === 'inp-p' ? { value: 'senha-certa', focus() {} } : lerr) },
  };
  runInNewContext(source + ';doLogin();', ctx);
  assert.match(lerr.textContent, /ainda está carregando/);
  assert.match(read('public/legacy/security-overrides.js'), /window\.__ERP_SECURE_LOGIN__ = true;\n\s+window\.doLogin = async function/);
});

function supplierHelpers() {
  const core = read('public/legacy/app-core.js');
  const slice = (name) => {
    const start = core.indexOf('function ' + name + '(');
    return core.slice(start, core.indexOf('\n}\n', start) + 3);
  };
  const ctx = {};
  runInNewContext(slice('_fornNomeNormalizado') + slice('_fornRotuloOpcao'), ctx);
  return ctx;
}

test('rótulo de fornecedor com nome repetido continua igual, calculado uma vez por lista', () => {
  const { _fornRotuloOpcao } = supplierHelpers();
  const lista = [
    { cod: 'F1', nome: 'GAÚCHO' },
    { cod: 'F2', nome: 'gaucho ' },
    { cod: 'F3', nome: 'JOÃO' },
  ];
  assert.deepEqual(lista.map((f) => _fornRotuloOpcao(f, lista)), ['GAÚCHO — F1', 'gaucho — F2', 'JOÃO']);
  lista.push({ cod: 'F4', nome: 'João' });
  assert.equal(_fornRotuloOpcao(lista[2], lista), 'JOÃO — F3', 'lista que cresceu é recalculada');
  const many = Array.from({ length: 2000 }, (_, i) => ({ cod: 'C' + i, nome: 'FORNECEDOR ' + (i % 1000) }));
  const started = performance.now();
  many.forEach((f) => _fornRotuloOpcao(f, many));
  assert.ok(performance.now() - started < 400, 'antes era quadrático (4 milhões de normalizações)');
  assert.equal(_fornRotuloOpcao(many[5], many), 'FORNECEDOR 5 — C5');
});

test('compras por fornecedor usam índice e mantêm a ordem e as regras antigas', () => {
  const core = read('public/legacy/app-core.js');
  const start = core.indexOf('let _ticketsPorFornIndice=null;');
  const source = core.slice(start, core.indexOf('function ticketsDeForn(', start));
  const ctx = {
    FORNECEDORES: [{ cod: 'F1', nome: 'JOAO' }, { cod: 'F2', nome: 'MARIA' }],
    TICKETS_DB: {
      T1: { ticket: 'T1', fornecedorCod: 'F1' },
      T2: { ticket: 'T2', fornecedor: 'JOAO' },
      T3: { ticket: 'T3', fornecedorCod: 'F1', fornecedorNome: 'JOAO' },
      T4: { ticket: 'T4', fornecedorCod: 'F1', _balSessao: true },
      T5: { ticket: 'T5', fornecedorCod: 'F2' },
    },
    Date,
  };
  runInNewContext(source, ctx);
  assert.equal(JSON.stringify(ctx.getTicketsPorForn('F1').map((t) => t.ticket)), '["T1","T2","T3"]');
  assert.equal(JSON.stringify(ctx.getTicketsPorForn('F2').map((t) => t.ticket)), '["T5"]');
  ctx.TICKETS_DB.T6 = { ticket: 'T6', fornecedorCod: 'F2' };
  assert.equal(JSON.stringify(ctx.getTicketsPorForn('F2').map((t) => t.ticket)), '["T5","T6"]', 'compra nova entra na hora');
});

test('lista de adiantamentos é paginada (antes desenhava todas as linhas)', () => {
  assert.match(read('public/legacy/app-core.js'), /_erpPaginarDados\('adiantamentos-lista',allFiltrado,'tb-adiantamentos-list',renderAdiantamentos\)/);
});

test('cache longo só para endereços com ?v= e a revisão leva o hash do conteúdo no build', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find((r) => r.source === '/(legacy|modules|app)/(.*)');
  assert.deepEqual(JSON.parse(JSON.stringify(rule.has)), [{ type: 'query', key: 'v' }]);
  assert.match(rule.headers[0].value, /immutable/);
  const build = read('scripts/build.mjs');
  assert.match(build, /contentRevision=hash\.digest\('hex'\)\.slice\(0,10\)/);
  assert.match(build, /indexHtml\.replace\(\/\\\?v=/);
  assert.match(read('scripts/verify-deployment-artifacts.mjs'), /Revisão dos arquivos sem hash de conteúdo/);
});
