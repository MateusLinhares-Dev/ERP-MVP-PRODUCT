import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { cleanCheque, locateCheque, nextChequeStatus } from '../server/modules/receivables/domain/client-credit-rules.ts';

const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canFinance: true, canSales: true, canReceivables: true, canBanking: true };
const NOW = Date.UTC(2026, 10, 18, 15, 0, 0);
let srv, db, app, changeClientCredit, changeSale, changeReceivable;
const read = async (path) => (await db.ref(path).get()).val();
const list = (value) => (Array.isArray(value) ? value : Object.values(value || {}));
const call = (body, who = identity) => changeClientCredit(who, { operationId: randomUUID(), ...body }, { db, now: () => NOW, random: () => 0.42 });
const reject = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
};
const baseData = () => ({ erp: {
  _ts: 1,
  bancos: { B1: { cod: 'B1', banco: 'Sicredi' } },
  config: { legacyRepairs: { bankMovement: { cutoffDate: '' } } },
  clientes: { C1: { id: 'C1', cod: 'C1', nome: 'GERDAU' }, C2: { id: 'C2', cod: 'C2', nome: 'TUPY' } },
  adtCli: { GERDAU: [{ cod: 'ADTC1', data: '01/11/2026', valor: 1000, status: 'Pendente', bancoNome: 'Itaú' }] },
  chequesCli: { GERDAU: [{ num: '850', valor: 500, status: 'Pendente', banco: 'Itaú' }, { num: '850', valor: 70, status: 'Pendente', banco: 'Caixa' }] },
  tickets: { T50: { ticket: 'T50', tipo: 'venda', cliente: 'GERDAU', _balFinalizado: true, status: 'Aguard. Preço', pesagens: [{ material: 'FERRO', pesoLiquido: 2000 }] } },
  contasReceber: { CRX: { id: 'CRX', cli: 'TUPY', data: '01/11/2026', valor: 300, status: 'Pendente', forma: '—', venc: '10/11/2026' } },
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
  ({ changeClientCredit } = await import('../server/modules/receivables/index.js'));
  ({ changeSale } = await import('../server/modules/sales/application/sale-registry.js'));
  ({ changeReceivable } = await import('../server/modules/receivables/application/receivable-registry.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});
beforeEach(() => srv.reset(baseData()));

test('regras: situação em ciclo, cheque achado por número e banco, validação de valor e data', () => {
  assert.equal(nextChequeStatus('Pendente'), 'Compensado');
  assert.equal(nextChequeStatus('Pago (após devolução)'), 'Pendente');
  const rows = [{ num: '850', banco: 'Itaú' }, { num: '850', banco: 'Caixa' }, { num: '9', banco: 'Itaú' }, { num: '9', banco: 'itau' }];
  assert.equal(locateCheque(rows, '850', 'Caixa'), 1);
  assert.equal(locateCheque(rows, '850', 'ITAÚ', 0), 0);
  assert.equal(locateCheque(rows, '9', 'Itau'), -2, 'dois iguais sem posição: ambíguo');
  assert.equal(locateCheque(rows, '9', 'Itau', 3), 3);
  assert.equal(locateCheque(rows, '1', 'Itaú'), -1);
  assert.equal(cleanCheque({ num: '1', valor: 1.005 }, true).problem.code, 'INVALID_AMOUNT');
  assert.equal(cleanCheque({ num: '1', valor: 1, bomPara: '31/02/2026' }, true).problem.code, 'INVALID_DATE');
  assert.equal(cleanCheque({ num: '1', valor: 1, status: 'Devolvido' }, true).problem.code, 'INVALID_STATUS');
  assert.equal(cleanCheque({ num: '1', valor: 1, status: 'Devolvido', motivoDevolucao: 'sem fundos' }, false).fields.motivoDevolucao, 'sem fundos');
});

test('adiantamento de cliente: cria pelo servidor, exclui se livre e bloqueia o usado em venda', async () => {
  const created = await call({ action: 'create-advance', cliente: 'gerdau', advance: { valor: 250.5, data: '2026-11-18', forma: 'PIX', bancoCod: 'B1', vinculo: 'Pedido 7', obs: 'teste' } });
  assert.match(created.advance.cod, /^ADTC\d{10}$/);
  const stored = list(await read('erp/adtCli/GERDAU'));
  assert.deepEqual(stored.map((a) => [a.cod, a.valor, a.status]).slice(-1), [[created.advance.cod, 250.5, 'Pendente']]);
  assert.deepEqual([stored.at(-1).data, stored.at(-1).bancoNome, stored.at(-1).criadoPor], ['18/11/2026', 'Sicredi', 'elaine']);
  await assert.rejects(call({ action: 'create-advance', cliente: 'NAO EXISTE', advance: { valor: 1, data: '2026-11-18' } }), { code: 'CLIENT_NOT_FOUND' });
  await assert.rejects(call({ action: 'create-advance', cliente: 'GERDAU', advance: { valor: 1, data: '2026-11-18', bancoCod: 'B9' } }), { code: 'BANK_NOT_FOUND' });
  await call({ action: 'delete-advance', cliente: 'GERDAU', cod: created.advance.cod });
  assert.equal(list(await read('erp/adtCli/GERDAU')).length, 1);
  await changeSale(identity, { operationId: randomUUID(), action: 'save', order: { client: 'GERDAU', date: '2026-11-12', items: [{ material: 'FERRO', quantity: '2000', price: '1,5', weighing: 'T50' }], weighings: ['T50'], credits: ['advance:ADTC1'], installments: [{ dueDate: '2026-11-12', amount: '2000', method: 'Boleto' }] } }, { db, now: () => NOW });
  assert.equal(list(await read('erp/adtCli/GERDAU'))[0].status, 'Quitado');
  await assert.rejects(call({ action: 'delete-advance', cliente: 'GERDAU', cod: 'ADTC1' }), (error) => error.code === 'ADVANCE_USED' && /desfaça|exclua ou edite a venda/.test(error.message));
  await assert.rejects(call({ action: 'create-advance', cliente: 'GERDAU', advance: { valor: 1, data: '2026-11-18' } }, { ...identity, canFinance: false }), { code: 'FINANCE_REQUIRED' });
});

test('cheques de cliente: lançar vários, recusar repetido, editar, ciclo de situação com motivo e excluir o certo', async () => {
  const added = await call({ action: 'create-cheques', cliente: 'GERDAU', cheques: [
    { num: '901', valor: 100, bomPara: '2026-12-01', banco: 'Itaú', emitente: 'JOSE', tipo: 'Adiantamento' },
    { num: '902', valor: 200, bomPara: '2026-12-02', banco: 'Itaú', status: 'Compensado' },
  ] });
  assert.equal(added.added, 2);
  await assert.rejects(call({ action: 'create-cheques', cliente: 'GERDAU', cheques: [{ num: '901', valor: 1, banco: 'itau' }] }), { code: 'CHEQUE_EXISTS' });
  await call({ action: 'create-cheques', cliente: 'GERDAU', cheques: [{ num: '901', valor: 1, banco: 'Bradesco' }] });
  const edited = await call({ action: 'update-cheque', cliente: 'GERDAU', num: '850', banco: 'Caixa', index: 1, cheque: { num: '850', valor: 75, banco: 'Caixa', bomPara: '10/12/2026', status: 'Pendente', obs: 'corrigido' } });
  assert.deepEqual(edited.cheques.slice(0, 2).map((c) => [c.banco, c.valor, c.obs || '']), [['Itaú', 500, ''], ['Caixa', 75, 'corrigido']], 'mudou o cheque da Caixa, não o do Itaú');
  const cycled = await call({ action: 'cycle-cheque-status', cliente: 'GERDAU', num: '901', banco: 'Itaú', expectedStatus: 'Pendente' });
  assert.equal(cycled.status, 'Compensado');
  await call({ action: 'cycle-cheque-status', cliente: 'GERDAU', num: '901', banco: 'Itaú', motivo: 'sem fundos' });
  const bounced = list(await read('erp/chequesCli/GERDAU')).find((c) => c.num === '901' && c.banco === 'Itaú');
  assert.deepEqual([bounced.status, bounced.motivoDevolucao], ['Devolvido', 'sem fundos']);
  await assert.rejects(call({ action: 'cycle-cheque-status', cliente: 'GERDAU', num: '901', banco: 'Itaú', expectedStatus: 'Pendente' }), { code: 'CHEQUE_CHANGED' });
  await call({ action: 'delete-cheque', cliente: 'GERDAU', num: '901', banco: 'Bradesco' });
  const left = list(await read('erp/chequesCli/GERDAU'));
  assert.deepEqual(left.map((c) => c.num + '/' + c.banco), ['850/Itaú', '850/Caixa', '901/Itaú', '902/Itaú']);
});

test('cheque usado em venda não volta para Pendente, não muda valor e não é excluído; desfazer a venda libera', async () => {
  await changeSale(identity, { operationId: randomUUID(), action: 'save', order: { client: 'GERDAU', date: '2026-11-12', items: [{ material: 'FERRO', quantity: '2000', price: '1,5', weighing: 'T50' }], weighings: ['T50'], credits: ['cheque:850@itau'], installments: [{ dueDate: '2026-11-12', amount: '2500', method: 'Boleto' }] } }, { db, now: () => NOW });
  const used = list(await read('erp/chequesCli/GERDAU'))[0];
  assert.equal(used.status, 'Quitado');
  await assert.rejects(call({ action: 'cycle-cheque-status', cliente: 'GERDAU', num: '850', banco: 'Itaú', index: 0 }), { code: 'CHEQUE_USED_IN_SALE' });
  await assert.rejects(call({ action: 'update-cheque', cliente: 'GERDAU', num: '850', banco: 'Itaú', index: 0, cheque: { num: '850', valor: 1, banco: 'Itaú', status: 'Pendente' } }), { code: 'CHEQUE_USED_IN_SALE' });
  await assert.rejects(call({ action: 'delete-cheque', cliente: 'GERDAU', num: '850', banco: 'Itaú', index: 0 }), (error) => error.code === 'CHEQUE_USED_IN_SALE' && /Para excluir/.test(error.message));
  const describe = await call({ action: 'update-cheque', cliente: 'GERDAU', num: '850', banco: 'Itaú', index: 0, cheque: { num: '850', valor: 500, banco: 'Itaú', status: 'Quitado', emitente: 'GERDAU SA', obs: 'nominal' } });
  assert.deepEqual([describe.cheques[0].status, describe.cheques[0].emitente, describe.cheques[0].vinculo], ['Quitado', 'GERDAU SA', used.vinculo], 'só os dados descritivos mudam');
});

test('cheque de recebimento de conta a receber: não é excluído nem muda valor pela lista; a situação pode mudar', async () => {
  await changeReceivable(identity, { operationId: randomUUID(), action: 'receive', id: 'CRX', date: '2026-11-18', cheques: [{ num: '777', valor: 300, banco: 'Bradesco', bomPara: '2026-12-20' }] }, { db, now: () => NOW });
  const cheque = list(await read('erp/chequesCli/TUPY'))[0];
  assert.equal(cheque.contaReceberId, 'CRX');
  await assert.rejects(call({ action: 'delete-cheque', cliente: 'TUPY', num: '777', banco: 'Bradesco' }), { code: 'CHEQUE_FROM_RECEIPT' });
  await assert.rejects(call({ action: 'update-cheque', cliente: 'TUPY', num: '777', banco: 'Bradesco', cheque: { num: '777', valor: 299, banco: 'Bradesco', status: 'Pendente' } }), { code: 'CHEQUE_FROM_RECEIPT' });
  const deposited = await call({ action: 'cycle-cheque-status', cliente: 'TUPY', num: '777', banco: 'Bradesco' });
  assert.equal(deposited.status, 'Compensado');
});

test('repetir a mesma operação não lança de novo; endpoint chama o servidor', async () => {
  const operationId = randomUUID();
  const body = { action: 'create-cheques', operationId, cliente: 'GERDAU', cheques: [{ num: '555', valor: 10, banco: 'Itaú' }] };
  await changeClientCredit(identity, body, { db, now: () => NOW });
  const again = await changeClientCredit(identity, body, { db, now: () => NOW });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(list(await read('erp/chequesCli/GERDAU')).filter((c) => c.num === '555').length, 1);
  assert.match(readFileSync(new URL('../api/finance/client-credits.ts', import.meta.url), 'utf8'), /changeClientCredit\(identity, body as Body\)/);
});

test('venda com dois cheques de mesmo número em bancos diferentes: usa só o escolhido e só o valor dele', async () => {
  const { clientCredits } = await import('../server/modules/sales/domain/sales.ts');
  const credits = clientCredits({ clientCheques: { GERDAU: list((await read('erp/chequesCli/GERDAU'))) }, clientAdvances: {} }, 'GERDAU');
  assert.deepEqual(credits.map((c) => [c.ref, c.amount]), [['850@itau', 500], ['850@caixa', 70]]);
  await changeSale(identity, { operationId: randomUUID(), action: 'save', order: { client: 'GERDAU', date: '2026-11-12', items: [{ material: 'FERRO', quantity: '2000', price: '1,5', weighing: 'T50' }], weighings: ['T50'], credits: ['cheque:850@caixa'], installments: [{ dueDate: '2026-11-12', amount: '2930', method: 'Boleto' }] } }, { db, now: () => NOW });
  const after = list(await read('erp/chequesCli/GERDAU'));
  assert.deepEqual(after.map((c) => c.banco + ':' + c.status), ['Itaú:Pendente', 'Caixa:Quitado']);
  const sale = Object.values((await read('erp/vendas')) || {})[0];
  assert.deepEqual(sale.abatimentos.map((a) => [a.num, a.valor]), [['850@caixa', 70]]);
  await changeSale(identity, { operationId: randomUUID(), action: 'delete', saleId: sale.id }, { db, now: () => NOW });
  assert.deepEqual(list(await read('erp/chequesCli/GERDAU')).map((c) => c.banco + ':' + c.status), ['Itaú:Pendente', 'Caixa:Pendente'], 'excluir a venda devolve o cheque certo');
});

test('tela: botões mandam número, banco e posição do cheque; cheque usado em venda não entra no ciclo; sincronização não grava', async () => {
  const { runInNewContext } = await import('node:vm');
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  const slice = (a, b) => { const i = core.indexOf(a); const j = core.indexOf(b, i); assert.ok(i > 0 && j > i, a); return core.slice(i, j); };
  const at = slice('function _cliChequeAt(cliNome,num,banco,idx){', '\n}\n') + '\n}\n';
  const code = at + slice('async function alterarStatusChequeCli(', 'function editarChequeCli(');
  const calls = [], toasts = [];
  const ctx = {
    CHEQUES_CLI: { GERDAU: [{ num: '850', banco: 'Itaú', status: 'Pendente' }, { num: '850', banco: 'Caixa', status: 'Quitado', vinculo: 'V0001' }] },
    _cliCreditoApi: async (body) => { calls.push(JSON.parse(JSON.stringify(body))); return {}; },
    confirm: () => true, prompt: () => 'sem fundos', showToast: (m, t) => toasts.push([t, m]),
  };
  runInNewContext(code, ctx);
  await ctx.alterarStatusChequeCli('GERDAU', '850', 'Itaú', 0);
  await ctx.alterarStatusChequeCli('GERDAU', '850', 'Caixa', 1);
  await ctx.excluirChequeCli('GERDAU', '850', 'Caixa', 1);
  assert.deepEqual(calls, [
    { action: 'cycle-cheque-status', cliente: 'GERDAU', num: '850', banco: 'Itaú', index: 0, expectedStatus: 'Pendente', motivo: '' },
    { action: 'delete-cheque', cliente: 'GERDAU', num: '850', banco: 'Caixa', index: 1 },
  ]);
  assert.match(toasts.find((t) => t[0] === 'info')[1], /usado na venda V0001/);
  assert.match(core, /editarChequeCli\(\$\{_jsArg\(c\.cliNome\)\},\$\{_jsArg\(c\.num\)\},\$\{_jsArg\(c\.banco\|\|''\)\},\$\{c\._idx\}\)/);
  assert.match(core, /Quitado \(usado em venda\)/);
  assert.doesNotMatch(sync, /_patchIncremental\(dados, '(adtCli|chequesCli)'/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.erp;
  assert.deepEqual([rules.adtCli['.write'], rules.chequesCli['.write']], [false, false]);
});

test('ficha do cliente: lançar, editar e excluir lançamento pelo servidor; débito e crédito saem do tipo', async () => {
  const created = await call({ action: 'save-entry', cliente: 'GERDAU', entry: { tipo: 'entrega', data: '2026-11-18', peso: 1000.5, valorkg: 2.5, material: 'FERRO', valor: 2501.25, hist: 'Entrega de metal - FERRO' } });
  const entry = created.entry;
  assert.match(entry.id, /^fcl\d+$/);
  assert.deepEqual([entry.debito, entry.credito, entry.data, entry.peso, entry.criadoPor], [2501.25, 0, '18/11/2026', 1000.5, 'elaine']);
  await call({ action: 'save-entry', cliente: 'GERDAU', entry: { tipo: 'deposito', data: '19/11/2026', valor: 500, emitente: 'GERDAU', num: '9', hist: 'DEP.GERDAU CH 9' } });
  await reject(call({ action: 'save-entry', cliente: 'GERDAU', expected: { debito: 1, credito: 0 }, entry: { id: entry.id, tipo: 'entrega', valor: 10, hist: 'x' } }), 'ENTRY_CHANGED');
  await call({ action: 'save-entry', cliente: 'GERDAU', expected: { debito: 2501.25, credito: 0 }, entry: { id: entry.id, tipo: 'ch_devol', valor: 300, num: '77', hist: 'CH DEVOL.77' } });
  let rows = list(await read('erp/fcLanc/GERDAU'));
  const edited = rows.find((r) => r.id === entry.id);
  assert.deepEqual([rows.length, edited.tipo, edited.debito, edited.credito, edited.alteradoPor], [2, 'ch_devol', 300, 0, 'elaine']);
  const removed = await call({ action: 'delete-entry', cliente: 'GERDAU', id: entry.id });
  assert.equal(removed.removed.id, entry.id);
  rows = list(await read('erp/fcLanc/GERDAU'));
  assert.deepEqual(rows.map((r) => [r.tipo, r.credito]), [['deposito', 500]]);
  await reject(call({ action: 'delete-entry', cliente: 'GERDAU', id: entry.id }), 'ENTRY_NOT_FOUND');
  await reject(call({ action: 'save-entry', cliente: 'GERDAU', entry: { tipo: 'outro', valor: 1, hist: 'x' } }), 'INVALID_TYPE');
  await reject(call({ action: 'save-entry', cliente: 'GERDAU', entry: { tipo: 'deposito', valor: 1.001, hist: 'x' } }), 'INVALID_AMOUNT');
  await reject(call({ action: 'save-entry', cliente: 'GERDAU', entry: { tipo: 'deposito', valor: 1, hist: ' ' } }), 'HISTORY_REQUIRED');
});

test('ficha do cliente: cliente sem cadastro mas com venda ou ficha antiga continua aceito; nome desconhecido é recusado', async () => {
  srv.seed('erp/vendas/V9', { id: 'V9', cliente: 'Metalúrgica Antiga', valor: 10 });
  await call({ action: 'save-entry', cliente: 'Metalúrgica Antiga', entry: { tipo: 'deposito', valor: 10, hist: 'DEP.' } });
  srv.seed('erp/fcLanc/SO FICHA', [{ id: 'fcl1', tipo: 'entrega', debito: 5, credito: 0, hist: 'antigo' }]);
  await call({ action: 'save-entry', cliente: 'SO FICHA', entry: { tipo: 'deposito', valor: 5, hist: 'DEP.' } });
  assert.equal(list(await read('erp/fcLanc/SO FICHA')).length, 2);
  await reject(call({ action: 'save-entry', cliente: 'NINGUEM', entry: { tipo: 'deposito', valor: 5, hist: 'DEP.' } }), 'CLIENT_NOT_FOUND');
  await reject(call({ action: 'save-entry', cliente: 'A/B', entry: { tipo: 'deposito', valor: 5, hist: 'DEP.' } }), 'INVALID_CLIENT');
});

test('ficha do cliente: saldo anterior grava, zera e tira a marca de excluído antiga', async () => {
  srv.seed('erp/fcSaldoIniDeleted', ['GERDAU', 'OUTRO']);
  const saved = await call({ action: 'set-opening-balance', cliente: 'GERDAU', balance: { valor: -1500.5, data: '2026-01-01' } });
  assert.deepEqual([saved.balance.valor, saved.balance.data], [-1500.5, '01/01/2026']);
  assert.deepEqual(list(await read('erp/fcSaldoIniDeleted')), ['OUTRO']);
  await reject(call({ action: 'set-opening-balance', cliente: 'GERDAU', balance: { valor: 1.234 } }), 'INVALID_AMOUNT');
  const cleared = await call({ action: 'set-opening-balance', cliente: 'GERDAU', balance: { valor: 0 } });
  assert.equal(cleared.balance, null);
  assert.equal(await read('erp/fcSaldoIni/GERDAU'), null);
});

test('ficha do cliente: a tela pede ao servidor e a sincronização não grava fcLanc nem fcSaldoIni', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  for (const [name, action] of [['fcSalvarLanc', 'save-entry'], ['fcExcluirLanc', 'delete-entry'], ['fcQuitarSaldo', 'save-entry'], ['fcSalvarSaldoAnterior', 'set-opening-balance']]) {
    const start = core.indexOf('function ' + name + '(');
    const body = core.slice(start, core.indexOf('\n      }\n', start));
    assert.ok(body.includes('_cliCreditoApi(') && body.includes("'" + action + "'"), name + ' usa a API com ' + action);
    assert.doesNotMatch(body, /FC_LANC\[[^\]]+\]\.push|FC_LANC\[_fcCliAtual\]=|saveFcLanc|_apagarChave/, name);
  }
  assert.doesNotMatch(sync, /_patchIncremental\(dados, '(fcLanc|fcSaldoIni)'/);
  assert.match(sync, /\n      delete dados\.fcSaldoIniDeleted;/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.erp;
  assert.deepEqual([rules.fcLanc['.write'], rules.fcSaldoIni['.write'], rules.fcSaldoIniDeleted['.write']], [false, false, false]);
});
