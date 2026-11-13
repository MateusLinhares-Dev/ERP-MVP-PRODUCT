import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

const today = '2026-11-10';
const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canPurchasing: true, canAdvances: true, canPayables: true, canFinance: true, canBanking: true };
let srv, db, app, mod = {};
const viaSdk = async (path) => (await db.ref(path).get()).val();
const locks = () => ['erpFinancePayableTicketLocks', 'erpFinancePayableLocks'].flatMap((root) => Object.keys(srv.read(root) || {}));
const baseData = () => ({ erp: {
  fornecedores: { f1: { cod: 'F1', nome: 'JOAO ELIAS', ativo: true } },
  bancos: { b1: { cod: 'B1', banco: 'Sicredi' } },
  tickets: {}, contasPagar: {}, adiantamentos: {}, lancBanco: {}, _ts: 1,
} });
function purchaseTicket(no, total) {
  return { ticket: no, fornecedorCod: 'F1', fornecedor: 'JOAO ELIAS', fornecedorNome: 'JOAO ELIAS',
    itens: [{ mat: 'COBRE', pesoLiq: 100, quantidade: 100, preco: total / 100, total }], totalProdutos: total, totalGeral: total,
    descontoCompra: 0, freteCompra: 0, dataCompra: today, vencimentoSaldo: today, status: 'Pendente', _consolidado: true, _purchaseOperationId: 'x' };
}
const create = (ticket) => mod.createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: ticket.ticket, fornecedorCod: 'F1',
  ticket, advanceCodes: [], chequeIds: [], useLegacyCredit: false, sourceTicketKeys: [] }, { db });
async function pay(payableId, amount, advanceAmount = 0) {
  const current = await viaSdk('erp/contasPagar/' + payableId);
  return mod.payPayable(identity, { payableId, operationId: randomUUID(), bankCode: amount ? 'B1' : '', date: today, amount, advanceAmount, fornCod: 'F1',
    expected: { valor: current.valor, status: current.status, paymentsCount: (current.pagamentos || []).length } }, { db });
}
async function reverse(payableId, paymentIndex, override = {}) {
  const current = await viaSdk('erp/contasPagar/' + payableId);
  const payment = current.pagamentos[paymentIndex] || {};
  return mod.reversePayablePayment(identity, { payableId, paymentIndex, operationId: randomUUID(),
    payment: { data: payment.data, valor: payment.valor, movBancoId: payment.movBancoId || '' },
    expected: { valor: current.valor, status: current.status, paymentsCount: (current.pagamentos || []).length }, ...override }, { db });
}
const movementsOf = (payableId) => Object.values(srv.read('erp/lancBanco') || {}).filter((row) => row.payableId === payableId);

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
    ...(await import('../server/modules/purchases/application/create-purchase-order.js')),
    ...(await import('../server/modules/payables/application/payables.js')),
    ...(await import('../server/modules/payables/application/payment-reversal.js')),
    ...(await import('../server/modules/purchases/application/delete-purchase-order.js')),
  };
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});

test('compra: paga parte, exclui o pagamento e tudo volta como antes no Firebase', async () => {
  srv.reset(baseData());
  await create(purchaseTicket('T700', 1000));
  await pay('CPPO_T700', 300);
  assert.equal(movementsOf('CPPO_T700').length, 1);
  assert.equal(srv.read('erp/tickets/T700').saldoPagar, 700);
  assert.equal(srv.read('erp/tickets/T700').status, 'Parcial');
  const tsBefore = srv.read('erp/_ts');
  const movementId = movementsOf('CPPO_T700')[0].id;

  const result = await reverse('CPPO_T700', 0);
  const stored = await viaSdk('erp/contasPagar/CPPO_T700');
  assert.equal(stored.status, 'Pendente');
  assert.equal(stored.valor, 1000);
  assert.equal(stored.valorPago, 0);
  assert.equal((stored.pagamentos || []).length, 0);
  assert.equal(movementsOf('CPPO_T700').length, 0);
  assert.equal(srv.read('erp/lancBancoDeletedV2/' + movementId), true);
  assert.equal(srv.read('erp/tickets/T700').saldoPagar, 1000);
  assert.equal(srv.read('erp/tickets/T700').status, 'Pendente');
  assert.notEqual(srv.read('erp/_ts'), tsBefore);
  assert.equal(result.removedMovementId, movementId);
  assert.equal(result.reversedAmount, 300);
  assert.deepEqual(locks(), []);

  await pay('CPPO_T700', 1000);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T700')).status, 'Pago');
  assert.equal(srv.read('erp/tickets/T700').status, 'Pago');
});

test('conta quitada em dois pagamentos: excluir o primeiro deixa em aberto só esse valor', async () => {
  srv.reset(baseData());
  await create(purchaseTicket('T710', 1000));
  await pay('CPPO_T710', 300);
  await pay('CPPO_T710', 700);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T710')).status, 'Pago');
  await reverse('CPPO_T710', 0);
  const stored = await viaSdk('erp/contasPagar/CPPO_T710');
  assert.equal(stored.status, 'Pendente');
  assert.equal(stored.valor, 300);
  assert.equal(stored.valorPago, 700);
  assert.equal(stored.dataPgto, '');
  assert.deepEqual(stored.pagamentos.map((p) => p.valor), [700]);
  assert.equal(movementsOf('CPPO_T710').length, 1);
  assert.equal(srv.read('erp/tickets/T710').saldoPagar, 300);
  assert.equal(srv.read('erp/tickets/T710').status, 'Parcial');
});

test('exclusão recusada quando a conta mudou, o pagamento não confere, o adiantamento não é identificável ou falta permissão', async () => {
  srv.reset(baseData());
  await create(purchaseTicket('T720', 1000));
  await pay('CPPO_T720', 300);
  await assert.rejects(reverse('CPPO_T720', 0, { expected: { valor: 1000, status: 'Pendente', paymentsCount: 1 } }), { code: 'PAYABLE_CHANGED' });
  await assert.rejects(reverse('CPPO_T720', 0, { payment: { data: '10/11/2026', valor: 299, movBancoId: '' } }), { code: 'PAYABLE_CHANGED' });
  await assert.rejects(reverse('CPPO_T720', 3), { code: 'PAYMENT_NOT_FOUND' });
  await assert.rejects(mod.reversePayablePayment({ ...identity, canPayables: false }, { payableId: 'CPPO_T720' }, { db }), { code: 'PAYABLES_REQUIRED' });
  const current = await viaSdk('erp/contasPagar/CPPO_T720');
  await db.ref('erp/contasPagar/CPPO_T720/pagamentos/0/adt').set(50);
  await assert.rejects(reverse('CPPO_T720', 0), { code: 'ADVANCE_REVERSAL_UNSAFE' });
  await db.ref('erp/contasPagar/CPPO_T720/pagamentos/0/adt').set(0);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T720')).valor, current.valor);
  assert.equal(movementsOf('CPPO_T720').length, 1);
  assert.deepEqual(locks(), []);
});

test('repetir a mesma operação não desfaz duas vezes', async () => {
  srv.reset(baseData());
  await create(purchaseTicket('T730', 1000));
  await pay('CPPO_T730', 200);
  await pay('CPPO_T730', 300);
  const current = await viaSdk('erp/contasPagar/CPPO_T730');
  const input = { payableId: 'CPPO_T730', paymentIndex: 1, operationId: randomUUID(),
    payment: { data: current.pagamentos[1].data, valor: 300, movBancoId: current.pagamentos[1].movBancoId },
    expected: { valor: current.valor, status: current.status, paymentsCount: 2 } };
  const first = await mod.reversePayablePayment(identity, input, { db });
  const again = await mod.reversePayablePayment(identity, input, { db });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(first.payable.valor, 800);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T730')).valor, 800);
  assert.deepEqual((await viaSdk('erp/contasPagar/CPPO_T730')).pagamentos.map((p) => p.valor), [200]);
});

test('conta comum (sem compra): exclui pagamento e a saída do banco', async () => {
  srv.reset(baseData());
  await db.ref('erp/contasPagar/CP9').set({ id: 'CP9', desc: 'Energia', cred: 'Copel', cat: 'Energia', status: 'Pendente', valor: 500, venc: '20/11/2026', empresa: 'Manuela Metais' });
  await pay('CP9', 500);
  assert.equal((await viaSdk('erp/contasPagar/CP9')).status, 'Pago');
  await reverse('CP9', 0);
  const stored = await viaSdk('erp/contasPagar/CP9');
  assert.equal(stored.status, 'Pendente');
  assert.equal(stored.valor, 500);
  assert.equal(stored.movBancoIdCP, undefined);
  assert.equal(movementsOf('CP9').length, 0);
});

test('tela chama o servidor para excluir pagamento e não edita conta de compra só na tela', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const undo = core.slice(core.indexOf('async function _cpExcluirPagamento('), core.indexOf('async function excluirPagamentoCP('));
  assert.match(undo, /action:'reverse'/);
  assert.doesNotMatch(undo, /saveContasPagar\(|_fbRawDB/);
  const workspace = readFileSync(new URL('../web/modules/payables/ui/PayablesWorkspace.tsx', import.meta.url), 'utf8');
  const edit = workspace.slice(workspace.indexOf('const askEdit = useCallback('), workspace.indexOf('useEffect(', workspace.indexOf('const askEdit = useCallback(')));
  assert.match(edit, /if \(row\.fromPurchase\) return port\.notify\(PURCHASE_MESSAGE, 'info'\);/);
  assert.match(core, /window\.erpPayablesFromPurchase=function\(c\)\{ return _cpGravadaPeloServidor\(c\); \};/);
  const endpoint = readFileSync(new URL('../api/finance/payables-payment.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /action === 'reverse'/);
});

const ledger = () => Object.values(srv.read('erp/adiantamentos/F1') || {});
const removePurchase = (ticketNo) => mod.deletePurchaseOrder(identity, { ticketNo, operationId: randomUUID() }, { db });

test('pagamento com adiantamento: excluir no 🕒 devolve o adiantamento e a compra pode ser excluída', async () => {
  srv.reset({ ...baseData(), erp: { ...baseData().erp, adiantamentos: { F1: [{ cod: 'ADT1', data: '01/11/2026', valor: 1000, status: 'Pendente', forma: 'PIX', obs: 'teste' }] } } });
  await create(purchaseTicket('T730', 1000));
  await pay('CPPO_T730', 0, 1000);
  assert.deepEqual(ledger().map((row) => [row.cod, row.status, row.ticket]), [['ADT1', 'Quitado', 'T730']]);
  assert.deepEqual((await viaSdk('erp/contasPagar/CPPO_T730')).pagamentos[0].adtUsos, [{ cod: 'ADT1', valor: 1000 }]);
  await assert.rejects(removePurchase('T730'), { code: 'PURCHASE_HAS_FINANCE' });
  const result = await reverse('CPPO_T730', 0);
  assert.equal(result.reversedAmount, 1000);
  assert.equal(result.fornCod, 'F1');
  assert.deepEqual(ledger().map((row) => [row.cod, row.status, row.valor, row.valorCompensado, row.ticket, row.obs]), [['ADT1', 'Pendente', 1000, 0, '', 'teste']]);
  const payable = await viaSdk('erp/contasPagar/CPPO_T730');
  assert.deepEqual([payable.status, payable.valor, payable.adtCompensado, (payable.pagamentos || []).length], ['Pendente', 1000, 0, 0]);
  assert.equal(srv.read('erp/tickets/T730').saldoPagar, 1000);
  assert.deepEqual(locks(), []);
  assert.equal(Object.keys(srv.read('erpFinanceAdvanceLocks') || {}).length, 0);
  await removePurchase('T730');
  assert.equal(srv.read('erp/tickets/T730'), null);
});

test('pagamento antigo (sem registro dos adiantamentos usados), parte adiantamento e parte banco: volta tudo', async () => {
  srv.reset({ ...baseData(), erp: { ...baseData().erp, adiantamentos: { F1: [{ cod: 'ADT2', data: '01/11/2026', valor: 1000, status: 'Pendente' }] } } });
  await create(purchaseTicket('T740', 1000));
  await pay('CPPO_T740', 700, 300);
  assert.equal(ledger().length, 2);
  await db.ref('erp/contasPagar/CPPO_T740/pagamentos/0/adtUsos').remove();
  await reverse('CPPO_T740', 0);
  assert.deepEqual(ledger().map((row) => [row.cod, row.status, row.valor, row.valorCompensado, row.ticket || '']), [['ADT2', 'Pendente', 1000, 0, '']]);
  assert.equal(movementsOf('CPPO_T740').length, 0);
  await removePurchase('T740');
  assert.equal(srv.read('erp/tickets/T740'), null);
});

test('compra paga no banco: depois do 🕒 a compra pode ser excluída (o banco gravado na conta não conta como pagamento)', async () => {
  srv.reset(baseData());
  await create(purchaseTicket('T750', 500));
  await pay('CPPO_T750', 500);
  await reverse('CPPO_T750', 0);
  assert.equal((await viaSdk('erp/contasPagar/CPPO_T750')).bancoCod, 'B1');
  await removePurchase('T750');
  assert.equal(srv.read('erp/tickets/T750'), null);
});

test('adiantamento usado de novo depois do pagamento: recusa e não mexe em nada', async () => {
  srv.reset({ ...baseData(), erp: { ...baseData().erp, adiantamentos: { F1: [{ cod: 'ADT3', data: '01/11/2026', valor: 1000, status: 'Pendente' }] } } });
  await create(purchaseTicket('T760', 1000));
  await create(purchaseTicket('T761', 700));
  await pay('CPPO_T760', 700, 300);
  await pay('CPPO_T761', 0, 700);
  const before = JSON.stringify(ledger());
  await assert.rejects(reverse('CPPO_T760', 0), { code: 'ADVANCE_REVERSAL_UNSAFE' });
  assert.equal(JSON.stringify(ledger()), before);
  assert.deepEqual(locks(), []);
  await reverse('CPPO_T761', 0);
  await reverse('CPPO_T760', 0);
  assert.deepEqual(ledger().map((row) => [row.cod, row.status, row.valor]), [['ADT3', 'Pendente', 1000]]);
});
