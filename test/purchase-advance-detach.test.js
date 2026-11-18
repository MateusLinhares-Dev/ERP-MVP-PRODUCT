import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

const today = '2026-11-17';
const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canPurchasing: true, canAdvances: true, canPayables: true, canFinance: true, canBanking: true };
let srv, db, app, mod = {};
const viaSdk = async (path) => (await db.ref(path).get()).val();
const baseData = () => ({ erp: {
  fornecedores: { f1: { cod: 'F1', nome: 'SAMOEL EVANGELISTA FILHO', ativo: true } },
  bancos: { b1: { cod: 'B1', banco: 'Conta Principal' } },
  tickets: {}, contasPagar: {}, adiantamentos: {}, _ts: 1,
} });
const advance = async (valor) => (await mod.createAdvance(identity, { operationId: randomUUID(), fornCod: 'F1', data: today, valor, forma: 'PIX', bancoCod: 'B1', empresa: '', ticket: '', obs: '' }, { db })).advance.cod;
function ticket(no, total, parcelas) {
  return { ticket: no, fornecedorCod: 'F1', fornecedor: 'SAMOEL EVANGELISTA FILHO', fornecedorNome: 'SAMOEL EVANGELISTA FILHO',
    itens: [{ mat: 'COBRE', pesoLiq: 1, quantidade: 1, preco: total, total }], totalProdutos: total, totalGeral: total,
    descontoCompra: 0, freteCompra: 0, dataCompra: today, vencimentoSaldo: today, status: 'Pendente', _consolidado: true, ...(parcelas ? { parcelas } : {}) };
}
const create = (t, advanceCodes) => mod.createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: t.ticket, fornecedorCod: 'F1', ticket: t, advanceCodes, chequeIds: [], useLegacyCredit: false, sourceTicketKeys: [] }, { db });
const detach = (ticketNo, adtCod, who = identity, operationId = randomUUID()) => mod.detachPurchaseAdvance(who, { operationId, ticketNo, adtCod }, { db });
const advanceOf = async (cod) => (Object.values((await viaSdk('erp/adiantamentos/F1')) || {})).find((a) => a.cod === cod);
const payables = async (no) => Object.values((await viaSdk('erp/contasPagar')) || {}).filter((p) => p.ticket === no).sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.valor, p.status]);
const locks = () => ['erpFinancePayableTicketLocks', 'erpFinanceAdvanceLocks', 'erpFinancePayableLocks'].flatMap((root) => Object.keys(srv.read(root) || {}).map((k) => root + '/' + k));

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
  mod = {
    ...(await import('../server/modules/purchases/index.js')),
    ...(await import('../server/modules/advances/application/advances.js')),
  };
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});

test('caso da cliente (T269): tirar o adiantamento de R$ 3.424,95 devolve ao adiantamento, aumenta o saldo e a conta; depois ele pode ser excluído', async () => {
  srv.reset(baseData());
  const small = await advance(3424.95);
  const forty = await advance(40000);
  const hundred = await advance(100000);
  await create(ticket('T269', 271733.6), [small, forty, hundred]);
  assert.deepEqual(await payables('T269'), [['CPPO_T269', 128308.65, 'Pendente']]);
  assert.equal((await advanceOf(small)).status, 'Quitado');
  const result = await detach('T269', small);
  assert.equal(result.valor, 3424.95);
  const t = await viaSdk('erp/tickets/T269');
  assert.deepEqual([t.adiantamento, t.saldoPagar, t.status, t.totalGeral], [140000, 131733.6, 'Pendente', 271733.6]);
  assert.equal(t.parcelas[0].valor, 131733.6);
  assert.deepEqual(t.reciboFinanceiro.adiantamentos.map((r) => [r.cod, r.valorAplicado]), [[small, 0], [forty, 40000], [hundred, 100000]]);
  assert.equal(t.reciboFinanceiro.devolucoes.at(-1).valor, 3424.95);
  assert.deepEqual(await payables('T269'), [['CPPO_T269', 131733.6, 'Pendente']]);
  const freed = await advanceOf(small);
  assert.deepEqual([freed.status, freed.valor, freed.valorCompensado, freed.ticket || '', freed.ticketOrigem], ['Pendente', 3424.95, 0, '', undefined]);
  assert.equal((await advanceOf(forty)).status, 'Quitado', 'os outros adiantamentos da compra não mudam');
  assert.deepEqual(locks(), []);
  const removed = await mod.changeAdvance(identity, { action: 'delete', operationId: randomUUID(), fornCod: 'F1', adtCod: small, expected: freed }, { db });
  assert.equal(removed.action, 'delete');
  assert.equal(await advanceOf(small), undefined);
  await assert.rejects(detach('T269', small), { code: 'ADVANCE_NOT_IN_PURCHASE' });
});

test('compra quitada só com adiantamento: tirar o adiantamento cria a conta a pagar da diferença', async () => {
  srv.reset(baseData());
  const code = await advance(1000);
  await create(ticket('T300', 1000), [code]);
  assert.equal((await viaSdk('erp/tickets/T300')).status, 'Pago');
  await detach('T300', code);
  const t = await viaSdk('erp/tickets/T300');
  assert.deepEqual([t.adiantamento, t.saldoPagar, t.status], [0, 1000, 'Pendente']);
  const rows = await payables('T300');
  assert.equal(rows.length, 1);
  assert.match(rows[0][0], /^CP-AJUSTE-T300-/);
  assert.deepEqual(rows[0].slice(1), [1000, 'Pendente']);
  assert.equal((await advanceOf(code)).status, 'Pendente');
});

test('adiantamento usado em parte e compra parcelada: devolve só o usado e aumenta a última parcela em aberto', async () => {
  srv.reset(baseData());
  const code = await advance(600);
  const plan = [{ vencimento: '2026-11-17', valor: 200, forma: 'PIX' }, { vencimento: '2026-12-17', valor: 0, forma: 'PIX' }];
  await create(ticket('T400', 1000, plan), [code]);
  assert.deepEqual(await payables('T400'), [['CPPO_T400-1', 200, 'Pendente'], ['CPPO_T400-2', 200, 'Pendente']]);
  await detach('T400', code);
  assert.deepEqual(await payables('T400'), [['CPPO_T400-1', 200, 'Pendente'], ['CPPO_T400-2', 800, 'Pendente']]);
  const t = await viaSdk('erp/tickets/T400');
  assert.deepEqual([t.saldoPagar, t.adiantamento, t.parcelas.map((p) => p.valor)], [1000, 0, [200, 800]]);
  const freed = await advanceOf(code);
  assert.deepEqual([freed.status, freed.valor, freed.valorCompensado], ['Pendente', 600, 0]);
});

test('proteções: perfil sem acesso, operação repetida, pedido mudado e trava liberada', async () => {
  srv.reset(baseData());
  const code = await advance(500);
  await create(ticket('T500', 2000), [code]);
  await assert.rejects(detach('T500', code, { ...identity, canAdvances: false, canFinance: false }), { status: 403 });
  await assert.rejects(mod.detachPurchaseAdvance(identity, { operationId: randomUUID(), ticketNo: 'T500', adtCod: code, expected: { adiantamento: 400, saldoPagar: 1500, totalGeral: 2000 } }, { db }), { code: 'TICKET_CHANGED' });
  const operationId = randomUUID();
  const first = await detach('T500', code, identity, operationId);
  const again = await detach('T500', code, identity, operationId);
  assert.equal(again.alreadyCommitted, true);
  assert.equal(first.valor, again.valor);
  assert.equal((await viaSdk('erp/tickets/T500')).saldoPagar, 2000, 'repetir não devolve duas vezes');
  await assert.rejects(detach('T999', code), { code: 'TICKET_NOT_FOUND' });
  assert.deepEqual(locks(), []);
});

test('endpoint e telas: API própria, tela da compra e lista de adiantamentos oferecem "tirar da compra"', async () => {
  assert.match(readFileSync(new URL('../api/finance/purchase-advance-detach.ts', import.meta.url), 'utf8'), /detachPurchaseAdvance\(identity, body as Body\)/);
  const purchase = readFileSync(new URL('../public/modules/purchase-order/purchase-order.js', import.meta.url), 'utf8');
  assert.match(purchase, /onclick="phase4PurchaseDetachAdvance\(/);
  assert.match(purchase, /global\.erpPurchaseDetachAdvance=purchaseDetachAdvance;/);
  assert.match(purchase, /fetch\('\/api\/finance\/purchase-advance-detach'/);
  const code = readFileSync(new URL('../public/modules/finance/advance-actions.js', import.meta.url), 'utf8');
  const { runInNewContext } = await import('node:vm');
  const calls = [];
  const confirms = [];
  const toasts = [];
  let attempt = 0;
  const ctx = {
    console,
    ADT_POR_FORN: { F1: [{ cod: 'ADT1', valor: 3424.95, status: 'Quitado', ticket: 'T269' }] },
    TICKETS_DB: { T269: { ticket: 'T269', adiantamento: 143424.95, saldoPagar: 128308.65, totalGeral: 271733.6, reciboFinanceiro: { versao: 2, adiantamentos: [{ cod: 'ADT1', valorAplicado: 3424.95 }, { cod: 'ADT2', valorAplicado: 140000 }] } } },
    confirm: (message) => { confirms.push(message); return true; },
    showToast: (message, kind) => toasts.push([kind, message]),
    _adtCommitTransacional: async (payload) => {
      calls.push(['delete', payload.adtCod]);
      if (attempt++ === 0) { const error = new Error('usado'); error.code = 'ADVANCE_ALREADY_COMPENSATED'; throw error; }
      return { action: 'delete' };
    },
    erpPurchaseDetachAdvance: async (ticketNo, adtCod, expected) => { calls.push(['detach', ticketNo, adtCod, expected.saldoPagar]); ctx.ADT_POR_FORN.F1[0].status = 'Pendente'; return {}; },
  };
  ctx.window = ctx;
  runInNewContext(code, ctx);
  const done = await ctx.ERPAdvanceActions.deleteAdvance('F1', 'ADT1');
  assert.equal(done, true);
  assert.equal(JSON.stringify(calls), JSON.stringify([['delete', 'ADT1'], ['detach', 'T269', 'ADT1', 128308.65], ['delete', 'ADT1']]));
  assert.match(confirms[1], /Pedido T269: R\$ 3\.424,95/);
  assert.match(confirms[1], /saldo a pagar da compra aumenta/);
  assert.ok(toasts.some(([kind, message]) => kind === 'success' && /retirado da compra/.test(message)));
});
