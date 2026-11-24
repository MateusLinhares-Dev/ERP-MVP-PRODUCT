import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canFinance: true, canAdvances: true, canPayables: true, canBanking: true };
let srv, db, app, mod;
const read = async (path) => (await db.ref(path).get()).val();
const list = async () => { const v = await read('erp/adiantamentos/F1'); return Array.isArray(v) ? v : Object.values(v || {}); };
const byCod = async (cod) => (await list()).find((a) => a.cod === cod);
const call = (body) => mod.changeAdvance(identity, { operationId: randomUUID(), fornCod: 'F1', ...body }, { db });

before(async () => {
  srv = await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS = 'true';
  process.env.FIREBASE_PROJECT_ID = 'demo-erp-test';
  process.env.FIREBASE_DATABASE_URL = srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = srv.host;
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-erp-test.appspot.com';
  delete process.env.APP_ENV; delete process.env.VERCEL_ENV;
  const admin = await import('../server/shared/firebase/firebase-admin.js');
  ({ app, db } = admin.getFirebaseAdmin());
  mod = await import('../server/modules/advances/application/advances.js');
});
after(async () => { try { await app?.delete(); } catch {} await srv?.close(); });
beforeEach(() => srv.reset({ erp: {
  _ts: 1,
  fornecedores: { f1: { cod: 'F1', nome: 'JEFERSON SERAFIM BORBA', ativo: true } },
  bancos: { b1: { cod: 'B1', banco: 'Sicredi' } },
  adiantamentos: { F1: [
    { cod: 'ADTJ', data: '19/11/2026', valor: 5955.3, valorOriginal: 15000, valorCompensado: 9044.7, status: 'Pendente', forma: 'PIX', bancoCod: 'B1', bancoNome: 'Sicredi', ticket: '' },
    { cod: 'S1', data: '19/11/2026', valor: 9044.7, status: 'Quitado', ticket: 'T206', origem: 'compensacao_cp', adiantamentoOrigem: 'ADTJ' },
  ] },
  lancBanco: {},
} }));

test('caso Jeferson: fornecedor devolveu os R$ 5.955,30 que sobraram; entra no banco e o adiantamento fecha; dá para desfazer', async () => {
  const r = await call({ action: 'refund', adtCod: 'ADTJ', valor: 5955.3, data: '2026-11-24', bancoCod: 'B1' });
  const adt = await byCod('ADTJ');
  assert.deepEqual([adt.status, adt.valor, adt.valorDevolvido, adt.dataDevolucao, adt.bancoDevolucaoNome], ['Quitado', 5955.3, 5955.3, '24/11/2026', 'Sicredi']);
  const mov = await read('erp/lancBanco/' + adt.movDevolucaoId);
  assert.deepEqual([mov.tipo, mov.valor, mov.bancoCod, mov.data, mov.source], ['Entrada', 5955.3, 'B1', '24/11/2026', 'advance-refund']);
  assert.equal(r.bankMovement.id, adt.movDevolucaoId);
  assert.equal((await list()).length, 2, 'devolução total não cria parte nova');
  await assert.rejects(call({ action: 'refund', adtCod: 'ADTJ', valor: 1, data: '2026-11-24' }), { code: 'ADVANCE_NOT_FREE' });
  const undo = await call({ action: 'refund-undo', adtCod: 'ADTJ' });
  const back = await byCod('ADTJ');
  assert.deepEqual([back.status, back.valor, back.valorDevolvido, back.movDevolucaoId], ['Pendente', 5955.3, undefined, undefined]);
  assert.equal(await read('erp/lancBanco/' + adt.movDevolucaoId), null);
  assert.equal(await read('erp/lancBancoDeletedV2/' + adt.movDevolucaoId), true);
  assert.equal(undo.movementRemovedId, adt.movDevolucaoId);
});

test('devolução parcial em dinheiro: o resto continua livre; desfazer junta de volta', async () => {
  await call({ action: 'refund', adtCod: 'ADTJ', valor: 1000, data: '2026-11-24', bancoCod: '' });
  const rows = await list();
  const adt = rows.find((a) => a.cod === 'ADTJ');
  const part = rows.find((a) => a.origem === 'devolucao');
  assert.deepEqual([adt.status, adt.valor], ['Pendente', 4955.3]);
  assert.deepEqual([part.status, part.valor, part.valorDevolvido, part.adiantamentoOrigem, part.bancoDevolucaoNome, part.movDevolucaoId], ['Quitado', 1000, 1000, 'ADTJ', 'Dinheiro', undefined]);
  assert.deepEqual(await read('erp/lancBanco') ?? {}, {});
  await assert.rejects(call({ action: 'refund', adtCod: 'ADTJ', valor: 5000, data: '2026-11-24' }), { code: 'INVALID_AMOUNT' });
  await call({ action: 'refund-undo', adtCod: part.cod });
  const after = await list();
  assert.equal(after.length, 2);
  assert.equal(after.find((a) => a.cod === 'ADTJ').valor, 5955.3);
});

test('não deixa devolver adiantamento já usado nem desfazer o que não foi devolvido', async () => {
  await assert.rejects(call({ action: 'refund', adtCod: 'S1', valor: 10, data: '2026-11-24' }), { code: 'ADVANCE_NOT_FREE' });
  await assert.rejects(call({ action: 'refund-undo', adtCod: 'ADTJ' }), { code: 'NOT_REFUNDED' });
  await assert.rejects(call({ action: 'refund', adtCod: 'ADTJ', valor: 10, data: '2026-11-24', bancoCod: 'NAO' }), { code: 'BANK_NOT_FOUND' });
  assert.equal(Object.keys(srv.read('erpFinanceAdvanceLocks') || {}).length, 0, 'trava liberada mesmo com erro');
});

test('adiantamento com devolução registrada não pode ser excluído nem editado (a entrada do banco ficaria solta)', async () => {
  srv.seed('erp/adiantamentos/F1', [{ cod: 'ADTL', data: '20/11/2026', valor: 500, status: 'Pendente', forma: 'PIX', bancoCod: 'B1', bancoNome: 'Sicredi', ticket: '' }]);
  await call({ action: 'refund', adtCod: 'ADTL', valor: 500, data: '2026-11-24', bancoCod: 'B1' });
  const adt = await byCod('ADTL');
  await assert.rejects(call({ action: 'delete', adtCod: 'ADTL', expected: adt }), { code: 'ADVANCE_REFUNDED' });
  await assert.rejects(call({ action: 'edit', adtCod: 'ADTL', expected: adt, valor: 400, data: '2026-11-20', forma: 'PIX', bancoCod: 'B1' }), { code: 'ADVANCE_REFUNDED' });
  assert.ok(await read('erp/lancBanco/' + adt.movDevolucaoId));
});
