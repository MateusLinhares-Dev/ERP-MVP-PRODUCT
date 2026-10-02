import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const loader=fs.readFileSync(new URL('../public/app/firebase-loader.js',import.meta.url),'utf8');
const template=fs.readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');

test('Auth Emulator is configured before persistence can restore a session',()=>{
  const authIndex=loader.indexOf('const auth = window.firebase.auth()');
  const emulatorIndex=loader.indexOf('auth.useEmulator');
  const persistenceIndex=loader.indexOf('auth.setPersistence');
  assert.ok(authIndex>=0);
  assert.ok(emulatorIndex>authIndex);
  assert.ok(persistenceIndex>emulatorIndex);
});

test('login form does not throw while bootstrap is still unavailable',()=>{
  assert.match(template,/typeof window\.doLogin===['"]function['"]/);
  assert.doesNotMatch(template,/onsubmit=['"][^'"]*;doLogin\(\)/);
});
