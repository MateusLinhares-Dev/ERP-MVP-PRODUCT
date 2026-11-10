import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HELP_CATEGORIES, publishedArticles, searchArticles, articleText } from '../web/modules/help-center/domain/help-articles.ts';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const articles = [
  { id: 'h1', title: 'Emitir certificado', summary: 'Capacitações da equipe', category: 'pessoas', steps: ['Abrir Matriz', 'Gerar PDF'], status: 'published' },
  { id: 'h2', title: 'Baixa de parcela', summary: 'Contas a pagar', category: 'financeiro', keywords: 'pagamento parcial', steps: ['Pagar'], status: 'published' },
  { id: 'h3', title: 'Rascunho', summary: 'não publicado', category: 'fiscal', steps: ['x'], status: 'draft' },
];

test('Central tem oito categorias reais e mostra só artigos publicados', () => {
  assert.equal(HELP_CATEGORIES.length, 8);
  assert.deepEqual(publishedArticles({ articles }).map((a) => a.id), ['h1', 'h2']);
  assert.deepEqual(publishedArticles(null), []);
});

test('busca por palavras, sem acento, em título, resumo, palavras-chave e passos', () => {
  const list = publishedArticles({ articles });
  assert.deepEqual(searchArticles(list, 'CERTIFICADO').map((a) => a.id), ['h1']);
  assert.deepEqual(searchArticles(list, 'pagamento', 'financeiro').map((a) => a.id), ['h2']);
  assert.deepEqual(searchArticles(list, 'pagamento', 'pessoas'), []);
  assert.deepEqual(searchArticles(list, 'gerar pdf').map((a) => a.id), ['h1']);
  assert.equal(articleText(list[0]), 'Emitir certificado\nCapacitações da equipe\nAbrir Matriz\nGerar PDF');
});

test('central carrega artigos pela API autenticada, como ilha React do ERP', () => {
  const islands = read('web/erp/islands.tsx');
  assert.match(islands, /\/api\/help\/articles/);
  assert.match(islands, /ERPHelpCenter: Object\.freeze\(\{ render: renderHelpCenter/);
  assert.match(read('web/shared/http/api-client.ts'), /getIdToken/);
  assert.equal(fs.existsSync(new URL('../public/modules/help-center/help-center.js', import.meta.url)), false);
});

test('fluxo de documentos da ajuda não injeta conteúdo automático', () => {
  assert.match(read('api/help/articles.ts'), /access: 'user'/);
  assert.match(read('api/help/articles.ts'), /access: 'engineer'/);
  assert.match(read('api/help/articles.ts'), /requireIdentity\(req, \{ engineer: true \}\)/);
  assert.match(read('server/modules/help/domain/help-article.ts'), /REVISION_CONFLICT/);
  assert.match(read('database.rules.json'), /"erpHelp"/);
});

test('final-ops continua chamando a Central pela mesma função e engenharia carrega depois', () => {
  const bootstrap = read('public/app/bootstrap.js');
  assert.ok(bootstrap.indexOf('final-ops.js') < bootstrap.indexOf('engineering.js'));
  assert.match(read('public/modules/final-ops/final-ops.js'), /ERPHelpCenter\?\.render/);
});
