import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overrides=fs.readFileSync(new URL('../public/legacy/security-overrides.js',import.meta.url),'utf8');
const template=fs.readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const vercel=fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8');

test('road-scale compatibility defines the two missing legacy handlers',()=>{
  assert.match(overrides,/window\.rodCancelarPesagem\s*=\s*function/);
  assert.match(overrides,/window\.rodImprimirUltimo\s*=\s*function/);
  assert.match(overrides,/rodImprimirRomaneio\(tid\)/);
});

test('road-scale inline handlers do not dereference missing globals',()=>{
  assert.match(template,/typeof rodCancelarPesagem===['"]function['"]/);
  assert.match(template,/typeof rodImprimirUltimo===['"]function['"]/);
});

test('local Firebase long-poll iframe is allowed by development CSP',()=>{
  assert.match(vercel,/frame-src[^;]*http:\/\/127\.0\.0\.1:\*/);
  assert.match(vercel,/frame-src[^;]*http:\/\/localhost:\*/);
});
