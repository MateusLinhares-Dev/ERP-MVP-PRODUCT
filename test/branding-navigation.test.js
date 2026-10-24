import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import test from 'node:test';

const root = new URL('../public/', import.meta.url);
const file = path => readFileSync(new URL(path, root));
const source = path => file(path).toString('utf8');

test('o favicon e o ícone da empresa estão publicados na aplicação', () => {
  const html=source('index.template.html');
  assert.match(html,/rel="icon" href="\/favicon\.ico"/);
  assert.match(html,/branding\/favicon-256\.png/);
  assert.match(html,/branding\/apple-touch-icon\.png/);
  assert.equal(file('favicon.ico').subarray(0,4).toString('hex'),'00000100');
  assert.equal(file('assets/branding/favicon-256.png').subarray(1,4).toString(),'PNG');
  assert.ok(statSync(new URL('assets/branding/manuela-metais-symbol.png',root)).size > 1000);
});

test('o cabeçalho usa a marca sem alterar o cadastro público da empresa', () => {
  const bootstrap=source('app/bootstrap.js');
  assert.match(bootstrap,/manuela-metais-symbol\.png/);
  assert.match(bootstrap,/manuela-metais-logo\.webp/);
  assert.match(bootstrap,/branding\.logoPrefix/);
  assert.match(bootstrap,/data-brand-logo/);
  assert.match(bootstrap,/uiStylesheet\) document\.head\.appendChild\(uiStylesheet\)/);
  const css=source('legacy/professional-ui.css');
  assert.match(css,/\.hdr-logo \.brand-logo-img/);
  assert.match(css,/\.hdr-sub\{padding-left:54px/);
});

test('sidebar mantém ícones SVG visíveis nos módulos e grupos', () => {
  const app=source('legacy/app-core.js');
  assert.match(app,/\$\{_sidebarTabIcon\(tid\)\}/);
  assert.match(app,/\$\{_sidebarGroupIcon\(mod\.id\)\}/);
  const css=source('legacy/professional-ui.css');
  assert.doesNotMatch(css,/\.nt-icon[^\{]*\{\s*display\s*:\s*none/);
  assert.match(css,/\.nav-tab \.nt-icon\{[^}]*display:inline-flex!important/);
  assert.match(css,/\.sb-group-hdr \.sb-gicon\{[^}]*display:inline-flex!important/);
});

test('abas de cheques mantêm os contratos de ações ao reordenar a interface', () => {
  const html=source('index.template.html');
  for (const id of ['cheqtab-btn-lista','cheqtab-btn-desconto','cheqtab-btn-historico']) assert.ok(html.includes(`id="${id}"`));
  for (const fn of ['cheqExportarJSON()','abrirSnapshots()','om(\'historico_geral\')','om(\'cheque\')']) assert.ok(html.includes(fn));
  assert.match(html,/class="erp-actions-dropdown"/);
  assert.match(html,/class="erp-docs-filters"/);
  assert.match(html,/class="erp-expenses-filters"/);
});
