import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.template.html', import.meta.url), 'utf8');

test('menu "Mais" das contas bancárias não fecha quando outro computador grava', () => {
  const start = core.indexOf('function renderBancos(){');
  const head = core.slice(start, start + 400);
  assert.doesNotMatch(head.split('\n').slice(0, 3).join('\n'), /_erpBankMoreClose\(\);\s*$/m, 'não fecha logo ao começar a desenhar');
  assert.match(core, /try\{ if\(typeof _erpBankMoreReancorar==='function'\) _erpBankMoreReancorar\(\); \}catch\(e\)\{/);
  assert.match(core, /function _erpBankMoreReancorar\(\)\{[\s\S]*?_erpBankMoreAnchor=novo;/);
  assert.doesNotMatch(core, /window\.addEventListener\('scroll',_erpBankMoreClose,true\)/, 'rolagem em outra área não fecha o menu');
  assert.match(sync, /const _FB_MENUS_ABERTOS='\.erp-bank-more-popover, details\.erp-actions-dropdown\[open\], details\.erp-rec-more-actions\[open\]';/);
  assert.equal((sync.match(/document\.querySelector\(_FB_MENUS_ABERTOS\)/g) || []).length, 2, 'recarga adiada com menu aberto');
});

test('todo onclick antigo aponta para função que existe (o formulário antigo de fornecedor saiu)', () => {
  assert.doesNotMatch(core, /salvarNovoFornecedor\(\)/);
  assert.doesNotMatch(core, /fornecedor:`<h3>🤝 Novo Fornecedor de Compra/);
  assert.match(core, /fornecedor_despesa:`<h3>/);
});

test('funcionário sem cargo não aparece como "(undefined)" nas listas de motorista', () => {
  assert.doesNotMatch(core, /\+' \('\+f\.cargo\+'\)'/);
  assert.doesNotMatch(core, /\+' \('\+fn\.cargo\+'\)'/);
  assert.equal((core.match(/\(f\.cargo\?' \('\+f\.cargo\+'\)':''\)/g) || []).length, 2);
  assert.ok(html.includes('id="tab-viagem_motorista"'));
});

test('aviso de contas bancárias antigas: compara por id, código ou banco+agência+conta, nomeia e aparece uma vez', async () => {
  const start = core.indexOf('function _bancosDoBackupAusentes(');
  const source = core.slice(start, core.indexOf('\nfunction ', start + 10));
  const { runInNewContext } = await import('node:vm');
  const scope = {};
  runInNewContext(source + ';this.missing=_bancosDoBackupAusentes;', scope);
  const cloud = [{ id: 'k1', cod: 'BC-002', banco: 'sicred manuela', agencia: '2602', conta: '585457' }];
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(scope.missing([{ id: 'x', cod: 'BC-002' }, { banco: 'Sicred Manuela', agencia: '2602', conta: '58545-7' }], cloud)), []);
  assert.deepEqual(plain(scope.missing([{ cod: 'BC-099', banco: 'antigo' }, null], cloud)).map((b) => b.cod), ['BC-099']);
  assert.match(core, /function loadBancos\(\)\{\}/, 'não cria mais foto "antes da nuvem" em navegador novo');
  assert.match(core, /localStorage\.getItem\('mm_bancos_backup_aviso'\)!==marca/);
  assert.doesNotMatch(core, /Existem contas no cache antigo/);
});

test('cartões de Bancos e Contas a Pagar não ficam presos em "Aguardando…"', () => {
  assert.match(core, /kpiSubs\[0\]\.textContent=BANCOS_DB\.length\?'Contas cadastradas no sistema'/);
  assert.match(core, /kpiSubs\[1\]\.textContent=\[\.\.\.balanceByCode\.values\(\)\]/);
  const workspace = readFileSync(new URL('../web/modules/payables/ui/PayablesWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /Nada em aberto no mês/);
  assert.doesNotMatch(html, /Aguardando lançamentos/);
});
