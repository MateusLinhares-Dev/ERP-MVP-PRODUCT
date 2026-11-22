import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/modules/pricing/purchase-price-table.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.template.html', import.meta.url), 'utf8');

test('tabela de preços enviada sai em ordem alfabética (como na tela), sem acento atrapalhar e sem _datas', () => {
  const start = core.indexOf('function _precosOrdenados(precos){');
  const code = core.slice(start, core.indexOf('window.erpPrecosOrdenados=_precosOrdenados;', start));
  const ctx = {};
  runInNewContext(code + ';this.order=_precosOrdenados;', ctx);
  const precos = { 'COBRE MISTO': 66, 'INOX 304': 5.4, 'INOX 316': 10.4, METAL: 41, 'MOTOR CV': 60, 'ALUMINIO DURO 100 %': 10, 'ÁLCOOL': 1, ANTIMONIO: 11.5, ZERADO: 0, _datas: { x: 1 } };
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.order(precos).map((e) => e[0]))), ['ÁLCOOL', 'ALUMINIO DURO 100 %', 'ANTIMONIO', 'COBRE MISTO', 'INOX 304', 'INOX 316', 'METAL', 'MOTOR CV']);
  assert.equal((core.match(/const itens=_precosOrdenados\(precos\);/g) || []).length, 6, 'WhatsApp, imagem e impressão de fornecedor e de cliente');
  assert.doesNotMatch(core, /const itens=Object\.entries\(precos\)\.filter/);
  assert.match(table, /\.sort\(\(a,b\)=>String\(a\[0\]\)\.localeCompare\(String\(b\[0\]\),'pt-BR',\{sensitivity:'base',numeric:true\}\)\)/);
});

test('aba Custo Casa sai do menu e das permissões; Contas da Dona continua; primeira aba inexistente não trava a entrada', () => {
  const registry = core.slice(core.indexOf('const TABS_CFG'), core.indexOf('};', core.indexOf('const TABS_CFG')));
  assert.doesNotMatch(registry, /custo_casa:/);
  const sidebar = core.slice(core.indexOf('const SIDEBAR_MODULES=['), core.indexOf('];', core.indexOf('const SIDEBAR_MODULES=[')));
  assert.doesNotMatch(sidebar, /'custo_casa'/);
  assert.doesNotMatch(html, /data-dashboard-description="custo_casa"/);
  assert.match(core, /switchTab\(\(Array\.isArray\(cu\.tabs\)&&cu\.tabs\.find\(function\(t\)\{ return TABS_CFG\[t\]; \}\)\)\|\|'dashboard'\);/);
});
