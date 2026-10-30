import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const combo = read('public/modules/phase1/phase1-searchable-select.js');
const agenda = read('public/modules/phase1/phase1-agenda.js');
const bootstrap = read('public/app/bootstrap.js');

test('Agenda preserva o select original e vincula campo pesquisável', () => {
  assert.match(agenda, /ERPEnhanceSearchableSelect\(who/);
  assert.match(agenda, /ERPRefreshSearchableSelect\?\.\('agd-novo-nome'\)/);
  assert.match(combo, /select\.dispatchEvent\(new Event\('change'/);
  assert.match(combo, /select\.value = value/);
});
test('Listagem limitada, com pesquisa sem acentos, navegação e preservação de seleção', () => {
  assert.match(combo, /PAGE_SIZE = 8/);
  assert.match(combo, /normalize\('NFD'\)/);
  assert.match(combo, /matches\.slice\(page \* PAGE_SIZE/);
  assert.match(combo, /ArrowDown/);
  assert.match(combo, /ArrowUp/);
  assert.match(combo, /Escape/);
  assert.match(combo, /aria-expanded/);
});
test('Seletor é aplicado também em Rodoviária, adiantamentos e cheques, sem preços duplicados', () => {
  for (const id of ['rod-forn-sel', 'adtcli-cli', 'cheqcli-cli']) assert.ok(combo.includes(id));
  assert.doesNotMatch(combo, /pf-forn-sel|pc-cli-sel/);
  assert.ok(bootstrap.indexOf("loadClassic('/modules/phase1/phase1-searchable-select.js')") < bootstrap.indexOf("loadClassic('/modules/phase1/phase1-agenda.js')"));
});
