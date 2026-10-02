import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const vercelDev = readFileSync(new URL('../scripts/vercel-dev.mjs', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../server/config/load-local-env.js', import.meta.url), 'utf8');
const localEnvModule = readFileSync(new URL('../scripts/local-env.mjs', import.meta.url), 'utf8');

test('v20 keeps ERP local env separate from Vercel .env.local', () => {
  assert.match(pkg.scripts.dev, /prepare-local-env\.mjs/);
  assert.match(pkg.scripts['seed:emulator'], /--env-file=\.env\.erp\.local/);
  assert.match(pkg.scripts['smoke:local'], /--env-file=\.env\.erp\.local/);
  assert.doesNotMatch(pkg.scripts['seed:emulator'], /--env-file=\.env\.local(?:\s|$)/);
});

test('v20 server and Vercel dev read .env.erp.local', () => {
  assert.match(vercelDev, /APP_LOCAL_ENV_FILE/);
  assert.match(loader, /\.env\.erp\.local/);
  assert.match(localEnvModule, /\.env\.erp\.local/);
  assert.match(localEnvModule, /VERCEL_LOCAL_ENV_FILE = '\.env\.local'/);
});

test('v20 migration never overwrites Vercel managed .env.local', () => {
  assert.match(localEnvModule, /copyFileSync\(vercelPath, appPath\)/);
  assert.doesNotMatch(localEnvModule, /copyFileSync\([^,]+,\s*vercelPath\)/);
});

test('v20 refuses to overwrite an existing invalid ERP env file', () => {
  assert.match(localEnvModule, /APP_LOCAL_ENV_FILE} existe, mas não contém/);
  assert.match(localEnvModule, /não será sobrescrito automaticamente/);
});
