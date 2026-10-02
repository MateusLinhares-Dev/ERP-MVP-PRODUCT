import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const avisos=fs.readFileSync('public/legacy/app-avisos.js','utf8');
const alerts=fs.readFileSync('public/legacy/alert-state-sync.js','utf8');
const boot=fs.readFileSync('public/app/bootstrap.js','utf8');
const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8'));

// v18 bugfix: alertas não podem vazar entre usuários do mesmo navegador.
test('v18 alert seen/stopped state is scoped by Firebase uid in RTDB',()=>{
  assert.match(alerts,/erp\/alertState\/'\+uid/);
  assert.match(alerts,/alertState\/'\+uid\+'\/seen'\)\.update\(patch\)/);
  assert.match(alerts,/alertState\/'\+uid\+'\/stopped\/'\+k/);
  assert.doesNotMatch(alerts,/localStorage\.setItem\('mm_alertas_vistos'/);
  assert.doesNotMatch(alerts,/localStorage\.setItem\('mm_alertas_parados'/);
  assert.match(alerts,/localStorage\.removeItem\('mm_alertas_vistos'\)/);
  assert.match(alerts,/localStorage\.removeItem\('mm_alertas_parados'\)/);
});

test('v18 alert visibility follows module permissions',()=>{
  assert.match(core,/sourceTab:'funcionarios'/);
  assert.match(core,/sourceTab:'documentos_empresas'/);
  assert.match(alerts,/if\(a\.sourceTab\) return hasTab\(String\(a\.sourceTab\)\)/);
  assert.match(alerts,/if\(a\.mat\) return hasTab\('funcionarios'\)/);
  assert.match(alerts,/startsWith\('doc\|'\).*hasTab\('documentos_empresas'\)/s);
});

test('v18 Avisos page does not expose RH or Afazeres content without permission',()=>{
  assert.match(avisos,/function _canAfazeres\(\)\{ return _hasTab\('afazeres'\); \}/);
  assert.match(avisos,/function _canRH\(\)\{ return _hasTab\('funcionarios'\); \}/);
  assert.match(avisos,/if\(_canAfazeres\(\)\)\{/);
  assert.match(avisos,/if\(_canRH\(\)\)\{/);
  assert.match(avisos,/if\(_canVales\(\)\)\{/);
});

test('v18 loads alert state adapter after legacy UI and before chat adapter',()=>{
  const corePos=boot.indexOf("/legacy/app-core.js");
  const alertPos=boot.indexOf("/legacy/alert-state-sync.js");
  const chatPos=boot.indexOf("/legacy/chat-read-sync.js");
  assert.ok(corePos>=0 && alertPos>corePos && chatPos>alertPos);
});

test('v18 alertState write rules only allow the authenticated uid',()=>{
  assert.match(rules.rules.erp.$node['.write'],/\$node != 'alertState'/);
  assert.match(rules.rules.erp.alertState.$uid['.write'],/auth\.uid == \$uid/);
});

test('v18 keeps v17 bonus: chat per conversation and cloud-first stock',()=>{
  const chat=fs.readFileSync('public/legacy/chat-read-sync.js','utf8');
  const sync=fs.readFileSync('public/legacy/firebase-sync.js','utf8');
  assert.match(chat,/erp\/chatRead\/'\+uid/);
  assert.match(chat,/function unreadCount\(conv\)/);
  assert.match(sync,/ESTOQUE: Firebase\/RTDB é a fonte definitiva; mm_estoque é apenas cache/);
});
