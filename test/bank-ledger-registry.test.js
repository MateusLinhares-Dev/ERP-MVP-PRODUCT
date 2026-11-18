import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import {
  centsOf,
  chequeAutoDebit,
  cleanAccount,
  cleanEntry,
  lockedMovement,
  nextBankCode,
} from '../server/modules/banking/domain/bank-ledger-rules.ts';

const identity = { uid: 'erp:elaine', erpUser: 'elaine', erpAccess: true, canBanking: true, canFinance: true };
let srv, db, app, changeBankLedger;
const viaSdk = async (path) => (await db.ref(path).get()).val();
const call = (body, who = identity) => changeBankLedger(who, { operationId: randomUUID(), ...body }, { db });
const baseData = () => ({ erp: {
  bancos: {
    BCa: { id: 'BCa', cod: 'BC-001', banco: 'Sicredi', tipo: 'Conta Corrente', empresa: 'Manuela Metais', agencia: '0101', conta: '123-4', saldo: 100, _upd: 5 },
    BCb: { id: 'BCb', cod: 'BC-002', banco: 'Itaú', tipo: 'Conta Terceiro', titular: 'JOSE', cpfcnpj: '529.982.247-25', empresa: 'Manuela Metais', saldo: 0 },
    BCc: { id: 'BCc', cod: 'BC-002', banco: 'Itaú repetido', tipo: 'Conta Corrente', empresa: 'Manuela Metais', saldo: 0 },
    BCd: { id: 'BCd', cod: 'BC-004', banco: 'Caixa vazio', tipo: 'Caixa', empresa: 'Manuela Metais', saldo: 0 },
  },
  bancosDeletedV2: { BCz: true },
  lancBanco: {
    'LB-1': { id: 'LB-1', bancoCod: 'BC-001', data: '2026-11-10', descricao: 'Depósito', tipo: 'Entrada', valor: 50 },
    'LB-PG-1': { id: 'LB-PG-1', bancoCod: 'BC-001', data: '10/11/2026', descricao: 'Pagto: Copel', tipo: 'Saida', valor: 30, payableId: 'CP1' },
    'LB-ADT': { id: 'LB-ADT', bancoCod: 'BC-001', data: '10/11/2026', descricao: 'Antecipação', tipo: 'Saida', valor: 20 },
    'LB-OLD': { id: 'LB-OLD', bancoCod: 'BC-002', data: '10/11/2026', descricao: 'Tarifa', tipo: 'Saída', valor: 5 },
  },
  adiantamentos: { F001: [{ cod: 'A1', valor: 20, status: 'Quitado', bancoCod: 'BC-001', movBancoId: 'LB-ADT' }, { cod: 'A2', valor: 300, status: 'Pendente', forma: 'Cheque' }] },
  chequesControle: {
    CC1: { id: 'CC1', n: '101', b: 'Sicredi', v: 250.5, c: 'CLIENTE X', s: 'A' },
    CC2: { id: 'CC2', n: '102', b: 'Sicredi', v: 80, c: 'CLIENTE Y', s: 'A', dc: true },
    CC3: { id: 'CC3', n: '103', b: 'Sicredi', v: 300, s: 'A', dc: true, advanceCode: 'A2', fornCod: 'F001', tipoCheque: 'Cheque Próprio' },
    CC4: { id: 'CC4', n: '104', b: 'Sicredi', v: 90, s: 'A', dc: true, advanceCode: 'A1', fornCod: 'F001' },
    CC5: { id: 'CC5', n: '105', b: 'Sicredi', v: 40, s: 'C', cd: '01/11/2026' },
  },
  chequesControle_del: {},
  _ts: 1,
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
  ({ changeBankLedger } = await import('../server/modules/banking/index.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});

test('regras: valores em centavos, campos da conta e do lançamento, próximo código e travas', () => {
  assert.equal(centsOf(10.1), 1010);
  assert.equal(centsOf(0.1 + 0.2), 30);
  assert.equal(centsOf(10.123), null);
  assert.equal(centsOf(-5), null);
  assert.equal(centsOf(-5, { allowNegative: true }), -500);
  assert.equal(centsOf('10'), null);
  assert.equal(nextBankCode(['BC-001', 'BC-007', 'X']), 'BC-008');
  assert.equal(nextBankCode([]), 'BC-001');
  assert.equal(cleanAccount({ banco: '  ' }, true).problem.code, 'BANK_NAME_REQUIRED');
  assert.equal(cleanAccount({ banco: 'X', tipo: 'Cofre' }, true).problem.code, 'INVALID_ACCOUNT_TYPE');
  assert.deepEqual(cleanAccount({ banco: ' Sicredi  Matriz ', saldo: -12.5, criadoEm: '05/11/2026', hack: 1 }, true).fields,
    { banco: 'Sicredi Matriz', tipo: 'Conta Corrente', saldo: -12.5, criadoEm: '2026-11-05T12:00:00.000Z' });
  assert.equal(cleanEntry({ data: '2026-02-30', descricao: 'x', tipo: 'Entrada', valor: 1 }, true).problem.code, 'INVALID_DATE');
  assert.equal(cleanEntry({ data: '2026-11-17', descricao: 'x', tipo: 'Crédito', valor: 1 }, true).fields.tipo, 'Entrada');
  assert.equal(cleanEntry({ data: '2026-11-17', descricao: 'x', tipo: 'Saida', valor: 1 }, true).fields.tipo, 'Saída');
  assert.equal(cleanEntry({ data: '2026-11-17', descricao: '', tipo: 'Saída', valor: 1 }, true).problem.code, 'DESCRIPTION_REQUIRED');
  const links = { advanceMovementIds: new Set(['LB-A']), chequeMovementIds: new Set(['LB-C']) };
  assert.equal(lockedMovement({ id: 'LB-PG-1' }, links).code, 'MOVEMENT_FROM_PAYMENT');
  assert.equal(lockedMovement({ id: 'LB-REP-1' }, links).code, 'MOVEMENT_FROM_REPASSE');
  assert.equal(lockedMovement({ id: 'LB-VD-1' }, links).code, 'MOVEMENT_FROM_SALE');
  assert.equal(lockedMovement({ id: 'LB-CR-1' }, links).code, 'MOVEMENT_FROM_RECEIVABLE');
  assert.equal(lockedMovement({ id: 'LB-A' }, links).code, 'MOVEMENT_FROM_ADVANCE');
  assert.equal(lockedMovement({ id: 'X', descricao: 'Adiantamento: CICLO' }, links).code, 'MOVEMENT_FROM_ADVANCE');
  assert.equal(lockedMovement({ id: 'LB-C' }, links).code, 'MOVEMENT_FROM_CHEQUE');
  assert.equal(lockedMovement({ id: 'LB-9', reconciliationImportId: 'I1' }, links), null);
  assert.equal(chequeAutoDebit({}, []), null);
  assert.equal(chequeAutoDebit({ advanceCode: 'A1', tipoCheque: 'Cheque de Terceiro' }, []), false);
  assert.equal(chequeAutoDebit({ advanceCode: 'A1' }, [{ cod: 'A1', movBancoId: 'LB-X' }]), false);
  assert.equal(chequeAutoDebit({ advanceCode: 'A1' }, { 0: { cod: 'A1' } }), true);
});

test('conta nova: próximo código, campos limpos, recusa repetida e perfil sem Bancos', async () => {
  srv.reset(baseData());
  const created = await call({ action: 'create-account', account: { banco: 'Bradesco', tipo: 'Poupança', empresa: 'Manuela Metais', agencia: '22', conta: '9-9', saldo: 1524205.97, criadoEm: '2026-11-01', cpfcnpj: 'ignorado', hack: 'x' } });
  assert.equal(created.account.cod, 'BC-005');
  const stored = await viaSdk('erp/bancos/' + created.account.id);
  assert.equal(stored.banco, 'Bradesco');
  assert.equal(stored.saldo, 1524205.97);
  assert.equal(stored.cpfcnpj, '');
  assert.equal(stored.criadoEm, '2026-11-01T12:00:00.000Z');
  assert.equal(stored.criadoPor, 'elaine');
  assert.equal(stored.hack, undefined);
  assert.ok((await viaSdk('erp/_ts')) > 1);
  await assert.rejects(call({ action: 'create-account', account: { banco: 'sicredi', agencia: '0101', conta: '123-4', empresa: 'Manuela Metais' } }), { code: 'BANK_EXISTS' });
  await assert.rejects(call({ action: 'create-account', account: { banco: 'X' } }, { ...identity, canBanking: false }), { code: 'BANKING_REQUIRED' });
  await assert.rejects(call({ action: 'create-account', account: { banco: 'X', saldo: 1.005 } }), { code: 'INVALID_AMOUNT' });
});

test('editar conta: campos, CPF só para terceiro, edição concorrente e troca de código só quando repetido', async () => {
  srv.reset(baseData());
  const edited = await call({ action: 'update-account', id: 'BCb', account: { tipo: 'Conta Corrente', pix: 'chave', saldo: 10 } });
  assert.equal(edited.account.cpfcnpj, '');
  assert.equal(edited.account.pix, 'chave');
  assert.equal((await viaSdk('erp/bancos/BCb')).saldo, 10);
  await assert.rejects(call({ action: 'update-account', id: 'BCa', expectedUpdate: 4, account: { obs: 'x' } }), { code: 'BANK_CHANGED' });
  await assert.rejects(call({ action: 'update-account', id: 'BCa', account: { cod: 'BC-009' } }), { code: 'BANK_CODE_LOCKED' });
  await assert.rejects(call({ action: 'update-account', id: 'BCc', account: { cod: 'BC-001' } }), { code: 'BANK_CODE_IN_USE' });
  const fixed = await call({ action: 'update-account', id: 'BCc', account: { cod: 'BC-003' } });
  assert.deepEqual(fixed.codeChange, { from: 'BC-002', to: 'BC-003', movedEntries: 1 });
  assert.equal((await viaSdk('erp/lancBanco/LB-OLD')).bancoCod, 'BC-003');
  assert.equal((await viaSdk('erp/bancos/BCc')).cod, 'BC-003');
  await assert.rejects(call({ action: 'update-account', id: 'BCz', account: { obs: 'x' } }), { code: 'BANK_NOT_FOUND' });
});

test('excluir conta: bloqueia com lançamentos ou adiantamento pendente e grava a marca de exclusão', async () => {
  srv.reset(baseData());
  await assert.rejects(call({ action: 'delete-account', id: 'BCa' }), { code: 'BANK_IN_USE' });
  srv.seed('erp/adiantamentos/F002', [{ cod: 'A9', valor: 10, bancoCod: 'BC-004' }]);
  await assert.rejects(call({ action: 'delete-account', id: 'BCd' }), (error) => error.code === 'BANK_IN_USE' && /1 adiantamento/.test(error.message));
  srv.seed('erp/adiantamentos/F002', null);
  const result = await call({ action: 'delete-account', id: 'BCd' });
  assert.equal(result.cod, 'BC-004');
  assert.equal(await viaSdk('erp/bancos/BCd'), null);
  assert.equal(await viaSdk('erp/bancosDeletedV2/BCd'), true);
});

test('extrato: lançar, editar e excluir lançamento manual; automáticos travados', async () => {
  srv.reset(baseData());
  const added = await call({ action: 'add-entry', bankCode: 'BC-001', entry: { data: '2026-11-17', descricao: '  Tarifa  pacote ', tipo: 'Saída', valor: 12.34 } });
  const id = added.movement.id;
  assert.match(id, /^LB-\d+-[a-f0-9]{8}$/);
  assert.deepEqual((({ bancoCod, data, descricao, tipo, valor, origem }) => ({ bancoCod, data, descricao, tipo, valor, origem }))(await viaSdk('erp/lancBanco/' + id)),
    { bancoCod: 'BC-001', data: '2026-11-17', descricao: 'Tarifa pacote', tipo: 'Saída', valor: 12.34, origem: 'manual' });
  await assert.rejects(call({ action: 'add-entry', bankCode: 'BC-404', entry: { data: '2026-11-17', descricao: 'x', tipo: 'Entrada', valor: 1 } }), { code: 'BANK_NOT_FOUND' });
  await call({ action: 'update-entry', id, expected: { data: '2026-11-17', descricao: 'Tarifa pacote', tipo: 'Saída', valor: 12.34 }, entry: { valor: 15, tipo: 'Entrada' } });
  assert.equal((await viaSdk('erp/lancBanco/' + id)).valor, 15);
  await assert.rejects(call({ action: 'update-entry', id, expected: { data: '2026-11-17', descricao: 'Tarifa pacote', tipo: 'Saída', valor: 12.34 }, entry: { valor: 1 } }), { code: 'MOVEMENT_CHANGED' });
  await assert.rejects(call({ action: 'update-entry', id: 'LB-PG-1', entry: { valor: 1 } }), { code: 'MOVEMENT_FROM_PAYMENT' });
  await assert.rejects(call({ action: 'delete-entry', id: 'LB-ADT' }), { code: 'MOVEMENT_FROM_ADVANCE' });
  await call({ action: 'delete-entry', id: 'LB-1', expected: { data: '2026-11-10', descricao: 'Depósito', tipo: 'Entrada', valor: 50 } });
  assert.equal(await viaSdk('erp/lancBanco/LB-1'), null);
  assert.equal(await viaSdk('erp/lancBancoDeletedV2/LB-1'), true);
  await assert.rejects(call({ action: 'delete-entry', id: 'LB-1' }), { code: 'MOVEMENT_NOT_FOUND' });
});

test('cheques: compensar lança a saída certa, respeita adiantamento e terceiro; reabrir e excluir desfazem', async () => {
  srv.reset(baseData());
  const cleared = await call({ action: 'clear-cheques', date: '2026-11-17', mode: 'remessa', cheques: [
    { id: 'CC1', bankCode: 'BC-001' }, { id: 'CC2', bankCode: 'BC-001' }, { id: 'CC3', bankCode: 'BC-001' }, { id: 'CC4', bankCode: 'BC-001' }, { id: 'CC5', bankCode: 'BC-001' },
  ] });
  assert.deepEqual(cleared.skipped, ['CC5']);
  assert.equal(cleared.movements.length, 2);
  const byCheque = Object.fromEntries(cleared.movements.map((m) => [m.chequeId, m]));
  assert.equal(byCheque.CC1.valor, 250.5);
  assert.equal(byCheque.CC1.descricao, 'Cheque nº 101 compensado (remessa 17/11/2026)');
  assert.equal(byCheque.CC1.tipo, 'Saida');
  assert.equal(byCheque.CC3.valor, 300, 'cheque próprio do adiantamento sem saída no banco: desconta agora');
  assert.equal(byCheque.CC2, undefined, 'marcado como desconto da compra: não desconta de novo');
  assert.equal(byCheque.CC4, undefined, 'adiantamento já saiu do banco');
  const cc1 = await viaSdk('erp/chequesControle/CC1');
  assert.deepEqual([cc1.s, cc1.cd, cc1.movBancoId, cc1.c], ['C', '17/11/2026', byCheque.CC1.id, 'CLIENTE X']);
  assert.equal((await viaSdk('erp/chequesControle/CC2')).s, 'C');
  assert.equal((await viaSdk('erp/lancBanco/' + byCheque.CC1.id)).source, 'cheque');
  await assert.rejects(call({ action: 'update-entry', id: byCheque.CC1.id, entry: { valor: 1 } }), { code: 'MOVEMENT_FROM_CHEQUE' });

  const reopened = await call({ action: 'reopen-cheque', id: 'CC1' });
  assert.equal(reopened.removedMovementId, byCheque.CC1.id);
  assert.equal(await viaSdk('erp/lancBanco/' + byCheque.CC1.id), null);
  assert.equal(await viaSdk('erp/lancBancoDeletedV2/' + byCheque.CC1.id), true);
  const again = await viaSdk('erp/chequesControle/CC1');
  assert.deepEqual([again.s, again.cd, again.movBancoId], ['A', '', undefined]);

  await assert.rejects(call({ action: 'delete-cheque', id: 'CC3' }), { code: 'CHEQUE_FROM_ADVANCE' });
  const deleted = await call({ action: 'delete-cheque', id: 'CC1' });
  assert.equal(deleted.removedMovementId, '');
  assert.equal(await viaSdk('erp/chequesControle/CC1'), null);
  assert.equal(await viaSdk('erp/chequesControle_del/CC1'), true);
  await assert.rejects(call({ action: 'reopen-cheque', id: 'CC1' }), { code: 'CHEQUE_NOT_FOUND' });
});

test('cheques sem acesso a Bancos: compensa sem lançar e avisa; reabrir com saída exige Bancos', async () => {
  srv.reset(baseData());
  const finance = { ...identity, canBanking: false };
  const cleared = await call({ action: 'clear-cheques', date: '17/11/2026', cheques: [{ id: 'CC1', bankCode: 'BC-001' }, { id: 'CC2', bankCode: '', debit: true }] }, finance);
  assert.equal(cleared.movements.length, 0);
  assert.equal(cleared.warnings.length, 2);
  assert.match(cleared.warnings[0], /não tem acesso a Bancos/);
  assert.equal((await viaSdk('erp/chequesControle/CC1')).s, 'C');
  const withBank = await call({ action: 'clear-cheques', date: '2026-11-17', cheques: [{ id: 'CC3', bankCode: 'BC-404' }] });
  assert.match(withBank.warnings[0], /não tem conta bancária ligada/);
  srv.seed('erp/chequesControle/CC5/movBancoId', 'LB-1');
  await assert.rejects(call({ action: 'reopen-cheque', id: 'CC5' }, finance), { code: 'BANKING_REQUIRED' });
  await assert.rejects(call({ action: 'clear-cheques', date: '2026-11-17', cheques: [{ id: 'CC1' }] }, { ...identity, canFinance: false }), { code: 'FINANCE_REQUIRED' });
});

test('repetir a mesma operação devolve o resultado gravado sem lançar de novo', async () => {
  srv.reset(baseData());
  const operationId = randomUUID();
  const body = { action: 'add-entry', operationId, bankCode: 'BC-001', entry: { data: '2026-11-17', descricao: 'PIX', tipo: 'Entrada', valor: 9 } };
  const first = await changeBankLedger(identity, body, { db });
  const second = await changeBankLedger(identity, body, { db });
  assert.equal(second.alreadyCommitted, true);
  assert.equal(second.movement.id, first.movement.id);
  assert.equal(Object.values(await viaSdk('erp/lancBanco')).filter((m) => m.descricao === 'PIX').length, 1);
});

test('endpoint POST /api/banking/ledger chama o servidor', () => {
  const source = readFileSync(new URL('../api/banking/ledger.ts', import.meta.url), 'utf8');
  assert.match(source, /changeBankLedger\(identity, body as Body\)/);
});

test('cadastro de cheque: cria com código do banco, recusa número repetido e não deixa mexer em cheque de adiantamento', async () => {
  srv.reset(baseData());
  const created = await call({ action: 'save-cheque', slug: 'SIC', cheque: { b: 'Sicredi', n: '900', c: 'FERRO VELHO', v: 1500.5, d: '17/11/2026', venc: '2026-12-17', cd: '', s: 'A' }, destino: { tipo: 'Cliente', cod: 'C9', nome: 'ferro velho' } });
  assert.equal(created.cheque.id, 'CCSIC900');
  const stored = await viaSdk('erp/chequesControle/CCSIC900');
  assert.deepEqual([stored.b, stored.n, stored.v, stored.venc, stored.s, stored.clienteCod, stored.alteradoPor], ['Sicredi', '900', 1500.5, '17/12/2026', 'A', 'C9', 'elaine']);
  await assert.rejects(call({ action: 'save-cheque', cheque: { b: ' sicredi ', n: '0900', c: 'X', v: 1, s: 'A' } }), (error) => error.code === 'CHEQUE_ALREADY_EXISTS' && /FERRO VELHO/.test(error.message));
  const supplierCheque = await call({ action: 'save-cheque', slug: 'SIC', cheque: { b: 'Sicredi', n: '910', c: 'JOAO ELIAS', v: 1, s: 'A' }, destino: { tipo: 'Fornecedor', cod: 'F003', nome: 'JOAO ELIAS' } });
  assert.deepEqual([supplierCheque.cheque.fornecedorCod, supplierCheque.cheque.fornecedorNome, supplierCheque.cheque.dest, supplierCheque.cheque.clienteCod], ['F003', 'JOAO ELIAS', 'JOAO ELIAS', undefined]);
  const renamed = await call({ action: 'save-cheque', id: supplierCheque.cheque.id, cheque: { b: 'Sicredi', n: '910', c: 'OUTRO NOME', v: 1, s: 'A' } });
  assert.equal(renamed.cheque.fornecedorCod, undefined, 'trocar o destino por texto tira o vínculo antigo');
  await call({ action: 'save-cheque', cheque: { b: 'Cheque de Terceiro', n: '1', c: 'A', v: 1, s: 'A' } });
  await call({ action: 'save-cheque', cheque: { b: 'Cheque de Terceiro', n: '1', c: 'B', v: 2, s: 'A' } });
  await assert.rejects(call({ action: 'save-cheque', id: 'CC3', cheque: { b: 'Sicredi', n: '103', c: 'X', v: 300, s: 'A' } }), { code: 'CHEQUE_FROM_ADVANCE' });
  await assert.rejects(call({ action: 'save-cheque', cheque: { b: 'Sicredi', n: '901', c: 'X', v: 1.005, s: 'A' } }), { code: 'INVALID_AMOUNT' });
  await assert.rejects(call({ action: 'save-cheque', cheque: { b: 'Sicredi', n: '901', c: 'X', v: 1, s: 'A', d: '31/02/2026' } }), { code: 'INVALID_DATE' });
  await assert.rejects(call({ action: 'save-cheque', cheque: { b: 'Sicredi', n: '901', c: 'X', v: 1, s: 'Z' } }), { code: 'INVALID_STATUS' });
  await assert.rejects(call({ action: 'save-cheque', cheque: { b: 'Sicredi', n: '901', c: 'X', v: 1, s: 'A' } }, { ...identity, canFinance: false }), { code: 'FINANCE_REQUIRED' });
});

test('editar cheque que já saiu do banco: só aceita destino e datas de saída/vencimento; banco, valor e situação pedem Reabrir', async () => {
  srv.reset(baseData());
  const cleared = await call({ action: 'clear-cheques', date: '2026-11-17', cheques: [{ id: 'CC1', bankCode: 'BC-001' }] });
  const movementId = cleared.movements[0].id;
  const base = { b: 'Sicredi', n: '101', c: 'CLIENTE X', v: 250.5, d: '', venc: '', cd: '17/11/2026', s: 'C' };
  for (const change of [{ v: 260 }, { s: 'A' }, { s: 'X' }, { b: 'Itaú' }, { n: '102' }, { cd: '18/11/2026' }])
    await assert.rejects(call({ action: 'save-cheque', id: 'CC1', cheque: { ...base, ...change } }), { code: 'CHEQUE_ALREADY_DEBITED' }, JSON.stringify(change));
  const ok = await call({ action: 'save-cheque', id: 'CC1', cheque: { ...base, c: 'CLIENTE CERTO', venc: '20/11/2026' } });
  assert.equal(ok.cheque.movBancoId, movementId, 'o vínculo com o extrato continua');
  const stored = await viaSdk('erp/chequesControle/CC1');
  assert.deepEqual([stored.c, stored.venc, stored.s, stored.movBancoId], ['CLIENTE CERTO', '20/11/2026', 'C', movementId]);
  const legacyEdit = await call({ action: 'save-cheque', id: 'CC5', cheque: { b: 'Sicredi', n: '105', c: '', v: 40, d: '', venc: '', cd: '', s: 'A' } });
  assert.equal(legacyEdit.cheque.s, 'A', 'compensado à mão, sem saída no banco, pode voltar a compensar');
});

test('remessa de cheques: números em sequência, pula os que já existem; desconta da compra liga e desliga', async () => {
  srv.reset(baseData());
  const batch = await call({ action: 'batch-cheques', slug: 'SIC', start: 104, count: 4, s: 'C', dc: true, cheque: { b: 'Sicredi', c: 'AF SUCATAS', v: 4990, d: '05/11/2026', venc: '' } });
  assert.deepEqual(batch.skipped, ['104', '105']);
  assert.deepEqual(batch.cheques.map((c) => [c.id, c.n, c.s, c.cd, c.dc]), [['CCSIC106', '106', 'C', '05/11/2026', true], ['CCSIC107', '107', 'C', '05/11/2026', true]]);
  assert.equal((await viaSdk('erp/chequesControle/CCSIC107')).v, 4990);
  await assert.rejects(call({ action: 'batch-cheques', start: 1, count: 201, cheque: { b: 'Sicredi', v: 1 } }), { code: 'INVALID_COUNT' });
  const on = await call({ action: 'toggle-cheque-discount', id: 'CC1' });
  assert.equal(on.cheque.dc, true);
  const off = await call({ action: 'toggle-cheque-discount', id: 'CC1' });
  assert.equal(off.cheque.dc, undefined);
  assert.equal((await viaSdk('erp/chequesControle/CC1')).dc, undefined);
  await assert.rejects(call({ action: 'toggle-cheque-discount', id: 'CC3' }), { code: 'CHEQUE_FROM_ADVANCE' });
});

test('sincronizar aba antiga pelo servidor: não estraga cheque de adiantamento nem cheque que já saiu do banco', async () => {
  srv.reset(baseData());
  srv.seed('erp/chequesControle/CC6', { id: 'CC6', n: '106', b: 'Sicredi', v: 70, s: 'A', movBancoId: 'LB-X' });
  srv.seed('erp/chequesControle_del/CCDEL', true);
  const result = await call({ action: 'import-legacy-cheques',
    items: [
      { id: 'CC1', b: 'Sicredi', n: '101', c: 'NOVO NOME', v: 999, d: '01/11/2026', cd: '', s: 'A' },
      { id: 'CC3', b: 'Sicredi', n: '103', c: 'ESTRAGARIA', v: 1, s: 'X' },
      { id: 'CC6', b: 'Sicredi', n: '106', c: 'SÓ O NOME', v: 1, s: 'X' },
      { id: 'CCNOVO7', b: 'Sicredi', n: '107', c: 'NOVO', v: 10, s: 'A' },
      { id: 'CCDEL', b: 'Sicredi', n: '108', c: 'APAGADO', v: 10, s: 'A' },
    ],
    ghosts: ['CC2', 'CC4', 'CC5'] });
  assert.deepEqual([result.created, result.updated, result.marked], [1, 2, 1]);
  const cc1 = await viaSdk('erp/chequesControle/CC1');
  assert.deepEqual([cc1.c, cc1.v, cc1.dc], ['NOVO NOME', 999, true]);
  const cc3 = await viaSdk('erp/chequesControle/CC3');
  assert.deepEqual([cc3.c, cc3.v, cc3.s, cc3.advanceCode], [undefined, 300, 'A', 'A2'], 'cheque de adiantamento intacto');
  const cc6 = await viaSdk('erp/chequesControle/CC6');
  assert.deepEqual([cc6.c, cc6.v, cc6.s, cc6.movBancoId], ['SÓ O NOME', 70, 'A', 'LB-X'], 'já saiu do banco: só o nome muda');
  assert.equal((await viaSdk('erp/chequesControle/CC2')).s, 'N');
  assert.equal((await viaSdk('erp/chequesControle/CC2')).c, 'CLIENTE Y', 'marcar "não existe" não apaga os outros dados');
  assert.equal((await viaSdk('erp/chequesControle/CC4')).s, 'A', 'cheque de adiantamento nunca vira "não existe"');
  assert.equal(await viaSdk('erp/chequesControle/CCDEL'), null);
});
