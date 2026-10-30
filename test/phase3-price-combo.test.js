import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(
  new URL('../public/modules/phase3/phase3-homologation.css', import.meta.url),
  'utf8',
);

test('card de preços não recorta o dropdown pesquisável', () => {
  assert.match(
    css,
    /#tab-precos_fornecedores\s*>\s*\.tcard,[\s\S]*#tab-precos_clientes\s*>\s*\.tcard\{[\s\S]*overflow:visible!important/,
  );
});

test('dropdown abre sobre o conteúdo e possui scroll', () => {
  assert.match(css, /\.phase3-price-combo\.open \.phase3-price-combo-list\{display:block!important\}/);
  assert.match(css, /max-height:320px!important/);
  assert.match(css, /overflow-y:auto!important/);
});
