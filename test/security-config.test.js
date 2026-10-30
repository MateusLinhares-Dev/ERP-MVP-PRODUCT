import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildSecurityClaims,
} from '../server/domain/access.js';

test('claims da dona/admin incluem novos módulos protegidos', () => {
  const claims = buildSecurityClaims(
    { tabs: [] },
    { admin: true },
  );

  assert.equal(claims.canOwnerBills, true);
  assert.equal(claims.canPartyBanks, true);
  assert.equal(claims.canCalendar, true);
  assert.equal(claims.canFiscalRead, true);
  assert.equal(claims.canFiscalWrite, true);
  assert.equal(claims.canReceivables, true);
  assert.equal(claims.canFleetDocs, true);
});

test('claim de frota reconhece nome atual e legado', () => {
  assert.equal(
    buildSecurityClaims(
      { tabs: ['frota'] },
      { admin: false },
    ).canFleetDocs,
    true,
  );

  assert.equal(
    buildSecurityClaims(
      { tabs: ['caminhoes'] },
      { admin: false },
    ).canFleetDocs,
    true,
  );
});

test('usuário somente chat não recebe claims financeiros/fiscais', () => {
  const claims = buildSecurityClaims(
    { tabs: ['chat'] },
    { admin: false },
  );

  assert.equal(claims.canChat, true);
  assert.equal(claims.canOwnerBills, false);
  assert.equal(claims.canPartyBanks, false);
  assert.equal(claims.canCalendar, false);
  assert.equal(claims.canFiscalRead, false);
  assert.equal(claims.canFiscalWrite, false);
});

test('database rules usam regras explícitas e negam wildcard legado', () => {
  const rules=JSON.parse(fs.readFileSync(new URL('../database.rules.json',import.meta.url),'utf8'));
  assert.equal(rules.rules.erp.$node,undefined);
  for(const node of ['partyBanks','calendarEvents','ownerBills','fixedPayables','fiscalParties','fiscalLinks']){
    assert.equal(typeof rules.rules.erp[node], 'object',node);
  }
});

test('storage rules validam mime e corrigem claim da frota', () => {
  const rules = fs.readFileSync(
    new URL('../storage.rules', import.meta.url),
    'utf8',
  );

  assert.match(rules, /isBusinessDocument/);
  assert.match(rules, /canFleetDocs/);
  assert.match(rules, /application\/pdf/);
  assert.match(rules, /image\/\(jpeg\|png\|webp\|gif\)/);
});

test('database rules não usam APIs inexistentes do RTDB Rules', () => {
  const source = fs.readFileSync(
    new URL('../database.rules.json', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /numChildren\s*\(/);
});
