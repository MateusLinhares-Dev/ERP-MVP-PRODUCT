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
    ...(await import('../server/modules/payables/application/payables.js')),
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

const pay = (payableId, valor, amount) =>
  mod.payPayable(identity, { payableId, operationId: randomUUID(), bankCode: 'B1', date: today, amount, expected: { valor, status: 'Pendente', paymentsCount: 0 } }, { db });

test('pagamento parcial já feito pelo banco continua pago: tirar o adiantamento só aumenta o que falta', async () => {
  srv.reset(baseData());
  const code = await advance(300);
  await create(ticket('T600', 1000), [code]);
  await pay('CPPO_T600', 700, 200);
  const before = await viaSdk('erp/contasPagar/CPPO_T600');
  assert.deepEqual([before.valor, before.valorPago, (before.pagamentos || []).length], [500, 200, 1]);
  assert.equal((await viaSdk('erp/tickets/T600')).saldoPagar, 500);
  await detach('T600', code);
  const after = await viaSdk('erp/contasPagar/CPPO_T600');
  assert.deepEqual([after.valor, after.valorPago, after.status, (after.pagamentos || []).length], [800, 200, 'Pendente', 1], 'o pagamento de R$ 200 fica registrado');
  const t = await viaSdk('erp/tickets/T600');
  assert.deepEqual([t.saldoPagar, t.adiantamento, t.status], [800, 0, 'Parcial']);
  const movements = Object.values((await viaSdk('erp/lancBanco')) || {});
  assert.equal(movements.filter((m) => m.payableId === 'CPPO_T600').length, 1, 'a saída do banco do pagamento continua');
});

test('compra quitada pelo banco e pelo adiantamento: tirar o adiantamento cria a conta só da parte dele', async () => {
  srv.reset(baseData());
  const code = await advance(400);
  await create(ticket('T610', 1000), [code]);
  await pay('CPPO_T610', 600, 600);
  assert.equal((await viaSdk('erp/tickets/T610')).status, 'Pago');
  await detach('T610', code);
  const rows = await payables('T610');
  assert.deepEqual(rows.map((r) => [r[0].replace(/-[a-f0-9]{8}$/, ''), r[1], r[2]]), [['CP-AJUSTE-T610', 400, 'Pendente'], ['CPPO_T610', 600, 'Pago']]);
  const t = await viaSdk('erp/tickets/T610');
  assert.deepEqual([t.saldoPagar, t.status], [400, 'Parcial']);
});

test('extrato e histórico: o movimento do adiantamento continua até ele ser excluído; compra e adiantamento guardam a devolução', async () => {
  srv.reset(baseData());
  const code = await advance(250);
  const movementId = (await advanceOf(code)).movBancoId;
  assert.ok(movementId);
  await create(ticket('T620', 1000), [code]);
  await detach('T620', code);
  assert.ok(await viaSdk('erp/lancBanco/' + movementId), 'o dinheiro saiu do banco de verdade: o movimento fica');
  const freed = await advanceOf(code);
  assert.deepEqual(freed.devolucoesCompra.map((d) => [d.ticket, d.valor]), [['T620', 250]]);
  const t = await viaSdk('erp/tickets/T620');
  assert.deepEqual(t.reciboFinanceiro.devolucoes.at(-1).adiantamentos, [{ cod: code, valor: 250 }]);
  assert.deepEqual(t.reciboFinanceiro.adiantamentos.map((r) => [r.cod, r.valorOriginal, r.valorAplicado]), [[code, 250, 0]], 'a linha do recibo fica, com aplicado zero');
  await mod.changeAdvance(identity, { action: 'delete', operationId: randomUUID(), fornCod: 'F1', adtCod: code, expected: freed }, { db });
  assert.equal(await viaSdk('erp/lancBanco/' + movementId), null, 'excluir o adiantamento tira a saída do banco');
});

test('depois de tirar: editar e excluir a compra funcionam e não devolvem o adiantamento de novo', async () => {
  srv.reset(baseData());
  const a = await advance(300);
  const b = await advance(200);
  await create(ticket('T630', 1000), [a, b]);
  await detach('T630', a);
  const expectedTicket = await viaSdk('erp/tickets/T630');
  const next = structuredClone(expectedTicket);
  next.itens[0].preco = 900; next.itens[0].total = 900; next.totalProdutos = 900; next.totalGeral = 900;
  await mod.editPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T630', expectedTicket, ticket: next }, { db });
  const edited = await viaSdk('erp/tickets/T630');
  assert.deepEqual([edited.totalGeral, edited.adiantamento, edited.saldoPagar], [900, 200, 700]);
  assert.deepEqual(await payables('T630'), [['CPPO_T630', 700, 'Pendente']]);
  assert.deepEqual([(await advanceOf(a)).valor, (await advanceOf(a)).status], [300, 'Pendente']);
  await mod.deletePurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T630', expectedTotal: 900, expectedSupplier: 'F1' }, { db });
  assert.equal(await viaSdk('erp/tickets/T630'), null);
  assert.deepEqual([(await advanceOf(a)).valor, (await advanceOf(a)).status], [300, 'Pendente'], 'o já devolvido não volta duas vezes');
  assert.deepEqual([(await advanceOf(b)).valor, (await advanceOf(b)).status], [200, 'Pendente'], 'o que estava na compra volta normalmente');
  assert.deepEqual(await payables('T630'), []);
});

test('adiantamento dividido entre duas compras: tirar de uma não mexe na outra', async () => {
  srv.reset(baseData());
  const code = await advance(1000);
  await create(ticket('T640', 600), [code]);
  await create(ticket('T641', 2000), [code]);
  const used = await advanceOf(code);
  assert.deepEqual([used.status, used.valorCompensado], ['Quitado', 1000]);
  await detach('T640', code);
  const partial = await advanceOf(code);
  assert.deepEqual([partial.status, partial.valor, partial.valorCompensado], ['Pendente', 600, 400]);
  const other = await viaSdk('erp/tickets/T641');
  assert.deepEqual([other.adiantamento, other.saldoPagar], [400, 1600], 'a outra compra continua com os R$ 400');
  assert.deepEqual([(await viaSdk('erp/tickets/T640')).saldoPagar], [600]);
  await detach('T641', code);
  const free = await advanceOf(code);
  assert.deepEqual([free.status, free.valor, free.valorCompensado], ['Pendente', 1000, 0]);
});

test('compra antiga sem recibo novo: recusa com explicação e não altera nada', async () => {
  srv.reset(baseData());
  const code = await advance(100);
  await create(ticket('T650', 1000), [code]);
  const legacy = await viaSdk('erp/tickets/T650');
  legacy.reciboFinanceiro.versao = 1;
  srv.seed('erp/tickets/T650', legacy);
  await assert.rejects(detach('T650', code), { code: 'ADVANCE_RECONCILIATION_REQUIRED' });
  assert.equal((await viaSdk('erp/tickets/T650')).saldoPagar, 900);
  assert.equal((await advanceOf(code)).status, 'Quitado');
  assert.deepEqual(locks(), []);
});

test('notinha já salva: usar adiantamento lançado depois (caso T353) pelo mesmo caminho de Contas a Pagar', async () => {
  const { runInNewContext } = await import('node:vm');
  const purchase = readFileSync(new URL('../public/modules/purchase-order/purchase-order.js', import.meta.url), 'utf8');
  const start = purchase.indexOf('function openPurchasePayables(key){');
  const end = purchase.indexOf('global.phase4PurchaseUseAdvance=async function(){', start);
  assert.ok(start > 0 && end > start);
  const ctx = {
    TICKETS_DB: { T353: { ticket: 'T353', _purchaseOperationId: 'op' }, T001: { ticket: 'T001' } },
    CONTAS_PAGAR: [{ id: 'CPPO_T353', ticket: 'T353', status: 'Pendente', valor: 18116.16 }, { id: 'CPPO_T001', ticket: 'T001', status: 'Pendente', valor: 10 }],
    ADT_POR_FORN: { F1: [{ cod: 'A1', status: 'Quitado', valor: 52506.24, ticket: 'T353' }, { cod: 'A2', status: 'Pendente', valor: 150093.96 }, { cod: 'A3', status: 'Pendente', valor: 99, ticket: 'T999' }] },
    money: (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
  ctx.tickets = () => ctx.TICKETS_DB;
  runInNewContext(purchase.slice(start, end), ctx);
  const html = ctx.freeAdvanceHtml({ editKey: 'T353', supplierCode: 'F1' });
  assert.match(html, /R\$ 150\.093,96/);
  assert.match(html, /Usar R\$ 18\.116,16 quita o saldo desta compra e sobra R\$ 131\.977,80/);
  assert.equal(ctx.freeAdvanceHtml({ editKey: 'T001', supplierCode: 'F1' }), '', 'compra antiga sem confirmação do servidor: segue por Contas a Pagar');
  ctx.CONTAS_PAGAR[0].status = 'Pago';
  assert.equal(ctx.freeAdvanceHtml({ editKey: 'T353', supplierCode: 'F1' }), '', 'sem saldo, sem aviso');
  const island = readFileSync(new URL('../web/erp/payables.tsx', import.meta.url), 'utf8');
  assert.match(island, /erpPayablesCompensateAdvance: async/);
  assert.match(island, /'advance-only'/);
});
