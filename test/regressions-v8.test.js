import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const compat=fs.readFileSync('public/legacy/supplier-compat.js','utf8');
const html=fs.readFileSync('public/index.template.html','utf8');
const boot=fs.readFileSync('public/app/bootstrap.js','utf8');

test('supplier list exposes PIX modal action like client UI',()=>{
  assert.match(compat,/fornAbrirPix/);
  assert.match(compat,/Contas \/ PIX/);
  assert.match(compat,/WhatsApp/);
  assert.match(html,/Ações \(💳 PIX = DADOS DO BANCO\)/);
});

test('price supplier select is refreshed from FORNECEDORES',()=>{
  assert.match(compat,/populatePrecosFornSel/);
  assert.match(compat,/getFornAtivos/);
  assert.match(compat,/pf-forn-sel/);
  assert.match(compat,/renderPrecosFornTab/);
});

test('supplier compatibility is loaded after security overrides',()=>{
  const sec=boot.indexOf("/legacy/security-overrides.js");
  const sup=boot.indexOf("/legacy/supplier-compat.js");
  assert.ok(sec>=0 && sup>sec);
});
