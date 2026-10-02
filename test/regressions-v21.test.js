import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const boot=fs.readFileSync('public/app/bootstrap.js','utf8');
const guard=fs.readFileSync('public/legacy/module-access-guard.js','utf8');
const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const alerts=fs.readFileSync('public/legacy/alert-state-sync.js','utf8');
const avisos=fs.readFileSync('public/legacy/app-avisos.js','utf8');
const vercel=fs.readFileSync('vercel.json','utf8');

test('v21 loads module access guard immediately after legacy core',()=>{
  const corePos=boot.indexOf("/legacy/app-core.js");
  const guardPos=boot.indexOf("/legacy/module-access-guard.js");
  const avisosPos=boot.indexOf("/legacy/app-avisos.js");
  assert.ok(corePos>=0 && guardPos>corePos && avisosPos>guardPos);
});

test('v21 switchTab validates module and permission before calling legacy navigation',()=>{
  assert.match(guard,/function canAccessTab\(tab\)/);
  assert.match(guard,/Array\.isArray\(profile\.tabs\)/);
  assert.match(guard,/profile\.tabs\.includes\(tab\)/);
  assert.match(guard,/if\(!tabExists\(tid\)\)/);
  assert.match(guard,/if\(!canAccessTab\(tid\)\)/);
  assert.match(guard,/legacySwitch\(tid\)/);
  assert.match(guard,/return false/);
});

test('v21 admin flag does not bypass explicit module tabs',()=>{
  const can=guard.slice(guard.indexOf('function canAccessTab'),guard.indexOf('function tabExists'));
  assert.doesNotMatch(can,/admin===true/);
  assert.doesNotMatch(can,/profile\.admin/);
});

test('v21 alert and Avisos authorization reuse centralized tab access',()=>{
  assert.match(alerts,/window\.erpCanAccessTab/);
  assert.match(avisos,/window\.erpCanAccessTab/);
  const collector=core.slice(core.indexOf('function _coletarAlertas()'),core.indexOf('function _alertaVencendo'));
  assert.match(collector,/window\.erpCanAccessTab/);
  assert.doesNotMatch(collector,/cu&&cu\.admin===true/);
});

test('v21 alert state is reset on logout so one browser user cannot leak state/UI to another',()=>{
  assert.match(alerts,/function resetForLogout\(\)/);
  assert.match(alerts,/listenerRef\.off\('value'\)/);
  assert.match(alerts,/state=\{seen:\{\},stopped:\{\}\}/);
  assert.match(alerts,/document\.querySelectorAll\('\.alerta-ov'\)/);
  assert.match(core,/__alertStateResetForLogout/);
  assert.match(alerts,/onAuthStateChanged/);
});

test('v21 CSP explicitly permits local data/blob audio used by legacy notification sound',()=>{
  assert.match(vercel,/media-src 'self' data: blob:/);
});
