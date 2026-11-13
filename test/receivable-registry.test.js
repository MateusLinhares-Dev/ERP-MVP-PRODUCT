import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { cleanCheques, cleanFields, removableCheques } from '../server/modules/receivables/domain/receivable-rules.ts';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canReceivables: true };
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);
let srv, db, app, changeReceivable;
const read = async (path) => (await db.ref(path).get()).val();
const list = (value) => (Array.isArray(value) ? value : Object.values(value || {}));
const call = (body, who = identity) => changeReceivable(who, { operationId: randomUUID(), ...body }, { db, now: () => NOW });
const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
};

const baseData = () => ({
  erp: {
    _ts: 1,
    bancos: { B1: { cod: 'B1', banco: 'Sicredi' } },
    chequesCli: { TUPY: [{ num: '1', banco: 'Itaú', valor: 10, status: 'Compensado' }] },
    contasReceber: {
      CR1: { id: 'CR1', cli: 'TUPY', nf: '55', valor: 300, status: 'Pendente', venc: '10/11/2026', data: '01/11/2026', atualizadoEm: 7 },
      CRV: { id: 'CRV', cli: 'GERDAU', valor: 100, status: 'Pendente', venc: '10/11/2026', vendaId: 'VD-1' },
    },
  },
});

before(async () => {
  srv = await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS = 'true';
  process.env.FIREBASE_PROJECT_ID = 'demo-erp-test';
  process.env.FIREBASE_DATABASE_URL = srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = srv.host;
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-erp-test.appspot.com';
  delete process.env.APP_ENV;
  delete process.env.VERCEL_ENV;
  const firebase = await import('../server/shared/firebase/firebase-admin.js');
  ({ app, db } = firebase.getFirebaseAdmin());
  ({ changeReceivable } = await import('../server/modules/receivables/application/receivable-registry.js'));
});
beforeEach(() => srv.reset(baseData()));
after(async () => {
  try {
    await app?.delete();
  } catch {}
  await srv?.close();
});

test('regras: campos obrigatórios, valor em formato brasileiro, cheques válidos e sem repetição', () => {
  assert.equal(cleanFields({ cli: 'X', valor: '0' }, true).problem.code, 'INVALID_AMOUNT');
  const ok = cleanFields({ cli: '  TUPY  ', valor: '1.234,56', venc: '2026-12-01' }, true).fields;
  assert.deepEqual(ok, { cli: 'TUPY', valor: 1234.56, venc: '01/12/2026' });
  assert.equal(cleanCheques([{ num: '1', valor: 10 }, { num: '1', valor: 5 }]).problem.message, 'O cheque nº 1 foi informado duas vezes.');
  assert.equal(cleanCheques([{ num: '', valor: 10 }]).problem.code, 'INVALID_CHEQUE');
  const { keep, blocked } = removableCheques(
    [{ num: '7', tipo: 'Recebimento', status: 'Pendente', contaReceberId: 'CR1' }, { num: '8', status: 'Compensado', contaReceberId: 'CR1' }, { num: '9' }],
    { id: 'CR1' },
  );
  assert.deepEqual([keep.map((row) => row.num), blocked], [['9'], ['8']]);
});

test('lançar e lançar já recebido (pagamento avulso da Ficha) com lançamento no banco', async () => {
  const created = await call({ action: 'create', receivable: { cli: 'TUPY', valor: '500', venc: '2026-12-01', nf: 'X1' } });
  const stored = await read('erp/contasReceber/' + created.receivable.id);
  assert.deepEqual([stored.status, stored.valor, stored.venc, stored.data], ['Pendente', 500, '01/12/2026', '12/11/2026']);
  const paid = await changeReceivable(
    { ...identity, canReceivables: false, canCustomers: true },
    { action: 'create', receivable: { cli: 'TUPY', valor: 80, venc: '2026-11-12', obs: 'Pagamento avulso' }, received: { date: '2026-11-12', bank: 'B1', method: 'PIX' } },
    { db, now: () => NOW },
  );
  assert.equal(paid.receivable.status, 'Recebido');
  const movement = await read('erp/lancBanco/' + paid.receivable.movBancoId);
  assert.deepEqual([movement.bancoCod, movement.valor, movement.tipo], ['B1', 80, 'Entrada']);
  const denied = await failure(changeReceivable({ ...identity, canReceivables: false, canCustomers: true }, { action: 'delete', id: 'CR1' }, { db }));
  assert.equal(denied?.code, 'RECEIVABLES_REQUIRED');
});

test('dar baixa pelo banco e estornar: o lançamento do banco é criado e depois desfeito com marca de exclusão', async () => {
  const received = await call({ action: 'receive', id: 'CR1', date: '2026-11-12', bank: 'B1' });
  const movementId = received.receivable.movBancoId;
  assert.equal((await read('erp/contasReceber/CR1')).status, 'Recebido');
  assert.equal((await read('erp/lancBanco/' + movementId)).valor, 300);
  assert.equal((await failure(call({ action: 'receive', id: 'CR1', date: '2026-11-12' })))?.code, 'ALREADY_RECEIVED');
  const reopened = await call({ action: 'reopen', id: 'CR1' });
  assert.deepEqual(reopened.bankUndone, [movementId]);
  const row = await read('erp/contasReceber/CR1');
  assert.deepEqual([row.status, row.dataReceb, row.movBancoId, row.banco, row.bancoCod], ['Pendente', '', undefined, '—', '']);
  assert.equal(await read('erp/lancBanco/' + movementId), null);
  assert.equal((await read('erp/lancBancoDeletedV2'))[movementId], true);
});

test('baixa em cheques: cheques vão para o cliente; estorno tira os pendentes e bloqueia se algum já foi compensado', async () => {
  await call({ action: 'receive', id: 'CR1', date: '2026-11-12', cheques: [{ num: '100', banco: 'BB', valor: 200, bomPara: '2026-12-10' }, { num: '101', banco: 'BB', valor: 100 }] });
  const row = await read('erp/contasReceber/CR1');
  assert.deepEqual([row.forma, list(row.chequesRecebimento)], ['Cheque', ['100', '101']]);
  assert.match(row.obs, /2 cheque\(s\) — R\$ 300,00/);
  const cheques = list(await read('erp/chequesCli/TUPY'));
  assert.deepEqual(cheques.map((cheque) => [cheque.num, cheque.status, cheque.bomPara]), [['1', 'Compensado', undefined], ['100', 'Pendente', '10/12/2026'], ['101', 'Pendente', '']]);
  await db.ref('erp/chequesCli/TUPY/1/status').set('Compensado');
  assert.equal((await failure(call({ action: 'reopen', id: 'CR1' })))?.code, 'CHEQUE_ALREADY_USED');
  await db.ref('erp/chequesCli/TUPY/1/status').set('Pendente');
  await call({ action: 'reopen', id: 'CR1' });
  assert.deepEqual(list(await read('erp/chequesCli/TUPY')).map((cheque) => cheque.num), ['1']);
  assert.equal((await read('erp/contasReceber/CR1')).forma, '—');
});

test('editar: conflito, conta de venda não muda valor nem cliente e não pode ser excluída aqui', async () => {
  const edited = await call({ action: 'update', id: 'CR1', receivable: { venc: '2026-11-30', obs: 'negociado' }, expectedUpdate: 7 });
  assert.equal(edited.receivable.venc, '30/11/2026');
  assert.equal((await failure(call({ action: 'update', id: 'CR1', receivable: { obs: 'x' }, expectedUpdate: 7 })))?.code, 'RECEIVABLE_CHANGED');
  assert.equal((await failure(call({ action: 'update', id: 'CRV', receivable: { valor: 50 } })))?.code, 'RECEIVABLE_FROM_SALE');
  assert.equal((await call({ action: 'update', id: 'CRV', receivable: { venc: '2026-12-20' } })).receivable.venc, '20/12/2026');
  assert.equal((await failure(call({ action: 'delete', id: 'CRV' })))?.code, 'RECEIVABLE_FROM_SALE');
});

test('excluir conta recebida desfaz o banco; marca de exclusão impede que volte; repetição devolve o mesmo resultado', async () => {
  const received = await call({ action: 'receive', id: 'CR1', date: '2026-11-12', bank: 'B1' });
  const result = await call({ action: 'delete', id: 'CR1' });
  assert.deepEqual(result.bankUndone, [received.receivable.movBancoId]);
  assert.equal(await read('erp/contasReceber/CR1'), null);
  assert.equal((await read('erp/contasReceberDeletedV2')).CR1, true);
  const operationId = randomUUID();
  const body = { operationId, action: 'create', receivable: { cli: 'A', valor: 1, venc: '2026-12-01' } };
  const first = await changeReceivable(identity, body, { db, now: () => NOW });
  const again = await changeReceivable(identity, body, { db, now: () => NOW });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.receivable.id, first.receivable.id);
  const endpoint = readFileSync(new URL('../api/finance/receivables.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /changeReceivable\(identity, body as Body\)/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.erp;
  for (const node of ['contasReceber', 'contasReceberDeleted', 'contasReceberDeletedV2']) assert.equal(rules[node]['.write'], false, node);
  for (const node of ['erpReceivableLocks', 'receivableOperations']) assert.deepEqual(rules[node], { '.read': false, '.write': false }, node);
});
