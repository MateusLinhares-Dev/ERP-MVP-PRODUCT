import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canFinance: true, canAdvances: true, canPayables: true, canBanking: true };
let srv, db, app, mod = {};
const viaSdk = async (path) => (await db.ref(path).get()).val();
const baseData = () => ({ erp: {
  fornecedores: { f1: { cod: 'F1', nome: 'CICLO', ativo: true }, f2: { cod: 'F2', nome: 'OUTRO', ativo: true } },
  bancos: { b1: { cod: 'B1', banco: 'Sicredi' } }, adiantamentos: {}, chequesControle: {}, _ts: 1,
} });
const create = (fornCod, cheques) => mod.createAdvance(identity, { operationId: randomUUID(), fornCod, data: '2026-11-11', forma: 'Cheque',
  valor: Math.round(cheques.reduce((sum, c) => sum + c.v, 0) * 100) / 100, cheques, chequeSituation: 'A', empresa: '', ticket: '', obs: '' }, { db });
async function advanceOf(fornCod, cod) {
  const list = await viaSdk('erp/adiantamentos/' + fornCod);
  return (Array.isArray(list) ? list : Object.values(list || {})).find((a) => a.cod === cod);
}
async function chequesOf(advance) {
  return Promise.all((advance.chequeIds || []).map((id) => viaSdk('erp/chequesControle/' + id)));
}
async function editCheques(fornCod, cod, rows) {
  const advance = await advanceOf(fornCod, cod);
  return mod.changeAdvance(identity, { action: 'cheques', operationId: randomUUID(), fornCod, adtCod: cod, expected: advance, cheques: rows }, { db });
}
const rowsOf = async (advance) => (await chequesOf(advance)).map((c) => ({ id: c.id, b: c.b, n: c.n, v: c.v, d: c.d.split('/').reverse().join('-'), venc: c.venc ? c.venc.split('/').reverse().join('-') : '', cli: c.emitente || '' }));
const locks = () => Object.keys(srv.read('erpFinanceAdvanceLocks') || {});

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
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});

test('corrige número e valor de um cheque; o total do adiantamento acompanha', async () => {
  srv.reset(baseData());
  const { advance } = await create('F1', [{ b: 'Sicredi', n: '150', v: 1000 }, { b: 'Itaú', n: '77', v: 500 }]);
  const rows = await rowsOf(await advanceOf('F1', advance.cod));
  rows[0].n = '151';
  rows[1].v = 450.5;
  rows[1].venc = '2026-12-01';
  const result = await editCheques('F1', advance.cod, rows);
  assert.equal(result.action, 'cheques');
  const stored = await advanceOf('F1', advance.cod);
  assert.equal(stored.valor, 1450.5);
  const cheques = await chequesOf(stored);
  assert.deepEqual(cheques.map((c) => [c.b, c.n, c.v, c.venc]), [['Sicredi', '151', 1000, ''], ['Itaú', '77', 450.5, '01/12/2026']]);
  assert.deepEqual(cheques.map((c) => c.id), rows.map((r) => r.id));
  const again = await rowsOf(stored);
  again[0].cli = 'JOAO';
  await editCheques('F1', advance.cod, again);
  assert.equal((await chequesOf(await advanceOf('F1', advance.cod)))[0].emitente, 'JOAO');
  await mod.changeAdvance(identity, { action: 'delete', operationId: randomUUID(), fornCod: 'F1', adtCod: advance.cod, expected: await advanceOf('F1', advance.cod) }, { db });
  assert.equal(await advanceOf('F1', advance.cod), undefined);
  assert.deepEqual(Object.keys(srv.read('erp/chequesControle') || {}), []);
  assert.deepEqual(locks(), []);
});

test('inclui e remove cheques da lista', async () => {
  srv.reset(baseData());
  const { advance } = await create('F1', [{ b: 'Sicredi', n: '10', v: 100 }, { b: 'Sicredi', n: '11', v: 200 }]);
  const rows = await rowsOf(await advanceOf('F1', advance.cod));
  const result = await editCheques('F1', advance.cod, [rows[1], { b: 'Bradesco', n: '9', v: 50, d: '2026-11-11' }]);
  assert.deepEqual(result.removedChequeIds, [rows[0].id]);
  const stored = await advanceOf('F1', advance.cod);
  assert.equal(stored.valor, 250);
  assert.equal(stored.chequeIds.length, 2);
  assert.equal(srv.read('erp/chequesControle/' + rows[0].id), null);
  const added = (await chequesOf(stored)).find((c) => c.n === '9');
  assert.equal(added.advanceCode, advance.cod);
  assert.equal(added.s, 'A');
});

test('não aceita cheque repetido (mesmo banco e número) de outro adiantamento nem da própria lista', async () => {
  srv.reset(baseData());
  await create('F2', [{ b: 'Sicredi', n: '500', v: 10 }]);
  const { advance } = await create('F1', [{ b: 'Sicredi', n: '501', v: 10 }, { b: 'Itaú', n: '1', v: 5 }]);
  const rows = await rowsOf(await advanceOf('F1', advance.cod));
  rows[0].n = '500';
  await assert.rejects(editCheques('F1', advance.cod, rows), { code: 'CHEQUE_ALREADY_EXISTS' });
  rows[0].n = '0001';
  rows[0].b = 'Itaú';
  await assert.rejects(editCheques('F1', advance.cod, rows), { code: 'DUPLICATE_CHEQUE' });
  rows[0].b = 'Itaú';
  rows[0].n = '2';
  await editCheques('F1', advance.cod, rows);
  assert.deepEqual(locks(), []);
});

test('cheque compensado não muda, mas os outros podem ser corrigidos', async () => {
  srv.reset(baseData());
  const { advance } = await create('F1', [{ b: 'Sicredi', n: '20', v: 100 }, { b: 'Sicredi', n: '21', v: 100 }]);
  const before = await advanceOf('F1', advance.cod);
  await db.ref('erp/chequesControle/' + before.chequeIds[0]).update({ s: 'C', cd: '11/11/2026' });
  const rows = await rowsOf(before);
  rows[0].n = '25';
  await assert.rejects(editCheques('F1', advance.cod, rows), { code: 'CHEQUE_ALREADY_CLEARED' });
  rows[0].n = '20';
  rows[1].n = '22';
  await editCheques('F1', advance.cod, rows);
  const cheques = await chequesOf(await advanceOf('F1', advance.cod));
  assert.deepEqual(cheques.map((c) => [c.n, c.s]), [['20', 'C'], ['22', 'A']]);
  await assert.rejects(editCheques('F1', advance.cod, [await rowsOf(await advanceOf('F1', advance.cod)).then((r) => r[1])]), { code: 'CHEQUE_ALREADY_CLEARED' });
});

test('adiantamento já usado em compra: corrige número, mas não valor', async () => {
  srv.reset(baseData());
  const { advance } = await create('F1', [{ b: 'Sicredi', n: '30', v: 1000 }]);
  const list = await viaSdk('erp/adiantamentos/F1');
  const index = list.findIndex((a) => a.cod === advance.cod);
  await db.ref('erp/adiantamentos/F1/' + index).update({ valor: 400, valorOriginal: 1000, valorCompensado: 600 });
  const rows = await rowsOf(await advanceOf('F1', advance.cod));
  rows[0].v = 900;
  await assert.rejects(editCheques('F1', advance.cod, rows), { code: 'ADVANCE_ALREADY_COMPENSATED' });
  rows[0].v = 1000;
  rows[0].n = '31';
  await editCheques('F1', advance.cod, rows);
  const stored = await advanceOf('F1', advance.cod);
  assert.equal(stored.valor, 400);
  assert.equal((await chequesOf(stored))[0].n, '31');
});

test('tela: editar adiantamento em cheque abre a correção dos cheques', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  assert.match(core, /action:'cheques'/);
});
