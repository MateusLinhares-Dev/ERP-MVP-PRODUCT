import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { readBalance, sameBalance } from '../server/modules/purchases/domain/supplier-balance.ts';

const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canFinance: true, canPurchasing: true, canPayables: true };
const NOW = Date.UTC(2026, 10, 19, 15, 0, 0);
let srv, db, app, changeSupplierBalance, createPurchaseOrder;
const read = async (path) => (await db.ref(path).get()).val();
const call = (body, who = identity, operationId = randomUUID()) =>
  changeSupplierBalance(who, { operationId, ...body }, { db, now: () => NOW, uuid: () => '00000000-0000-4000-8000-000000000abc' });
const reject = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
};
const baseData = () => ({ erp: {
  _ts: 1,
  fornecedores: { F1: { cod: 'F001', nome: 'JOÃO ELIAS' }, F2: { cod: 'F002', nome: 'EDUARDO FAGUNDES' }, F3: { cod: 'F003', nome: 'CICLO' } },
  saldoDevedor: { F001: { valor: 1200, data: '01/10/2026' }, F002: { valor: 200, ticket: 'T284' } },
  saldos: { F001: { valor: 1200, data: '01/10/2026' }, F002: { valor: 200, ticket: 'T284' } },
  tickets: { T284: { ticket: 'T284', fornecedorCod: 'F002', totalGeral: 300, adiantamento: 500, status: 'Pago', saldoPagar: 0 } },
  adiantamentos: { F002: [{ cod: 'ADT500', valor: 500, status: 'Quitado', ticket: 'T284', forma: 'PIX' }] },
  contasPagar: {},
} });

before(async () => {
  srv = await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS = 'true';
  process.env.FIREBASE_PROJECT_ID = 'demo-erp-test';
  process.env.FIREBASE_DATABASE_URL = srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = srv.host;
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-erp-test.appspot.com';
  delete process.env.APP_ENV; delete process.env.VERCEL_ENV;
  const firebase = await import('../server/shared/firebase/firebase-admin.js');
  ({ app, db } = firebase.getFirebaseAdmin());
  ({ changeSupplierBalance, createPurchaseOrder } = await import('../server/modules/purchases/index.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});
beforeEach(() => srv.reset(baseData()));

test('regras: lê o saldo do nó do servidor e cai no espelho; número solto também vale', () => {
  assert.deepEqual(readBalance({ valor: 10, ticket: 'T1' }, { valor: 99 }).valor, 10);
  assert.equal(readBalance({ valor: 0, ticket: 'T1' }, { valor: 99 }).valor, 99);
  assert.equal(readBalance(null, 35.5).valor, 35.5);
  assert.equal(readBalance(null, { valor: 0 }), null);
  assert.equal(readBalance({ valor: 5, data: '2026-10-01' }).data, '01/10/2026');
  assert.equal(sameBalance(readBalance({ valor: 5, ticket: 'T1' }), { valor: 5, ticket: 'T1' }), true);
  assert.equal(sameBalance(readBalance({ valor: 5, ticket: 'T1' }), { valor: 6 }), false);
  assert.equal(sameBalance(readBalance({ valor: 5, ticket: 'T1' }), { ticket: '' }), false);
});

test('cancelar saldo devedor registrado tira dos dois nós e devolve o que saiu', async () => {
  const result = await call({ action: 'clear', fornCod: 'F001', expected: { valor: 1200, ticket: '' } });
  assert.deepEqual([result.kind, result.removed.valor, result.saldo], ['debt', 1200, null]);
  assert.equal(await read('erp/saldoDevedor/F001'), null);
  assert.equal(await read('erp/saldos/F001'), null);
  assert.ok((await read('erp/_ts')) >= NOW);
  await reject(call({ action: 'clear', fornCod: 'F001' }), 'BALANCE_NOT_FOUND');
});

test('cancelar crédito do fornecedor (sobra de adiantamento) também é possível, conferindo o valor visto', async () => {
  await reject(call({ action: 'clear', fornCod: 'F002', expected: { valor: 150, ticket: 'T284' } }), 'BALANCE_CHANGED');
  assert.equal((await read('erp/saldoDevedor/F002')).valor, 200);
  const result = await call({ action: 'clear', fornCod: 'F002', expected: { valor: 200, ticket: 'T284' } });
  assert.deepEqual([result.kind, result.removed.ticket], ['credit', 'T284']);
  assert.equal(await read('erp/saldoDevedor/F002'), null);
});

test('levar saldo devedor para Contas a Pagar cria a conta do fornecedor e tira o saldo, na mesma gravação', async () => {
  const result = await call({ action: 'to-payable', fornCod: 'F001', expected: { valor: 1200, ticket: '' } });
  const cp = await read('erp/contasPagar/' + result.payable.id);
  assert.deepEqual([cp.valor, cp.status, cp.origem, cp.fornCod, cp.cred, cp.cat, cp.tipoForn, cp.venc, cp.criadoPor], [1200, 'Pendente', 'compra_antiga', 'F001', 'JOÃO ELIAS', 'Compra de Sucata', 'compra', '19/11/2026', 'elaine']);
  assert.match(cp.desc, /Saldo devedor registrado — JOÃO ELIAS/);
  assert.match(cp.obs, /01\/10\/2026/);
  assert.equal(await read('erp/saldoDevedor/F001'), null);
  assert.equal(await read('erp/saldos/F001'), null);
});

test('crédito do fornecedor não vira conta a pagar (seria dívida no sentido errado)', async () => {
  await reject(call({ action: 'to-payable', fornCod: 'F002' }), 'BALANCE_IS_CREDIT');
  assert.equal((await read('erp/saldoDevedor/F002')).valor, 200);
  assert.equal(await read('erp/contasPagar'), null);
  await reject(call({ action: 'to-payable', fornCod: 'F001', venc: '31/02/2026' }), 'INVALID_DATE');
  await reject(call({ action: 'to-payable', fornCod: 'F003' }), 'BALANCE_NOT_FOUND');
});

test('permissão, operação repetida e trava do fornecedor', async () => {
  await reject(call({ action: 'clear', fornCod: 'F001' }, { ...identity, canFinance: false }), 'FINANCE_REQUIRED');
  await reject(call({ action: 'apagar', fornCod: 'F001' }), 'INVALID_ACTION');
  const operationId = randomUUID();
  const first = await call({ action: 'to-payable', fornCod: 'F001' }, identity, operationId);
  const again = await call({ action: 'to-payable', fornCod: 'F001' }, identity, operationId);
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.payable.id, first.payable.id);
  assert.equal(Object.keys(await read('erp/contasPagar')).length, 1);
  srv.seed('erpFinanceAdvanceLocks/F002', { owner: 'compra', expiresAt: NOW + 60000 });
  await reject(call({ action: 'clear', fornCod: 'F002' }), 'SUPPLIER_BALANCE_IN_PROGRESS');
  assert.equal((await read('erp/saldoDevedor/F002')).valor, 200);
});

test('compra que usa o crédito antigo deixa saldoDevedor e saldos iguais, mesmo sem espelho antes', async () => {
  srv.seed('erp/saldos/F002', null);
  await createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T286', fornecedorCod: 'F002', advanceCodes: [], chequeIds: [], useLegacyCredit: true, sourceTicketKeys: [],
    ticket: { ticket: 'T286', fornecedorCod: 'F002', fornecedor: 'EDUARDO FAGUNDES', itens: [{ mat: 'FERRO', pesoLiq: 3, preco: 50 }], totalGeral: 150, totalProdutos: 150, dataCompra: '2026-11-19', vencimentoSaldo: '2026-11-19', descontoCompra: 0, freteCompra: 0 } }, { db });
  assert.equal((await read('erp/saldoDevedor/F002')).valor, 50);
  assert.deepEqual(await read('erp/saldos/F002'), { valor: 50, ticket: 'T284' });
});

test('a tela pede ao servidor e a sincronização não grava mais os saldos de fornecedor', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sync, /_patchIncremental\(dados, 'saldos'/);
  assert.doesNotMatch(sync, /\['saldoDevedor',SALDO_DEVEDOR_FORN/);
  assert.match(sync, /delete dados\.saldoDevedorDeleted/);
  assert.doesNotMatch(core, /function registrarSaldoDevedor/);
  assert.doesNotMatch(core, /Registrar Saldo Devedor/);
  const ficha = core.slice(core.indexOf('function ffExcluirLancamento('), core.indexOf('function ffSaldoInicial('));
  assert.doesNotMatch(ficha, /_apagarChave\('saldoDevedor'/);
  assert.match(ficha, /_saldoFornApi\(\{action:'clear'/);
  assert.match(ficha, /_saldoFornApi\(\{action:'to-payable'/);
  const policy = JSON.parse(readFileSync(new URL('../public/app/rtdb-collection-policy.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  for (const node of ['saldos', 'saldoDevedor', 'saldoDevedorDeleted']) {
    assert.equal(policy.nodes[node].write.mode, 'none', node);
    assert.equal(rules.rules.erp[node]['.write'], false, node);
  }
  assert.deepEqual(rules.rules.erp.supplierBalanceOperations, { '.read': false, '.write': false });
});
