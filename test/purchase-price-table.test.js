import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const js=fs.readFileSync(path.join(root,'public/modules/pricing/purchase-price-table.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/modules/pricing/purchase-price-table.css'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'public/app/bootstrap.js'),'utf8');

test('imagem da tabela de preços é compacta e legível',()=>{
  assert.match(js,/const IMAGE_WIDTH=430/);
  assert.match(js,/padding:4px 8px/);
  assert.match(js,/font-weight:800/);
  assert.match(js,/font-weight:900/);
  assert.match(js,/<col style="width:66%"><col style="width:34%">/);
  assert.match(js,/text-align:left;font-weight:900;color:#1a3a2a/);
});

test('compartilhamento continua usando html2canvas e share ou download',()=>{
  assert.match(js,/html2canvas/);
  assert.match(js,/navigator\.share/);
  assert.match(js,/URL\.createObjectURL/);
  assert.match(js,/global\.compartilharImagemPrecosForn=sharePurchasePriceImage/);
});

test('tabela de edição também fica mais compacta sem perder destaque',()=>{
  assert.match(css,/#precos-forn-container \.price-edit-table/);
  assert.match(css,/padding-top: 4px !important/);
  assert.match(css,/\.price-edit-material-name[\s\S]*font-weight: 800/);
  assert.match(css,/max-width: 118px/);
});

test('bootstrap carrega o módulo de preços após o legado',()=>{
  const core=bootstrap.indexOf("await loadClassic('/legacy/app-core.js')");
  const pricing=bootstrap.indexOf("await loadClassic('/modules/pricing/purchase-price-table.js')");
  assert.ok(core>=0&&pricing>core);
  assert.match(bootstrap,/purchase-price-table\.css/);
});
