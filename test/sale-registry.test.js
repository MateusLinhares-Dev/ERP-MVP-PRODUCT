import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { applyCredits, restoreCredits } from '../server/modules/sales/domain/sale-credits.ts';
import { orderInput } from '../server/modules/sales/domain/sale-input.ts';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canSales: true };
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);
let srv, db, app, changeSale;
const read = async (path) => (await db.ref(path).get()).val();
const list = (value) => (Array.isArray(value) ? value : Object.values(value || {}));
const call = (body, who = identity) => changeSale(who, { operationId: randomUUID(), ...body }, { db, now: () => NOW });
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
    config: { legacyRepairs: { bankMovement: { cutoffDate: '' } } },
    adtCli: { GERDAU: [{ cod: 'ADTC1', data: '01/11/2026', valor: 1000, status: 'Pendente', bancoNome: 'Itaú' }] },
    chequesCli: { GERDAU: [{ num: '850', valor: 500, status: 'Pendente', banco: 'Itaú' }] },
    tickets: {
      T50: { ticket: 'T50', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: true, status: 'Aguard. Preço', pesagens: [{ material: 'FERRO', pesoLiquido: 2000 }] },
      T51: { ticket: 'T51', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: true, status: 'Aguard. Preço', vendaId: 'VD-OUTRA' },
    },
    vendas: {
      'VD-OLD': { id: 'VD-OLD', nf: 'V0007', data: '01/09/2026', cliente: 'TUPY', itens: [{ mat: 'FERRO', qt: 100, pr: 3, total: 300 }], total: 300, status: 'Pendente', atualizadoEm: 5 },
    },
    contasReceber: {
      CRA: { id: 'CRA', cli: 'TUPY', data: '01/09/2026', valor: 300, status: 'Pendente', forma: '—', venc: '01/10/2026' },
    },
  },
});

const order = (extra = {}) => ({
  client: 'GERDAU',
  date: '2026-11-12',
  items: [{ material: 'FERRO', quantity: '2000', price: '1,5', weighing: 'T50' }],
  weighings: ['T50'],
  credits: ['cheque:850', 'advance:ADTC1'],
  installments: [
    { dueDate: '2026-11-12', amount: '750', method: 'PIX', bank: 'B1', received: true },
    { dueDate: '2026-12-12', amount: '750', method: 'Boleto' },
  ],
  ...extra,
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
  ({ changeSale } = await import('../server/modules/sales/application/sale-registry.js'));
});
beforeEach(() => srv.reset(baseData()));
after(async () => {
  try {
    await app?.delete();
  } catch {}
  await srv?.close();
});

test('entrada do pedido: corta tamanhos, ignora recebimentos vindos da tela e barra ids inválidos', () => {
  const { order: parsed, problem } = orderInput({ ...order(), locked: [{ amount: 999 }], client: '  gerdau   sa ' });
  assert.equal(problem, undefined);
  assert.deepEqual(parsed.locked, []);
  assert.equal(parsed.client, 'gerdau sa');
  assert.equal(orderInput({ ...order(), weighings: ['T/50'] }).problem.code, 'INVALID_WEIGHING');
  assert.equal(orderInput({ ...order(), client: 'J.A.' }).problem.code, 'INVALID_CLIENT');
});

test('abatimentos: aplica e devolve na mesma regra do ERP antigo', () => {
  const advances = [{ cod: 'A1', valor: 1000, status: 'Pendente' }];
  const cheques = [{ num: '9', valor: 200, status: 'Pendente' }];
  const used = applyCredits(advances, cheques, [{ kind: 'cheque', ref: '9', amount: 200 }, { kind: 'advance', ref: 'A1', amount: 300 }], 'V0001');
  assert.equal(used.cheques[0].status, 'Quitado');
  assert.deepEqual([used.advances[0].valor, used.advances[0].valorOriginal, used.advances[0].status], [700, 1000, 'Pendente']);
  assert.equal(advances[0].valor, 1000, 'não muda a lista original');
  assert.equal(applyCredits(advances, cheques, [{ kind: 'advance', ref: 'A1', amount: 1500 }], 'V1').problem.code, 'CREDIT_CHANGED');
  const sale = { nf: 'V0001', abatimentos: [{ tipo: 'cheque', num: '9', valor: 200 }, { tipo: 'adiantamento', cod: 'A1', valor: 300 }] };
  const back = restoreCredits(used.advances, used.cheques, sale, []);
  assert.equal(back.restored, 2);
  assert.equal(back.advances[0].valor, 1000);
  assert.equal(back.cheques[0].status, 'Pendente');
});

test('venda antiga sem registro de abatimentos devolve pelo que ficou em Contas a Receber, sem mexer em cheque de outra venda', () => {
  const advances = [{ cod: 'ADTC123456', valor: 4000, status: 'Quitado' }];
  const cheques = [{ num: '777', valor: 900, status: 'Quitado' }, { num: '888', valor: 100, status: 'Quitado' }];
  const receivables = [
    { vendaId: 'VD-OLD', forma: 'Adiantamento', valor: 4000, obs: 'Adiantamento ADTC123456 — 99' },
    { vendaId: 'VD-OLD', forma: 'Cheque', valor: 900, obs: 'Abatido na venda 99 — cheque 777' },
  ];
  const back = restoreCredits(advances, cheques, { id: 'VD-OLD', nf: '99', cliente: 'TUPY' }, receivables);
  assert.equal(back.restored, 2);
  assert.deepEqual([back.advances[0].status, back.advances[0].valor], ['Pendente', 4000]);
  assert.deepEqual(back.cheques.map((row) => row.status), ['Pendente', 'Quitado']);
  const partial = applyCredits([{ cod: 'A', valor: 10000, status: 'Pendente' }], [], [{ kind: 'advance', ref: 'A', amount: 3000 }], 'NF-1');
  assert.deepEqual([partial.advances[0].valor, partial.advances[0].status, partial.advances[0].usos], [7000, 'Pendente', [{ venda: 'NF-1', valor: 3000 }]]);
});

test('salvar venda nova: tudo numa gravação (venda, contas, abatimentos, banco, pesagem) e número pelo servidor', async () => {
  const result = await call({ action: 'save', order: order() });
  const id = result.sale.id;
  assert.equal(result.sale.nf, 'V0008');
  assert.equal(await read('erp/salesNumberSeq'), 8);
  const sale = await read('erp/vendas/' + id);
  assert.equal(sale.total, 3000);
  assert.equal(sale.status, 'A prazo');
  assert.deepEqual(list(sale.pesagens), ['T50']);
  const receivables = list(await read('erp/contasReceber')).filter((row) => row.vendaId === id);
  assert.deepEqual(receivables.map((row) => [row.forma, row.valor, row.status]).sort(), [
    ['Adiantamento', 1000, 'Recebido'], ['Boleto', 750, 'Pendente'], ['Cheque', 500, 'Recebido'], ['PIX', 750, 'Recebido'],
  ].sort());
  const pix = receivables.find((row) => row.forma === 'PIX');
  const movement = await read('erp/lancBanco/' + pix.movBancoId);
  assert.deepEqual([movement.bancoCod, movement.valor, movement.data, movement.tipo], ['B1', 750, '12/11/2026', 'Entrada']);
  assert.equal(list(await read('erp/adtCli/GERDAU'))[0].status, 'Quitado');
  assert.equal(list(await read('erp/chequesCli/GERDAU'))[0].status, 'Quitado');
  assert.equal(await read('erp/tickets/T50/vendaId'), id);
  assert.equal(await read('erp/_ts'), NOW);
});

test('salvar: pesagem de outra venda, abatimento já usado, banco inexistente e perfil sem vendas são recusados', async () => {
  assert.equal((await failure(call({ action: 'save', order: order({ weighings: ['T51'], items: [{ material: 'FERRO', quantity: '1', price: '1', weighing: 'T51' }], credits: [], installments: [] }) })))?.code, 'WEIGHING_USED');
  await db.ref('erp/adtCli/GERDAU/0/status').set('Quitado');
  assert.equal((await failure(call({ action: 'save', order: order({ credits: ['advance:ADTC1'] }) })))?.code, 'SALE_INVALID');
  await db.ref('erp/adtCli/GERDAU/0/status').set('Pendente');
  const badBank = order({ credits: [], installments: [{ dueDate: '2026-11-12', amount: '3000', method: 'PIX', bank: 'NAO', received: true }] });
  assert.equal((await failure(call({ action: 'save', order: badBank })))?.code, 'BANK_NOT_FOUND');
  assert.equal((await failure(changeSale({ ...identity, canSales: false }, { action: 'save', order: order() }, { db })))?.code, 'SALES_REQUIRED');
});

test('editar venda antiga sem vínculo: liga a conta a receber existente, não cria outra; conflito é detectado', async () => {
  const edit = {
    saleId: 'VD-OLD', client: 'TUPY', number: 'V0007', date: '2026-09-01',
    items: [{ material: 'FERRO', quantity: '100', price: '4' }],
    installments: [{ receivableId: 'CRA', dueDate: '2026-10-01', amount: '400', method: 'Boleto' }],
  };
  const result = await call({ action: 'save', order: edit, expectedUpdate: 5 });
  assert.equal(result.sale.total, 400);
  const receivables = list(await read('erp/contasReceber'));
  assert.equal(receivables.length, 1);
  assert.deepEqual([receivables[0].id, receivables[0].valor, receivables[0].vendaId], ['CRA', 400, 'VD-OLD']);
  assert.equal((await failure(call({ action: 'save', order: edit, expectedUpdate: 5 })))?.code, 'SALE_CHANGED');
});

test('excluir: devolve abatimentos, apaga contas e lançamento do banco com marca de exclusão e solta a pesagem', async () => {
  const saved = await call({ action: 'save', order: order() });
  const id = saved.sale.id;
  const movementId = saved.bankMovements[0].id;
  const result = await call({ action: 'delete', saleId: id });
  assert.equal(result.restored, 2);
  assert.deepEqual(result.bankUndone, [movementId]);
  assert.equal(await read('erp/vendas/' + id), null);
  assert.equal((await read('erp/vendasDeletedV2'))[id], true);
  assert.equal(list(await read('erp/contasReceber')).filter((row) => row.vendaId === id).length, 0);
  assert.equal(await read('erp/lancBanco/' + movementId), null);
  assert.equal((await read('erp/lancBancoDeletedV2'))[movementId], true);
  const advance = list(await read('erp/adtCli/GERDAU'))[0];
  assert.deepEqual([advance.status, advance.valor], ['Pendente', 1000]);
  assert.equal(list(await read('erp/chequesCli/GERDAU'))[0].status, 'Pendente');
  assert.equal(await read('erp/tickets/T50/vendaId'), null);
});

test('marcar como paga e reabrir: reabrir desfaz o banco que a venda lançou', async () => {
  const saved = await call({ action: 'save', order: order({ credits: [], installments: [{ dueDate: '2026-11-12', amount: '3000', method: 'PIX', bank: 'B1', received: true }] }) });
  const id = saved.sale.id;
  assert.equal(saved.sale.status, 'Pago');
  const reopened = await call({ action: 'reopen', saleId: id });
  assert.equal(reopened.sale.status, 'Pendente');
  assert.equal(reopened.bankUndone.length, 1);
  const receivable = list(await read('erp/contasReceber')).find((row) => row.vendaId === id);
  assert.equal(receivable.status, 'Pendente');
  assert.equal(receivable.movBancoId, undefined);
  const paid = await call({ action: 'mark-paid', saleId: id });
  assert.equal(paid.sale.status, 'Pago');
  assert.equal(list(await read('erp/contasReceber')).find((row) => row.vendaId === id).dataReceb, '12/11/2026');
});

test('pesagem "Já lançada", repetição da mesma operação e endpoint/regras', async () => {
  const archived = await call({ action: 'archive-weighing', ticket: 'T50' });
  assert.equal(archived.fields.vendaArquivada, true);
  assert.equal(await read('erp/tickets/T50/vendaArquivada'), true);
  assert.equal((await failure(call({ action: 'archive-weighing', ticket: 'T51' })))?.code, 'WEIGHING_USED');
  const operationId = randomUUID();
  const body = { operationId, action: 'save', order: order({ weighings: [], items: [{ material: 'FERRO', quantity: '10', price: '1' }], credits: [], installments: [{ dueDate: '2026-11-20', amount: '10', method: 'Boleto' }] }) };
  const first = await changeSale(identity, body, { db, now: () => NOW });
  const again = await changeSale(identity, body, { db, now: () => NOW });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.sale.id, first.sale.id);
  assert.equal(list(await read('erp/vendas')).length, 2);
  const endpoint = readFileSync(new URL('../api/finance/sales.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /changeSale\(identity, body as Body\)/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.erp;
  for (const node of ['vendas', 'vendasDeleted', 'vendasDeletedV2']) assert.equal(rules[node]['.write'], false, node);
  for (const node of ['erpSalesLocks', 'salesOperations', 'salesNumberSeq']) assert.deepEqual(rules[node], { '.read': false, '.write': false }, node);
  assert.deepEqual(rules.contasReceber['.indexOn'], ['vendaId', 'cli']);
});
