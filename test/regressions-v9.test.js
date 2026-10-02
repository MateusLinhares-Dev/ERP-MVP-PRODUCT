import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const core = read('public/legacy/app-core.js');
const sync = read('public/legacy/firebase-sync.js');
const seed = read('scripts/seed-emulator.mjs');
const html = read('public/index.template.html');
const security = read('public/legacy/security-overrides.js');

function publicBundleText() {
  const base = path.join(root, 'public');
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|html|css)$/i.test(entry.name)) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(base);
  return out.join('\n');
}

test('v9 keeps mutable business collections empty in the public legacy runtime', () => {
  assert.match(core, /const USERS = \{\};/);
  assert.match(core, /const FUNCIONARIOS = \[\];/);
  assert.match(core, /const BANCOS = \[\];/);
  assert.match(core, /const TICKETS_DB = \{\};/);
  assert.match(core, /const MATERIAIS_BASE = \[\];/);
  assert.match(core, /const EMPRESAS = \[\];/);
  assert.match(core, /const FROTA_BASE = \[\];/);
  assert.match(core, /var CHQ_CTRL = \{\};/);
});

test('v9 public bundle does not ship the real/demo business records moved to local fixtures', () => {
  const bundle = publicBundleText();
  const forbidden = [
    'CLEBER ROSA',
    '948.939.699-00',
    'ACELINO ALBRECHT (NICO)',
    '47005595229',
    "{cod:'BAN001'",
    "'CCGS101'",
    "password:'amoreodio'",
    "password:'Thais2024'",
    "password:'Rafael2024'",
  ];
  for (const value of forbidden) assert.equal(bundle.includes(value), false, `public bundle contains ${value}`);
});

test('v9 local seed is the only place that injects development business fixtures', () => {
  assert.match(seed, /dev-users\.json/);
  assert.match(seed, /dev-materials\.json/);
  assert.match(seed, /dev-business-data\.json/);
  for (const node of [
    'erp/users', 'erpAuth/users', 'erp/metais', 'erp/estoque', 'erp/config',
    'erp/funcEdit', 'erp/bancos', 'erp/tickets', 'erp/frota', 'erp/chequesControle',
  ]) assert.ok(seed.includes(`'${node}'`), `seed does not write ${node}`);
  assert.equal(html.includes('scripts/dev-business-data.json'), false);
  assert.equal(html.includes('scripts/dev-users.json'), false);
  assert.equal(html.includes('scripts/dev-materials.json'), false);
});

test('v9 hydrates business configuration and master data from RTDB without changing legacy globals', () => {
  assert.match(sync, /function _aplicarConfigNegocio\(d\)/);
  assert.match(sync, /var cfg=d&&d\.config/);
  assert.match(sync, /Object\.assign\(ERP_BUSINESS_CONFIG,cfg\)/);
  assert.match(sync, /_mergeMetaisRemoto\(d\.metais/);
  assert.match(sync, /_mesclarFuncEdit\(d\.funcEdit/);
  assert.match(sync, /_syncBancos\.carregarDeRemoto\(_normalizarBancosRemotos\(d\.bancos\)/);
  assert.match(sync, /_syncFrota\.carregarDeRemoto\(d\.frota/);
  assert.match(sync, /d\.users/);
  assert.match(sync, /d\.tickets/);
});

test('v9 authorization is based on Firebase-backed admin profile/claims, never a hardcoded login', () => {
  assert.match(core, /function _usuarioEhAdmin\(u\).*u&&u\.admin===true/);
  assert.match(security, /u&&u\.admin===true/);
  assert.doesNotMatch(core, /cuKey\s*===\s*['"]elaine['"]/i);
  assert.doesNotMatch(security, /un\s*===\s*['"]elaine['"]/i);
});

test('v9 company/master-data selects are populated from RTDB configuration instead of literal option records', () => {
  assert.match(sync, /cfg\.transferCompanies/);
  assert.match(sync, /cfg\.financeCompanies/);
  assert.match(core, /_cfgChequeCompanies\(\)/);
  assert.doesNotMatch(core, /id="cheq-empresa"[^\n]*<option>Mabor<\/option>/);
  assert.match(html, /<datalist id="dlist-empresas"><\/datalist>/);
  assert.doesNotMatch(html, /id="cp-emp-manuela"[^>]*cpSetEmpresa\('Manuela Metais'\)/);
});


test('v9 keeps business configuration read-only from the browser', () => {
  const rules = JSON.parse(read('database.rules.json'));
  const write = rules.rules.erp.$node['.write'];
  assert.match(write, /\$node != 'config'/);
  assert.equal(rules.rules.erp.config['.write'], false);
});

test('v9 public branding use case depends on a repository abstraction', () => {
  const useCase = read('server/application/get-public-branding.js');
  const repo = read('server/infrastructure/business-config-repository.js');
  assert.match(useCase, /FirebaseBusinessConfigRepository/);
  assert.doesNotMatch(useCase, /getFirebaseAdmin/);
  assert.match(repo, /db\.ref\('erp\/config'\)\.get\(\)/);
});
