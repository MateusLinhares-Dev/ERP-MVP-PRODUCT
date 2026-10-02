import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const emu = fs.readFileSync(new URL('../scripts/emulators.mjs', import.meta.url), 'utf8');

test('Firebase Emulator inicia de forma cross-platform sem spawn de .cmd', () => {
  assert.match(emu, /firebase-tools[\s\S]*lib[\s\S]*bin[\s\S]*firebase\.js/);
  assert.match(emu, /spawn\(process\.execPath,\s*args/);
  assert.doesNotMatch(emu, /firebase\.cmd/);
  assert.doesNotMatch(emu, /spawn\([^\n]*\.cmd/);
});

test('persistência do Emulator continua habilitada', () => {
  assert.match(emu, /--export-on-exit/);
  assert.match(emu, /--import/);
  assert.match(emu, /firebase-export-metadata\.json/);
});
