import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const sync=fs.readFileSync('public/legacy/firebase-sync.js','utf8');
const alerts=fs.readFileSync('public/legacy/alert-state-sync.js','utf8');

test('v19 alert collector can filter without reassigning a const array',()=>{
  const start=core.indexOf('function _coletarAlertas()');
  const end=core.indexOf('function _alertaVencendo',start);
  const fn=core.slice(start,end);
  assert.match(fn,/const hoje=_hojeISO\(\); let lista=\[\];/);
  assert.doesNotMatch(fn,/const hoje=_hojeISO\(\); const lista=\[\];/);
  assert.match(fn,/lista=lista\.filter/);
});

test('v19 document and RH hydration notify alert engine after RTDB data arrives',()=>{
  assert.match(sync,/source:'documentos_empresas'/);
  assert.match(sync,/source:'funcionarios'/);
  assert.match(sync,/erp:alert-source-changed/);
});

test('v19 newly saved company document triggers alert source refresh',()=>{
  const start=core.indexOf('function deSalvarDoc()');
  const end=core.indexOf('function deVerDoc',start);
  const fn=core.slice(start,end);
  assert.match(fn,/DOCS_EMPRESAS\.push\(doc\)/);
  assert.match(fn,/erp:alert-source-changed/);
  assert.match(fn,/source:'documentos_empresas'/);
});

test('v19 alert adapter rechecks after login and after alert source hydration',()=>{
  assert.match(alerts,/document\.addEventListener\('erp:alert-source-changed'/);
  assert.match(alerts,/document\.addEventListener\('erp:user-started'/);
  assert.match(alerts,/function scheduleRecheck\(delay\)/);
  assert.match(alerts,/ensureState\(\)\.then\(function\(\)\{ renderAlerts\(false\); \}\)/);
  assert.match(core,/erp:user-started/);
});

test('v19 keeps per-user/module authorization from v18',()=>{
  assert.match(alerts,/erp\/alertState\/'\+uid/);
  assert.match(alerts,/if\(a\.sourceTab\) return hasTab\(String\(a\.sourceTab\)\)/);
  assert.match(core,/sourceTab:'documentos_empresas'/);
  assert.match(core,/sourceTab:'funcionarios'/);
});
