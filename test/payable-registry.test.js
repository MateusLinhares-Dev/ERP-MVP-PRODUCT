import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { cleanInstallments, cleanPayableFields, installmentDueDates } from '../server/modules/payables/domain/payable-rules.ts';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canPayables: true };
const NOW = Date.UTC(2026, 10, 13, 15, 0, 0);
let srv, db, app, changePayable;
const read = async (path) => (await db.ref(path).get()).val();
const call = (body, who = identity) => changePayable(who, { operationId: randomUUID(), ...body }, { db, now: () => NOW });
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
    bancos: { B1: { cod: 'B1', banco: 'Sicredi', empresa: 'Manuela Metais' }, B2: { cod: 'B2', banco: 'Itaú', tipo: 'Conta Terceiro', titular: 'Ana' } },
    tickets: { T10: { ticket: 'T10', _purchaseOperationId: 'op-1' }, T11: { ticket: 'T11' } },
    contasPagar: {
      CP1: { id: 'CP1', desc: 'Energia', cred: 'CELESC', cat: 'Energia', valor: 300, status: 'Pendente', venc: '20/11/2026', empresa: 'Manuela Metais', _upd: 5 },
      CPPAGA: { id: 'CPPAGA', desc: 'Aluguel', valor: 0, valorPago: 1000, status: 'Pago', venc: '05/11/2026', empresa: 'Manuela Metais', pagamentos: [{ data: '05/11/2026', valor: 1000, movBancoId: 'LB-PG-1' }] },
      CPANTIGA: { id: 'CPANTIGA', desc: 'Antiga paga', valor: 50, status: 'Pago', venc: '01/10/2026' },
      CPPO_T10_1: { id: 'CPPO_T10_1', desc: 'Compra', valor: 80, status: 'Pendente', ticket: 'T10' },
      CPLEG: { id: 'CPLEG', desc: 'Compra antiga', valor: 90, status: 'Pendente', ticket: 'T10' },
      CPT11: { id: 'CPT11', desc: 'Ticket antigo', valor: 70, status: 'Pendente', ticket: 'T11' },
      '7': { id: 'CPIDX', desc: 'Formato antigo', valor: 10, status: 'Pendente', venc: '01/12/2026' },
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
  ({ changePayable } = await import('../server/modules/payables/application/payable-registry.js'));
});
beforeEach(() => srv.reset(baseData()));
after(async () => {
  try {
    await app?.delete();
  } catch {}
  await srv?.close();
});

test('regras: obrigatórios, valor brasileiro, parcelas no fim do mês', () => {
  assert.equal(cleanPayableFields({ desc: 'X', valor: '0', empresa: 'A' }, true).problem.code, 'INVALID_AMOUNT');
  assert.equal(cleanPayableFields({ desc: 'X', valor: '10' }, true).problem.code, 'COMPANY_REQUIRED');
  assert.equal(cleanPayableFields({ desc: ' ', valor: '10', empresa: 'A' }, true).problem.code, 'DESCRIPTION_REQUIRED');
  assert.equal(cleanPayableFields({ tipoForn: 'outro' }, false).problem.code, 'INVALID_KIND');
  assert.deepEqual(cleanPayableFields({ desc: ' Luz  da  sede ', valor: '1.234,56', empresa: 'A', venc: '2026-12-01', cat: '' }, true).fields, {
    desc: 'Luz da sede',
    cat: 'Outros',
    empresa: 'A',
    valor: 1234.56,
    venc: '01/12/2026',
  });
  assert.equal(cleanInstallments({ count: 0, day: 10, firstMonth: '2026-12' }).problem.code, 'INVALID_INSTALLMENTS');
  assert.equal(cleanInstallments({ count: 2, day: 10, firstMonth: '2026-13' }).problem.code, 'INVALID_INSTALLMENTS');
  assert.equal(cleanInstallments(undefined).plan, null);
  assert.deepEqual(installmentDueDates({ count: 4, day: 31, firstMonth: '2026-11' }), ['30/11/2026', '31/12/2026', '31/01/2027', '28/02/2027']);
});

test('lançar avulsa e parcelada: pendente, nome do banco pelo código, grupo e parcelas', async () => {
  const single = await call({ action: 'create', payable: { desc: 'Internet', cred: 'VIVO', valor: '199,90', venc: '2026-11-25', empresa: 'Manuela Metais', bancoCod: 'B2', tipoForn: 'despesa' } });
  const row = await read('erp/contasPagar/' + single.payables[0].id);
  assert.deepEqual([row.status, row.valor, row.venc, row.bancoNome, row.lancto, row.criadoPor], ['Pendente', 199.9, '25/11/2026', 'Itaú (Ana)', '13/11/2026', 'thais']);
  assert.equal((await read('erp/_ts')), NOW);
  const plan = await call({ action: 'create', payable: { desc: 'Financiamento', valor: 500, empresa: 'Manuela Metais' }, installments: { count: 3, day: 31, firstMonth: '2027-01' } });
  assert.deepEqual(plan.payables.map((item) => [item.desc, item.venc]), [['Financiamento (1/3)', '31/01/2027'], ['Financiamento (2/3)', '28/02/2027'], ['Financiamento (3/3)', '31/03/2027']]);
  assert.equal(new Set(plan.payables.map((item) => item.grupoId)).size, 1);
  assert.equal(new Set(plan.payables.map((item) => item.id)).size, 3);
  assert.equal(plan.payables[0].totalParcelas, 3);
  assert.equal((await failure(call({ action: 'create', payable: { desc: 'X', valor: 1, empresa: 'A' } })))?.code, 'INVALID_DATE');
  assert.equal((await failure(call({ action: 'create', payable: { desc: 'X', valor: 1, empresa: 'A', venc: '2026-12-01', bancoCod: 'NAO' } })))?.code, 'BANK_NOT_FOUND');
});

test('editar: grava pelo servidor, confere versão, não mexe em conta de pedido nem no valor de conta paga', async () => {
  const updated = await call({ action: 'update', id: 'CP1', expectedUpdate: 5, payable: { desc: 'Energia sede', valor: '320', venc: '2026-11-22', bancoCod: 'B1' } });
  const row = await read('erp/contasPagar/CP1');
  assert.deepEqual([row.desc, row.valor, row.venc, row.bancoNome, row.status, row.alteradoPor, row._upd], ['Energia sede', 320, '22/11/2026', 'Sicredi', 'Pendente', 'thais', NOW]);
  assert.equal(updated.payable.id, 'CP1');
  assert.equal((await failure(call({ action: 'update', id: 'CP1', expectedUpdate: 5, payable: { desc: 'Y' } })))?.code, 'PAYABLE_CHANGED');
  assert.equal((await failure(call({ action: 'update', id: 'CPPO_T10_1', payable: { desc: 'Y' } })))?.code, 'PAYABLE_FROM_PURCHASE');
  assert.equal((await failure(call({ action: 'update', id: 'CPLEG', payable: { desc: 'Y' } })))?.code, 'PAYABLE_FROM_PURCHASE', 'ticket com pedido de compra pelo servidor');
  await call({ action: 'update', id: 'CPT11', payable: { desc: 'Ticket antigo ok' } });
  assert.equal((await read('erp/contasPagar/CPT11')).desc, 'Ticket antigo ok');
  assert.equal((await failure(call({ action: 'update', id: 'CPPAGA', payable: { valor: 900 } })))?.code, 'PAYABLE_PAID');
  await call({ action: 'update', id: 'CPPAGA', payable: { obs: 'contrato 2026' } });
  assert.equal((await read('erp/contasPagar/CPPAGA')).obs, 'contrato 2026');
  await call({ action: 'update', id: 'CPIDX', payable: { desc: 'Formato antigo ok' } });
  assert.equal((await read('erp/contasPagar/7')).desc, 'Formato antigo ok', 'conta gravada em lista antiga é achada pelo id');
  assert.equal(await read('erp/contasPagar/CPIDX'), null);
  assert.equal('status' in cleanPayableFields({ status: 'Pago' }, false).fields, false, 'situação não muda pela edição');
});

test('excluir uma ou várias: marca de exclusão; recusa conta com pagamento e conta de pedido', async () => {
  const result = await call({ action: 'delete', ids: ['CP1', 'CPANTIGA', 'CPIDX', 'SUMIU'] });
  assert.deepEqual(result.ids, ['CP1', 'CPANTIGA', 'CPIDX']);
  assert.equal(await read('erp/contasPagar/CP1'), null);
  assert.equal(await read('erp/contasPagar/7'), null);
  assert.equal(await read('erp/contasPagarDeleted/CPANTIGA'), true);
  assert.equal((await failure(call({ action: 'delete', ids: ['CPPAGA'] })))?.code, 'PAYABLE_HAS_PAYMENTS');
  const purchase = await failure(call({ action: 'delete', ids: ['CPT11', 'CPPO_T10_1'] }));
  assert.equal(purchase?.code, 'PAYABLE_FROM_PURCHASE');
  assert.ok(await read('erp/contasPagar/CPT11'), 'nada é excluído quando o lote tem conta de pedido');
  assert.equal((await failure(call({ action: 'delete', ids: [] })))?.code, 'INVALID_PAYABLE');
});

test('trava comum com o pagamento, idempotência e permissão', async () => {
  await db.ref('erpFinancePayableLocks/CP1').set({ owner: 'outro', expiresAt: NOW + 60000 });
  assert.equal((await failure(call({ action: 'update', id: 'CP1', payable: { desc: 'Y' } })))?.code, 'PAYABLE_IN_PROGRESS');
  await db.ref('erpFinancePayableLocks/CP1').remove();
  const operationId = randomUUID();
  const first = await changePayable(identity, { operationId, action: 'create', payable: { desc: 'Água', valor: 80, venc: '2026-11-30', empresa: 'Manuela Metais' } }, { db, now: () => NOW });
  const again = await changePayable(identity, { operationId, action: 'create', payable: { desc: 'Água', valor: 80, venc: '2026-11-30', empresa: 'Manuela Metais' } }, { db, now: () => NOW });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.payables[0].id, first.payables[0].id);
  const water = Object.values(await read('erp/contasPagar')).filter((row) => row.desc === 'Água');
  assert.equal(water.length, 1);
  assert.equal((await failure(call({ action: 'delete', ids: ['CP1'] }, { ...identity, canPayables: false })))?.code, 'PAYABLES_REQUIRED');
  await call({ action: 'delete', ids: ['CP1'] }, { uid: 'erp:x', erpAccess: true, canFinance: true });
  assert.equal(await read('erp/contasPagar/CP1'), null);
});

test('endpoint e regras: só o servidor grava operações', () => {
  const api = readFileSync(new URL('../api/finance/payables.ts', import.meta.url), 'utf8');
  assert.match(api, /changePayable\(identity, body as Body\)/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  assert.deepEqual(rules.rules.erp.payableOperations, { '.read': false, '.write': false });
});

test('tela de Contas a Pagar grava lançar, editar e excluir pela API; edição não muda a situação', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const body = (name) => {
    const start = core.indexOf('function ' + name + '(');
    assert.ok(start > 0, name);
    return core.slice(start, core.indexOf('\nfunction ', start + 10));
  };
  assert.match(body('salvarContaPagar'), /_cpApi\(\{action:'create',payable,installments\}\)/);
  assert.match(body('salvarEditContaPagar'), /_cpApi\(\{action:'update',id:c\.id,payable,expectedUpdate/);
  assert.match(body('_cpExcluirIds'), /_cpApi\(\{action:'delete',ids:alvo\}\)/);
  for (const name of ['salvarContaPagar', 'salvarEditContaPagar', 'cpExcluirApenas', 'cpExcluirPendentes', 'cpExcluirTodas', 'cpExcluirSelecionadas'])
    assert.doesNotMatch(body(name), /CONTAS_PAGAR\.push|CONTAS_PAGAR\.splice|_removerCPporIndice|saveContasPagar|registrarMovBanco/, name);
  assert.doesNotMatch(core, /id="ecp-status"|id="ecp-pgto"|id="cp-status"|function _baixarSaldoTicket/);
  assert.match(core, /modal\.id='cp-grupo-excluir'/, 'janela de parcelas fecha pelo id (o seletor por estilo nunca achava a janela)');
  assert.doesNotMatch(core, /style\*="position:fixed"\]\[style\*="99999"/);
});
