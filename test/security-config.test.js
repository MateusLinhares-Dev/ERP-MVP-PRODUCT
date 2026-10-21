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

test('database rules excluem novos nós sensíveis do wildcard legado', () => {
  const rules = JSON.parse(
    fs.readFileSync(
      new URL('../database.rules.json', import.meta.url),
      'utf8',
    ),
  );

  const readRule =
    rules.rules.erp.$node['.read'];

  for (const node of [
    'partyBanks',
    'calendarEvents',
    'ownerBills',
    'fixedPayables',
    'fiscalParties',
    'fiscalLinks',
  ]) {
    assert.match(
      readRule,
      new RegExp(`\\$node != '${node}'`),
    );
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
