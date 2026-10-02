import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat lifecycle compatibility does not assign undeclared globals in strict mode', () => {
  const src = read('public/legacy/security-overrides.js');
  assert.match(src, /window\.chatInit\s*=\s*function\s*\(/);
  assert.doesNotMatch(src, /window\.chatInit\s*=\s*chatInit\s*=/);
  assert.match(src, /window\.chatDestroy\s*=\s*function\s*\(/);
});

test('login form exposes a hidden username field for password managers', () => {
  const src = read('public/index.template.html');
  assert.match(src, /name="username"[^>]*autocomplete="username"/);
});

test('firebase transport prefers websockets and CSP supports emulator and scale websocket', () => {
  const loader = read('public/app/firebase-loader.js');
  const vercel = read('vercel.json');
  assert.match(loader, /forceWebSockets/);
  assert.match(vercel, /http:\/\/127\.0\.0\.1:9000/);
  assert.match(vercel, /ws: wss:/);
});

test('vercel dev runs non-interactively without shell true', () => {
  const src = read('scripts/vercel-dev.mjs');
  assert.match(src, /'--yes'/);
  assert.match(src, /shell:\s*false/);
});


test('emulator seeds the material catalog from a fixture instead of UI code', () => {
  const seed = read('scripts/seed-emulator.mjs');
  const materials = JSON.parse(read('scripts/dev-materials.json'));
  assert.ok(materials.length > 10);
  assert.match(seed, /erp\/metais/);
  assert.match(seed, /erp\/estoque/);
});
