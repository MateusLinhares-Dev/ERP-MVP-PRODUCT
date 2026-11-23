import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canPurchasing: true, canAdvances: true, canPayables: true, canFinance: true, canBanking: true };
let srv, db, app, createPurchaseOrder, deletePurchaseOrder;
const read = async (path) => (await db.ref(path).get()).val();

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
  ({ createPurchaseOrder, deletePurchaseOrder } = await import('../server/modules/purchases/index.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});
beforeEach(() => srv.reset({ erp: {
  _ts: 1,
  fornecedores: { F1: { cod: 'F001', nome: 'CICLO', ativo: true } },
  tickets: {
    P100: { ticket: 'P100', fornecedorCod: 'F001', fornecedor: 'CICLO', status: 'Aguard. Preço', _balFinalizado: true, itens: [{ mat: 'FERRO', pesoLiq: 1000 }] },
    P101: { ticket: 'P101', fornecedorCod: 'F001', fornecedor: 'CICLO', status: 'Aguard. Preço', _balFinalizado: true, itens: [{ mat: 'FERRO', pesoLiq: 50 }] },
  },
  contasPagar: {}, adiantamentos: {},
} }));

test('excluir a notinha fechada a partir de uma pesagem devolve a pesagem para "Aguardando preço" (pode ser lançada de novo)', async () => {
  await createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T500', fornecedorCod: 'F001', advanceCodes: [], chequeIds: [], useLegacyCredit: false, sourceTicketKeys: ['P100'],
    ticket: { ticket: 'T500', fornecedorCod: 'F001', fornecedor: 'CICLO', fornecedorNome: 'CICLO', itens: [{ mat: 'FERRO', pesoLiq: 1000, quantidade: 1000, preco: 1, total: 1000 }], totalProdutos: 1000, totalGeral: 1000, descontoCompra: 0, freteCompra: 0, dataCompra: '2026-11-23', vencimentoSaldo: '2026-11-23', status: 'Pendente', _consolidado: true } }, { db });
  assert.deepEqual([(await read('erp/tickets/P100')).status, (await read('erp/tickets/P100'))._consolidadoEm], ['Consolidado', 'T500']);
  const result = await deletePurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T500', expectedSupplier: 'F001', expectedTotal: 1000 }, { db });
  assert.deepEqual(result.releasedSources, ['P100']);
  const p100 = await read('erp/tickets/P100');
  assert.deepEqual([p100.status, p100._balFinalizado, p100._consolidadoEm, p100._liberadoDe, p100.itens[0].pesoLiq], ['Aguard. Preço', true, undefined, 'T500', 1000]);
  assert.equal((await read('erp/tickets/P101')).status, 'Aguard. Preço', 'outra pesagem não é tocada');
  assert.equal(await read('erp/tickets/T500'), null);
  await createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T501', fornecedorCod: 'F001', advanceCodes: [], chequeIds: [], useLegacyCredit: false, sourceTicketKeys: ['P100'],
    ticket: { ticket: 'T501', fornecedorCod: 'F001', fornecedor: 'CICLO', fornecedorNome: 'CICLO', itens: [{ mat: 'FERRO', pesoLiq: 1000, quantidade: 1000, preco: 1.1, total: 1100 }], totalProdutos: 1100, totalGeral: 1100, descontoCompra: 0, freteCompra: 0, dataCompra: '2026-11-23', vencimentoSaldo: '2026-11-23', status: 'Pendente', _consolidado: true } }, { db });
  assert.equal((await read('erp/tickets/P100'))._consolidadoEm, 'T501', 'a pesagem liberada pode virar notinha de novo');
});

test('estoque: pesagem que virou notinha não conta em dobro; pesagem de venda não é entrada; pesagem de notinha excluída volta a contar', () => {
  const start = core.indexOf('function _ticketsNoEstoque(){');
  const code = core.slice(start, core.indexOf('function getSaidasMaterial(mat){', start));
  const ctx = {
    TICKETS_DB: {
      P100: { ticket: 'P100', status: 'Consolidado', _consolidadoEm: 'T500', itens: [{ mat: 'FERRO', pesoLiq: 1000 }] },
      T500: { ticket: 'T500', itens: [{ mat: 'FERRO', pesoLiq: 980 }] },
      P200: { ticket: 'P200', status: 'Aguard. Preço', itens: [{ mat: 'FERRO', pesoLiq: 40 }] },
      V300: { ticket: 'V300', tipo: 'venda', itens: [{ mat: 'FERRO', pesoLiq: 300 }] },
      P400: { ticket: 'P400', status: 'Consolidado', itens: [{ mat: 'FERRO', pesoLiq: 70 }] },
      T401: { ticket: 'T401', _ticketsOrigemIds: ['P400'], itens: [{ mat: 'FERRO', pesoLiq: 70 }] },
      P500: { ticket: 'P500', status: 'Consolidado', _consolidadoEm: 'T999', itens: [{ mat: 'FERRO', pesoLiq: 5 }] },
    },
    _normalizarChaveMaterialEstoque: (n) => String(n || '').trim().toUpperCase(),
    _materialEfetivoDoItem: (it) => it.mat,
  };
  runInNewContext(code + ';this.entradas=getEntradasMaterial;', ctx);
  assert.equal(ctx.entradas('ferro'), 980 + 40 + 70 + 5);
});
