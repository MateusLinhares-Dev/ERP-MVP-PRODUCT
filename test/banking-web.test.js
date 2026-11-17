import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { addMoney, brl, isoDate, sign, statement, toCents } from '../web/modules/banking/domain/ledger.ts';
import {
  accountForm,
  accountRequest,
  accountRows,
  bankKpis,
  duplicateNames,
  movementCount,
  searchAccounts,
} from '../web/modules/banking/domain/accounts.ts';
import {
  emptyStatementFilter,
  entryFormOf,
  entryRequest,
  expectedOf,
  isAutomatic,
  statementView,
} from '../web/modules/banking/domain/statement-view.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const legacyWindow = {};
runInNewContext(read('public/modules/banking/bank-ledger.js'), { window: legacyWindow, BigInt, Date, Number, Math });
const legacy = legacyWindow.erpBankLedger;
const context = { companyOf: (raw) => raw.empresa || 'Manuela Metais', createdAt: (raw) => String(raw.criadoEm || '').slice(0, 10) };
const noLinks = { advanceMovementIds: new Set(), chequeMovementIds: new Set() };

test('extrato em TypeScript calcula igual ao cálculo antigo (ordem, saldo acumulado, centavos)', () => {
  const entries = [
    { id: 'L3', bancoCod: 'B1', data: '17/11/2026', tipo: 'Saída', valor: 0.3 },
    { id: 'L1', bancoCod: 'B1', data: '2026-11-10', tipo: 'Entrada', valor: 0.1 },
    { id: 'L2', bancoCod: 'B1', data: '2026-11-10', tipo: 'Crédito', valor: '0,20' },
    { id: 'LX', bancoCod: 'B2', data: '2026-11-10', tipo: 'Entrada', valor: 999 },
    { id: 'L4', bancoCod: 'B1', data: '', tipo: 'Saida', valor: 5 },
  ];
  const mine = statement(100, 'B1', entries);
  const old = legacy.statement({ openingBalance: 100, bankCode: 'B1', entries });
  assert.deepEqual(
    mine.rows.map((row) => [row.entry.id, row.balance, row.incoming]),
    old.rows.map((row) => [row.entry.id, row.balance, row.incoming]),
  );
  assert.deepEqual([mine.closingBalance, mine.credits, mine.debits], [old.closingBalance, old.credits, old.debits]);
  assert.equal(mine.closingBalance, 95);
  assert.equal(brl(-1234567.891), '-1.234.567,89');
  assert.equal(brl('lixo'), '0,00');
  assert.equal(sign(-0.001), 0);
  assert.equal(isoDate('31/02/2026'), '');
  assert.equal(addMoney([0.1, 0.2, 'x']), 0.3);
});

test('valor legado gigantesco não perde os centavos lançados depois; valor inválido não derruba a tela', () => {
  const huge = Number('12222222222222220000000000000000000000000');
  const bank = { id: 'BC1', cod: 'BC-001', banco: 'Teste', saldo: 1000 };
  const before = bankKpis(accountRows([bank], [{ bancoCod: 'BC-001', tipo: 'Entrada', valor: huge, data: '2026-10-20' }], context));
  const after = bankKpis(
    accountRows(
      [bank],
      [
        { bancoCod: 'BC-001', tipo: 'Entrada', valor: huge, data: '2026-10-20' },
        { bancoCod: 'BC-001', tipo: 'Entrada', valor: 1.11, data: '2026-10-24' },
      ],
      context,
    ),
  );
  assert.equal(toCents(after.total) - toCents(before.total), 111n);
  assert.equal(after.flagged, true);
  const invalid = bankKpis(accountRows([bank], [{ bancoCod: 'BC-001', tipo: 'Entrada', valor: 'valor inválido' }], context));
  assert.equal(brl(invalid.total), '1.000,00');
  assert.equal(invalid.flagged, true);
});

test('lista de contas: saldo atual por conta, total, busca sem acento e aviso de nomes repetidos', () => {
  const banks = {
    a: { id: 'BC1', cod: 'B1', banco: 'Sicredi', titular: 'MANUELA', pix: 'chave@pix', saldo: 100 },
    b: { id: 'BC2', cod: 'B2', banco: 'Itaú', tipo: 'Conta Terceiro', titular: 'JOSÉ', saldo: -50, empresa: 'RHID' },
    c: { id: 'BC3', cod: 'B3', banco: 'sicredi', saldo: 0 },
  };
  const entries = [{ bancoCod: 'B1', tipo: 'Entrada', valor: 25, data: '2026-11-01' }, null, { bancoCod: 'B2', tipo: 'Saída', valor: 10 }];
  const rows = accountRows(banks, entries, context);
  assert.deepEqual(rows.map((row) => [row.cod, row.balance, row.balanceSign, row.company]), [
    ['B1', 125, 1, 'Manuela Metais'],
    ['B2', -60, -1, 'RHID'],
    ['B3', 0, 0, 'Manuela Metais'],
  ]);
  assert.deepEqual(bankKpis(rows), { count: 3, total: 65, flagged: false });
  assert.deepEqual(duplicateNames(rows), [{ name: 'SICREDI', count: 2 }]);
  assert.deepEqual(searchAccounts(rows, 'jose').map((row) => row.cod), ['B2']);
  assert.deepEqual(searchAccounts(rows, 'CHAVE@').map((row) => row.cod), ['B1']);
  assert.equal(movementCount(entries, 'B1'), 1);
  assert.equal(movementCount(entries, ''), 0);
});

test('formulário da conta: valida, manda só o que o servidor aceita e o código só quando mudou', () => {
  const defaults = { company: 'Manuela Metais', holder: 'MANUELA METAIS LTDA', address: (c) => (c === 'Manuela Metais' ? 'Rua A, 1' : '') };
  const blank = accountForm(null, defaults);
  assert.equal(blank.endereco, 'Rua A, 1');
  assert.equal(accountRequest({ ...blank, banco: ' ' }, null, defaults.holder).message, 'Informe o nome do banco.');
  assert.match(accountRequest({ ...blank, banco: 'X', saldo: '1,234' }, null, defaults.holder).message, /Saldo inicial inválido/);
  const created = accountRequest({ ...blank, banco: ' Banco  do Brasil ', saldo: '1.524.205,97', cpfcnpj: '123', data: '2026-11-01' }, null, defaults.holder);
  assert.equal(created.payload.action, 'create-account');
  assert.deepEqual(
    [created.payload.account.banco, created.payload.account.saldo, created.payload.account.titular, created.payload.account.cpfcnpj, created.payload.account.criadoEm],
    ['Banco do Brasil', 1524205.97, 'MANUELA METAIS LTDA', '', '2026-11-01'],
  );
  const original = { id: 'BC2', cod: 'B2', banco: 'Itaú', tipo: 'Conta Terceiro', cpfcnpj: '529.982.247-25', saldo: 10.5, criadoEm: '2026-10-01T12:00:00.000Z', _upd: 77 };
  const form = accountForm(original, defaults);
  assert.deepEqual([form.saldo, form.data, form.cod, form.tipo], ['10,50', '2026-10-01', 'B2', 'Conta Terceiro']);
  const same = accountRequest(form, original, defaults.holder);
  assert.deepEqual([same.payload.action, same.payload.id, same.payload.expectedUpdate, 'cod' in same.payload.account, same.payload.account.cpfcnpj], ['update-account', 'BC2', 77, false, '529.982.247-25']);
  const recoded = accountRequest({ ...form, cod: 'B9', tipo: 'Poupança' }, original, defaults.holder);
  assert.deepEqual([recoded.payload.account.cod, recoded.payload.account.cpfcnpj], ['B9', '']);
});

test('extrato: mais recente primeiro, filtros, automáticos travados e lançamento validado', () => {
  const account = { cod: 'B1', banco: 'Sicredi', saldo: 100 };
  const entries = [
    { id: 'L1', bancoCod: 'B1', data: '2026-11-01', descricao: 'Depósito inicial', tipo: 'Entrada', valor: 50 },
    { id: 'LB-PG-1', bancoCod: 'B1', data: '05/11/2026', descricao: 'Pagto: Copel', tipo: 'Saida', valor: 30, payableId: 'CP1' },
    { id: 'L3', bancoCod: 'B1', data: '2026-11-10', descricao: 'Tarifa', tipo: 'Saída', valor: 12.34 },
    { id: 'LB-ADT', bancoCod: 'B1', data: '2026-11-11', descricao: 'Antecipação', tipo: 'Saida', valor: 20 },
  ];
  const links = { advanceMovementIds: new Set(['LB-ADT']), chequeMovementIds: new Set(['L-CHQ']) };
  const all = statementView(account, entries, emptyStatementFilter(), links);
  assert.deepEqual(all.lines.map((line) => line.id), ['LB-ADT', 'L3', 'LB-PG-1', 'L1']);
  assert.deepEqual(all.lines.map((line) => line.automatic), [true, false, true, false]);
  assert.equal(all.totals.closingBalance, 87.66);
  assert.deepEqual(statementView(account, entries, { ...emptyStatementFilter(), query: 'deposito' }, links).lines.map((l) => l.id), ['L1']);
  assert.deepEqual(statementView(account, entries, { ...emptyStatementFilter(), query: '12,34' }, links).lines.map((l) => l.id), ['L3']);
  assert.deepEqual(statementView(account, entries, { ...emptyStatementFilter(), kind: 'entrada' }, links).lines.map((l) => l.id), ['L1']);
  assert.deepEqual(statementView(account, entries, { ...emptyStatementFilter(), from: '2026-11-05', to: '2026-11-10' }, links).lines.map((l) => l.id), ['L3', 'LB-PG-1']);
  for (const entry of [{ id: 'LB-REP-1' }, { id: 'LB-VD-1' }, { id: 'LB-CR-1' }, { id: 'LB-CHQ-1' }, { id: 'X', source: 'cheque' }, { id: 'X', descricao: 'Adiantamento: CICLO' }, { id: 'L-CHQ' }, { id: 'X', receivableId: 'CR1' }])
    assert.equal(isAutomatic(entry, links), true, JSON.stringify(entry));
  assert.equal(isAutomatic({ id: 'L9', reconciliationImportId: 'I1' }, noLinks), false);
  assert.equal(entryRequest({ data: '', descricao: 'x', tipo: 'Entrada', valor: '1' }).message, 'Informe a data.');
  assert.equal(entryRequest({ data: '2026-11-17', descricao: ' ', tipo: 'Entrada', valor: '1' }).message, 'Informe a descrição.');
  assert.match(entryRequest({ data: '2026-11-17', descricao: 'x', tipo: 'Entrada', valor: '1,234' }).message, /duas casas/);
  assert.match(entryRequest({ data: '2026-11-17', descricao: 'x', tipo: 'Saída', valor: '12222222222222220000000000' }).message, /duas casas/);
  assert.deepEqual(entryRequest({ data: '17/11/2026', descricao: ' Tarifa  pacote ', tipo: 'Saída', valor: '1.234,50' }).entry, {
    data: '2026-11-17', descricao: 'Tarifa pacote', tipo: 'Saída', valor: 1234.5,
  });
  assert.deepEqual(entryFormOf(entries[1]), { data: '2026-11-05', descricao: 'Pagto: Copel', tipo: 'Saída', valor: '30,00' });
  assert.deepEqual(expectedOf(entries[2]), { data: '2026-11-10', descricao: 'Tarifa', tipo: 'Saída', valor: 12.34 });
});

test('tela de Bancos (React) grava pela API; a tela antiga saiu', () => {
  const core = read('public/legacy/app-core.js');
  for (const name of ['verExtratoBanco', 'salvarBanco', 'salvarEditBanco', 'editBanco', 'excluirBanco', 'salvarLancBanco', 'editLancBanco', 'salvarEditLancBanco', 'excluirLancBanco', '_erpBankMoreOpen', '_erpBankMoreReancorar'])
    assert.doesNotMatch(core, new RegExp('function ' + name + '\\('), name);
  assert.match(core, /function renderBancos\(\)\{\}/);
  assert.doesNotMatch(core, /banco:`<h3>🏦 Nova Conta Bancária/);
  assert.match(core, /window\.erpBankingSnapshot=function\(\)/);
  const html = read('public/index.template.html');
  assert.match(html, /<div class="tab-panel" id="tab-contas_banco">\s*<div class="sec-title">🏦 Contas Bancárias<\/div>\s*<div id="bancos-app"><\/div>/);
  assert.match(read('web/erp/islands.tsx'), /installBanking\(\);/);
  const island = read('web/erp/banking.tsx');
  for (const name of ['renderBancos: render', 'verExtratoBanco:', 'editBanco:', 'excluirBanco:', "type === 'banco'", 'erpReconciliationOpen', 'erpBankIntegrationsOpen', 'compartilharBanco'])
    assert.ok(island.includes(name), name);
  const workspace = read('web/modules/banking/ui/BankingWorkspace.tsx');
  assert.match(workspace, /className="erp-bank-more-popover"/);
  assert.match(workspace, /createPortal\(/);
  assert.match(workspace, /Contas cadastradas no sistema/);
  assert.match(workspace, /Saldo consolidado atualizado/);
  assert.match(workspace, /action: 'delete-account'/);
  const statementUi = read('web/modules/banking/ui/StatementDialog.tsx');
  for (const action of ["action: 'add-entry'", "action: 'update-entry'", "action: 'delete-entry'"]) assert.ok(statementUi.includes(action), action);
  assert.doesNotMatch(read('public/modules/phase1/phase1-finance.js'), /#tab-contas_banco|ensureBankSearch|renderBanks/);
});
