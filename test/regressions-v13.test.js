import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const sync=fs.readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
const seed=fs.readFileSync(new URL('../scripts/seed-emulator.mjs',import.meta.url),'utf8');
const emu=fs.readFileSync(new URL('../scripts/emulators.mjs',import.meta.url),'utf8');

test('clientes, tickets e vendas não usam localStorage como fonte de verdade',()=>{
  assert.doesNotMatch(core,/localStorage\.getItem\('mm_clientes'\)/);
  assert.doesNotMatch(core,/localStorage\.setItem\('mm_clientes'/);
  assert.doesNotMatch(core,/localStorage\.getItem\('mm_tickets'\)/);
  assert.doesNotMatch(core,/localStorage\.setItem\('mm_tickets'/);
  assert.doesNotMatch(core,/localStorage\.getItem\('mm_vendas'\)/);
  assert.doesNotMatch(core,/localStorage\.setItem\('mm_vendas'/);
  assert.doesNotMatch(sync,/localStorage\.setItem\('mm_clientes'/);
  assert.doesNotMatch(sync,/localStorage\.setItem\('mm_tickets'/);
  assert.doesNotMatch(sync,/localStorage\.setItem\('mm_vendas'/);
});

test('aba Clientes recarrega diretamente do RTDB',()=>{
  assert.match(core,/recarregarClientesDoBanco\(\)/);
  assert.match(core,/__businessRepository\.read\('clientes'\)/);
  assert.match(core,/tid==='clientes'\).*recarregarClientesDoBanco/s);
});

test('pesagem rodoviária persiste ticket diretamente no RTDB',()=>{
  assert.match(core,/__businessRepository\.upsert\('tickets',tid,TICKETS_DB\[tid\]\)/);
});

test('emulador preserva banco entre reinicializações',()=>{
  assert.match(emu,/--export-on-exit/);
  assert.match(emu,/--import/);
  assert.match(seed,/putIfMissing\('erp\/tickets'/);
  assert.match(seed,/putIfMissing\('erp\/metais'/);
});
