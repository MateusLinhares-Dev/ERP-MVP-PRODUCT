import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { cleanPatch, EDIT_FIELDS, isApplied, locate, purchaseChanges } from '../server/modules/banking/domain/supplier-cheque-rules.ts';

const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canFinance: true, canPurchasing: true, canAdvances: true, canPayables: true, canBanking: true };
const NOW = Date.UTC(2026, 10, 18, 15, 0, 0);
let srv, db, app, changeSupplierCheque, createPurchaseOrder;
const read = async (path) => (await db.ref(path).get()).val();
const list = (value) => (Array.isArray(value) ? value : Object.values(value || {}));
const cheques = async (code = 'F001') => list(await read('erp/cheques/' + code));
let tick = 0;
const call = (body, who = identity, operationId = randomUUID()) =>
  changeSupplierCheque(who, { operationId, ...body }, { db, now: () => NOW + tick++, random: () => 0.42 });
const reject = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
};
const baseData = () => ({ erp: {
  _ts: 1,
  fornecedores: { F001: { cod: 'F001', nome: 'JOÃO ELIAS' }, F002: { cod: 'F002', nome: 'EDUARDO FAGUNDES' } },
  cheques: {
    F001: [
      { id: 'CHQ1', num: '101', banco: 'Sicredi', tipo: 'Emitido (A Pagar)', finalidade: 'Adiantamento', valor: 300, bomPara: '20/11/2026', status: 'Pendente', dataCompensacao: '', statusDesc: 'A descontar' },
      { id: 'CHQ2', num: '102', banco: 'Sicredi', valor: 500, status: 'Quitado', _aplicadoTicket: 'T90', vinculo: 'T90', statusDesc: 'Descontado' },
      { num: '103', banco: 'Itaú', valor: 80, status: 'Pendente' },
      { num: '104', banco: 'Itaú', valor: 10, status: 'Pendente' },
      { num: '104', banco: 'Itaú', valor: 11, status: 'Pendente' },
    ],
    F002: [{ id: 'CHQ9', num: '900', banco: 'Bradesco', valor: 50, status: 'Pendente' }],
  },
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
  ({ changeSupplierCheque } = await import('../server/modules/banking/index.js'));
  ({ createPurchaseOrder } = await import('../server/modules/purchases/index.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});
beforeEach(() => srv.reset(baseData()));

test('regras: campos conferidos, cheque achado pelo id ou pelo número sem id, cheque da compra protegido', () => {
  assert.equal(cleanPatch({ valor: 1.005 }, EDIT_FIELDS).problem.code, 'INVALID_AMOUNT');
  assert.equal(cleanPatch({ bomPara: '31/02/2026' }, EDIT_FIELDS).problem.code, 'INVALID_DATE');
  assert.equal(cleanPatch({ num: '  ' }, EDIT_FIELDS).problem.code, 'CHEQUE_NUMBER_REQUIRED');
  assert.deepEqual(cleanPatch({ bomPara: '2026-12-01', obs: ' a  b ', extra: 1 }, EDIT_FIELDS).fields, { bomPara: '01/12/2026', obs: 'a b' });
  const rows = baseData().erp.cheques.F001;
  assert.equal(locate(rows, 'CHQ1', 'F001'), 0);
  assert.equal(locate(rows, 'CHQ_103_F001', 'F001'), 2);
  assert.equal(locate(rows, 'CHQ_104_F001', 'F001'), -2);
  assert.equal(locate(rows, 'CHQX', 'F001'), -1);
  assert.equal(isApplied(rows[1]), true);
  assert.equal(isApplied(rows[0]), false);
  assert.deepEqual(purchaseChanges(rows[1], { valor: 500, obs: 'x', banco: 'SICREDI' }), []);
  assert.deepEqual(purchaseChanges(rows[1], { valor: 501, status: 'Pendente' }), ['valor', 'status']);
});

test('lançar cheques: grava pelo servidor com id e padrões; compensado usa o bom para; número repetido no mesmo banco é recusado', async () => {
  const result = await call({ action: 'create', fornCod: 'F001', cheques: [
    { num: '201', valor: 120.5, bomPara: '2026-12-05', banco: 'Sicredi', vinculo: 'T120', tipo: 'Emitido (A Pagar)', finalidade: 'Pagamento', empresa: 'Manuela' },
    { num: '202', valor: 99, bomPara: '2026-11-10', banco: 'Sicredi', status: 'Compensado' },
  ] });
  assert.equal(result.created.length, 2);
  const saved = await cheques();
  const a = saved.find((c) => c.num === '201');
  const b = saved.find((c) => c.num === '202');
  assert.match(a.id, /^CHQ[0-9A-Z]+$/);
  assert.deepEqual([a.valor, a.bomPara, a.finalidade, a.empresa, a.vinculo, a.status, a.statusDesc, a.criadoPor], [120.5, '05/12/2026', 'Pagamento', 'Manuela', 'T120', 'Pendente', 'Descontado', 'elaine']);
  assert.deepEqual([b.status, b.dataCompensacao, b.tipo, b.finalidade], ['Compensado', '10/11/2026', 'Emitido (A Pagar)', 'Adiantamento']);
  assert.ok((await read('erp/_ts')) >= NOW);
  await reject(call({ action: 'create', fornCod: 'F002', cheques: [{ num: '0101', valor: 10, banco: 'SICREDI' }] }), 'CHEQUE_EXISTS');
  await reject(call({ action: 'create', fornCod: 'F002', cheques: [{ num: '300', valor: 1, banco: 'Caixa' }, { num: '300', valor: 2, banco: 'Caixa' }] }), 'CHEQUE_EXISTS');
  assert.equal((await cheques('F002')).length, 1, 'nada gravado quando um cheque do lote é recusado');
  await reject(call({ action: 'create', fornCod: 'F999', cheques: [{ num: '1', valor: 1 }] }), 'SUPPLIER_NOT_FOUND');
  await reject(call({ action: 'create', fornCod: 'F001', cheques: [{ num: '1', valor: 0 }] }), 'INVALID_AMOUNT');
});

test('cheques antigos sem id e com número repetido: acha pela posição e ganham id na primeira gravação', async () => {
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ_104_F001', cheque: { obs: 'x' } }), 'CHEQUE_AMBIGUOUS');
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ_104_F001', index: 2, cheque: { obs: 'x' } }), 'CHEQUE_AMBIGUOUS');
  await call({ action: 'update', fornCod: 'F001', id: 'CHQ_104_F001', index: 4, cheque: { obs: 'segundo' } });
  const rows = await cheques();
  assert.deepEqual(rows.map((c) => c.id), ['CHQ1', 'CHQ2', 'CHQ_103_F001', 'CHQ_104_F001', 'CHQ_104_F001_2']);
  assert.deepEqual(rows.filter((c) => c.num === '104').map((c) => [c.valor, c.obs ?? '']), [[10, ''], [11, 'segundo']]);
  await call({ action: 'discount', fornCod: 'F001', value: 'Descontado', ids: ['CHQ_104_F001', { id: 'CHQ_104_F001_2' }] });
  assert.equal((await cheques()).filter((c) => c.statusDesc === 'Descontado').length, 3);
  await reject(call({ action: 'discount', fornCod: 'F001', value: 'Descontado', ids: ['CHQ1', { id: 'CHQ1', index: 0 }] }), 'DUPLICATE_CHEQUES');
});

test('editar: muda os campos pedidos; voltar para Pendente limpa a compensação; cheque da compra só aceita campos que não mexem no dinheiro', async () => {
  await call({ action: 'update', fornCod: 'F001', id: 'CHQ1', expected: { valor: 300, status: 'Pendente' }, cheque: { valor: 320, num: '101', status: 'Compensado', data: '18/11/2026', obs: 'trocado' } });
  let one = (await cheques()).find((c) => c.id === 'CHQ1');
  assert.deepEqual([one.valor, one.status, one.data, one.obs, one.banco, one.alteradoPor], [320, 'Compensado', '18/11/2026', 'trocado', 'Sicredi', 'elaine']);
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ1', expected: { valor: 300 }, cheque: { obs: 'x' } }), 'CHEQUE_CHANGED');
  await call({ action: 'update', fornCod: 'F001', id: 'CHQ1', cheque: { status: 'Pendente' } });
  one = (await cheques()).find((c) => c.id === 'CHQ1');
  assert.deepEqual([one.status, one.dataCompensacao], ['Pendente', '']);
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ2', cheque: { valor: 400 } }), 'CHEQUE_IN_PURCHASE');
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ2', cheque: { status: 'Pendente' } }), 'CHEQUE_IN_PURCHASE');
  await call({ action: 'update', fornCod: 'F001', id: 'CHQ2', cheque: { obs: 'entregue ao motorista', bomPara: '25/11/2026', valor: 500 } });
  const applied = (await cheques()).find((c) => c.id === 'CHQ2');
  assert.deepEqual([applied.obs, applied.bomPara, applied.status, applied._aplicadoTicket, applied.vinculo], ['entregue ao motorista', '25/11/2026', 'Quitado', 'T90', 'T90']);
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ1', cheque: { num: '900', banco: 'Bradesco' } }), 'CHEQUE_EXISTS');
  await reject(call({ action: 'update', fornCod: 'F001', id: 'CHQ1', cheque: { status: 'Quitado' } }), 'INVALID_STATUS');
});

test('excluir: o livre sai (também o antigo sem id); o que está na compra é recusado', async () => {
  const result = await call({ action: 'delete', fornCod: 'F001', id: 'CHQ_103_F001' });
  assert.equal(result.removed.num, '103');
  assert.ok(!(await cheques()).some((c) => c.num === '103'));
  await reject(call({ action: 'delete', fornCod: 'F001', id: 'CHQ2' }), 'CHEQUE_IN_PURCHASE');
  assert.ok((await cheques()).some((c) => c.id === 'CHQ2'));
  await reject(call({ action: 'delete', fornCod: 'F001', id: 'CHQ404' }), 'CHEQUE_NOT_FOUND');
});

test('compensar e desfazer: Pendente volta a Pendente; o da compra volta a Quitado; cancelado não compensa', async () => {
  await call({ action: 'clear', fornCod: 'F001', id: 'CHQ1', date: '2026-11-18' });
  let one = (await cheques()).find((c) => c.id === 'CHQ1');
  assert.deepEqual([one.status, one.dataCompensacao], ['Compensado', '18/11/2026']);
  const back = await call({ action: 'reopen', fornCod: 'F001', id: 'CHQ1' });
  assert.equal(back.status, 'Pendente');
  await reject(call({ action: 'reopen', fornCod: 'F001', id: 'CHQ1' }), 'CHEQUE_NOT_CLEARED');
  await call({ action: 'clear', fornCod: 'F001', id: 'CHQ2', date: '18/11/2026' });
  one = (await cheques()).find((c) => c.id === 'CHQ2');
  assert.deepEqual([one.status, one.statusAnterior], ['Compensado', 'Quitado']);
  assert.equal((await call({ action: 'reopen', fornCod: 'F001', id: 'CHQ2' })).status, 'Quitado');
  one = (await cheques()).find((c) => c.id === 'CHQ2');
  assert.deepEqual([one.status, one.statusAnterior, one._aplicadoTicket], ['Quitado', undefined, 'T90']);
  await call({ action: 'cancel', fornCod: 'F001', id: 'CHQ1' });
  await reject(call({ action: 'clear', fornCod: 'F001', id: 'CHQ1', date: '18/11/2026' }), 'CHEQUE_CANCELLED');
  await reject(call({ action: 'clear', fornCod: 'F001', id: 'CHQ_103_F001', date: '' }), 'INVALID_DATE');
});

test('descontar, cancelar e reativar seguem as regras da aba antiga', async () => {
  const result = await call({ action: 'discount', fornCod: 'F001', value: 'Descontado', ids: ['CHQ1', 'CHQ_103_F001'] });
  assert.equal(result.count, 2);
  assert.deepEqual((await cheques()).filter((c) => c.statusDesc === 'Descontado').map((c) => c.num).sort(), ['101', '102', '103']);
  await call({ action: 'discount', fornCod: 'F001', value: 'A descontar', ids: ['CHQ1'] });
  assert.equal((await cheques()).find((c) => c.id === 'CHQ1').statusDesc, 'A descontar');
  await reject(call({ action: 'discount', fornCod: 'F001', value: 'Qualquer', ids: ['CHQ1'] }), 'INVALID_DISCOUNT');
  await reject(call({ action: 'cancel', fornCod: 'F001', id: 'CHQ2' }), 'CHEQUE_IN_PURCHASE');
  await call({ action: 'cancel', fornCod: 'F001', id: 'CHQ1' });
  assert.equal((await cheques()).find((c) => c.id === 'CHQ1').status, 'Cancelado');
  await reject(call({ action: 'discount', fornCod: 'F001', value: 'Descontado', ids: ['CHQ1'] }), 'CHEQUE_CANCELLED');
  await call({ action: 'create', fornCod: 'F002', cheques: [{ num: '101', valor: 7, banco: 'Sicredi' }] });
  await reject(call({ action: 'reactivate', fornCod: 'F001', id: 'CHQ1' }), 'CHEQUE_EXISTS');
  await call({ action: 'delete', fornCod: 'F002', id: (await cheques('F002')).find((c) => c.num === '101').id });
  await call({ action: 'reactivate', fornCod: 'F001', id: 'CHQ1' });
  assert.equal((await cheques()).find((c) => c.id === 'CHQ1').status, 'Pendente');
  await reject(call({ action: 'reactivate', fornCod: 'F001', id: 'CHQ1' }), 'CHEQUE_NOT_CANCELLED');
});

test('restaurar do histórico: volta com id novo, tira a marca de lista apagada e não duplica', async () => {
  srv.seed('erp/chequesPorFornDeleted', ['F002', 'F777']);
  srv.seed('erp/chequeItensDeleted', ['F001::CHQ1']);
  const visible = await call({ action: 'discount', fornCod: 'F001', value: 'Descontado', ids: ['CHQ_103_F001'] });
  assert.ok(!visible.cheques.some((c) => c.id === 'CHQ1'), 'cheque marcado como excluído não volta para a lista');
  const result = await call({ action: 'restore', fornCod: 'F002', cheque: { id: 'CHQ1', num: '101', banco: 'Sicredi', valor: 300, bomPara: '20/11/2026', status: 'Pendente', statusDesc: 'A descontar' } });
  const restored = (await cheques('F002')).find((c) => c.id === result.id);
  assert.notEqual(result.id, 'CHQ1');
  assert.deepEqual([restored.num, restored.valor, restored.status, restored.statusDesc, restored.restauradoDe], ['101', 300, 'Pendente', 'A descontar', 'CHQ1']);
  assert.deepEqual(list(await read('erp/chequesPorFornDeleted')), ['F777']);
  assert.deepEqual((await cheques('F002')).map((c) => c.num), ['101'], 'a lista apagada antes não volta junto');
  await reject(call({ action: 'restore', fornCod: 'F002', cheque: { id: 'CHQ1', num: '101', banco: 'Sicredi', valor: 300 } }), 'CHEQUE_EXISTS');
});

test('restaurar cheque que estava numa compra: só volta como Quitado se a compra ainda o tem no recibo', async () => {
  srv.seed('erp/tickets/T70', { ticket: 'T70', reciboFinanceiro: { cheques: [{ id: 'CHQ70', num: '170', valorAplicado: 40 }] } });
  const kept = await call({ action: 'restore', fornCod: 'F001', cheque: { id: 'CHQ70', num: '170', banco: 'Caixa', valor: 40, status: 'Quitado', _aplicadoTicket: 'T70' } });
  assert.equal(kept.status, 'Quitado');
  assert.equal((await cheques()).find((c) => c.id === kept.id)._aplicadoTicket, 'T70');
  const freed = await call({ action: 'restore', fornCod: 'F001', cheque: { id: 'CHQ71', num: '171', banco: 'Caixa', valor: 41, status: 'Quitado', vinculo: 'T71' } });
  assert.equal(freed.status, 'Pendente');
  assert.equal((await cheques()).find((c) => c.id === freed.id)._aplicadoTicket, undefined);
});

test('permissão, operação repetida e trava do fornecedor', async () => {
  await reject(call({ action: 'cancel', fornCod: 'F001', id: 'CHQ1' }, { ...identity, canFinance: false }), 'FINANCE_REQUIRED');
  const operationId = randomUUID();
  const first = await call({ action: 'create', fornCod: 'F002', cheques: [{ num: '901', valor: 5, banco: 'Bradesco' }] }, identity, operationId);
  const again = await call({ action: 'create', fornCod: 'F002', cheques: [{ num: '901', valor: 5, banco: 'Bradesco' }] }, identity, operationId);
  assert.equal(again.alreadyCommitted, true);
  assert.deepEqual(again.created, first.created);
  assert.equal((await cheques('F002')).length, 2);
  srv.seed('erpFinanceAdvanceLocks/F001', { owner: 'compra', expiresAt: NOW + 60000 });
  await reject(call({ action: 'cancel', fornCod: 'F001', id: 'CHQ1' }), 'SUPPLIER_CHEQUE_IN_PROGRESS');
  assert.equal((await cheques()).find((c) => c.id === 'CHQ1').status, 'Pendente');
  assert.equal(await read('erpFinanceAdvanceLocks/__supplier_cheques__'), null, 'a trava geral é solta quando a do fornecedor falha');
});

test('a compra usa o cheque lançado pela API e, depois disso, o cheque não pode ser excluído', async () => {
  const created = await call({ action: 'create', fornCod: 'F002', cheques: [{ num: '950', valor: 300, banco: 'Bradesco', finalidade: 'Adiantamento' }] });
  const id = created.created[0];
  await createPurchaseOrder(identity, { operationId: randomUUID(), ticketNo: 'T500', fornecedorCod: 'F002', advanceCodes: [], chequeIds: [id], useLegacyCredit: false, sourceTicketKeys: [],
    ticket: { ticket: 'T500', fornecedorCod: 'F002', fornecedor: 'EDUARDO FAGUNDES', fornecedorNome: 'EDUARDO FAGUNDES', itens: [{ mat: 'FERRO', pesoLiq: 1000, quantidade: 1000, preco: 1, total: 1000 }], totalProdutos: 1000, totalGeral: 1000, descontoCompra: 0, freteCompra: 0, dataCompra: '2026-11-18', vencimentoSaldo: '2026-11-18', status: 'Pendente', _consolidado: true, _purchaseOperationId: randomUUID() } }, { db });
  const used = (await cheques('F002')).find((c) => c.id === id);
  assert.deepEqual([used.status, used._aplicadoTicket], ['Quitado', 'T500']);
  await reject(call({ action: 'delete', fornCod: 'F002', id }), 'CHEQUE_IN_PURCHASE');
  await reject(call({ action: 'update', fornCod: 'F002', id, cheque: { valor: 200 } }), 'CHEQUE_IN_PURCHASE');
});

test('a tela pede tudo ao servidor e a sincronização não grava mais os cheques de fornecedor', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sync, /_patchIncremental\(dados, 'cheques'/);
  assert.match(sync, /delete dados\.chequesPorFornDeleted/);
  assert.match(sync, /delete dados\.chequeItensDeleted/);
  for (const name of ['excluirCheque', 'compensarCheque', 'salvarEdicaoCheque', 'marcarDescontado', 'desfazerDesconto', 'marcarDescontadoFornecedor', 'cancelarCheque', 'reativarCheque', 'salvarCheques']) {
    const start = core.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const body = core.slice(start, core.indexOf('\n}', start));
    assert.match(body, /_chequeFornApi\(/, name + ' usa a API');
    assert.doesNotMatch(body, /saveDB\(\)/, name + ' não grava pela tela');
  }
  assert.doesNotMatch(core, /function salvarCheque\(\)/);
  const policy = JSON.parse(readFileSync(new URL('../public/app/rtdb-collection-policy.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  for (const node of ['cheques', 'chequesPorFornDeleted', 'chequeItensDeleted']) {
    assert.equal(policy.nodes[node].write.mode, 'none', node);
    assert.equal(rules.rules.erp[node]['.write'], false, node);
  }
  assert.deepEqual(rules.rules.erp.supplierChequeOperations, { '.read': false, '.write': false });
});
