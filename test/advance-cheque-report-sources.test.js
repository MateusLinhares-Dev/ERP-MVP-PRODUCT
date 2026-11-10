import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdvance, listAdvanceCheques } from '../server/modules/advances/application/advances.ts';

const who = { uid: 'op', erpUser: 'Elaine', erpAccess: true, canAdvances: true };

function memoryDb(seed) {
  const state = structuredClone(seed);
  const get = (path) => path.split('/').filter(Boolean).reduce((value, key) => value?.[key], state);
  const assign = (path, value) => {
    const parts = path.split('/').filter(Boolean);
    const last = parts.pop();
    let parent = state;
    for (const key of parts) parent = parent[key] ??= {};
    if (value === null) delete parent[last];
    else parent[last] = structuredClone(value);
  };
  return {
    state,
    ref(path) {
      return {
        async get() {
          return { val: () => structuredClone(get(path) ?? null), exists: () => get(path) != null };
        },
        async transaction(fn) {
          const old = structuredClone(get(path) ?? null);
          const next = fn(old);
          if (next === undefined) return { committed: false, snapshot: { val: () => old } };
          assign(path, next);
          return { committed: true, snapshot: { val: () => structuredClone(next) } };
        },
        async update(entries) {
          for (const [key, value] of Object.entries(entries)) assign(path + '/' + key, value);
        },
      };
    },
  };
}

const base = () => ({
  erp: {
    bancos: { one: { cod: 'B1', banco: 'Conta' } },
    fornecedores: { a: { cod: 'F1', nome: 'FORNECEDOR TESTE 1' }, b: { cod: 'F2', nome: 'FELIPE AF' } },
    adiantamentos: { F1: [] },
  },
});

test('adiantamento em cheque criado pela tela aparece no relatório (próprio e de terceiro)', async () => {
  const db = memoryDb(base());
  await createAdvance(
    who,
    { operationId: 'a0d00000-1111-4111-8111-111111111111', fornCod: 'F1', data: '2026-10-22', valor: 74850, forma: 'Cheque',
      bancoCod: '', empresa: 'Manuela Metais', ticket: '', obs: '', cheques: [{ b: 'Sicredi', n: '000451', v: 74850, d: '2026-10-22', cli: '' }] },
    { db },
  );
  await createAdvance(
    who,
    { operationId: 'a0d00000-2222-4222-8222-222222222222', fornCod: 'F1', data: '2026-11-05', valor: 3000, forma: 'Cheque de Terceiro',
      bancoCod: '', empresa: '', ticket: '', obs: '', cheques: [{ b: 'BB', n: '3126', v: 3000, d: '2026-11-05', cli: 'ALUMIL ESQUADRIAS' }] },
    { db },
  );
  const { cheques } = await listAdvanceCheques(who, { db });
  assert.deepEqual(
    cheques.map((row) => [row.numero, row.cliente, row.empresa, row.data, row.valor, row.situacao]),
    [
      ['000451', 'FORNECEDOR TESTE 1', 'Manuela Metais', '22/10/2026', 74850, 'A compensar'],
      ['3126', 'FORNECEDOR TESTE 1', 'ALUMIL ESQUADRIAS', '05/11/2026', 3000, 'A compensar'],
    ],
  );
});

test('cheques do cadastro antigo do fornecedor (finalidade Adiantamento) entram no relatório', async () => {
  const seed = base();
  seed.erp.cheques = {
    F1: [
      { id: 'CHQ1', num: '1001', banco: 'Sicredi', valor: 5000, bomPara: '10/11/2026', finalidade: 'Adiantamento', empresa: 'Manuela Metais', status: 'Pendente' },
      { id: 'CHQ2', num: '1002', banco: 'Sicredi', valor: 900, bomPara: '11/11/2026', finalidade: 'Pagamento', status: 'Pendente' },
      { id: 'CHQ3', num: '1003', banco: 'Sicredi', valor: 700, bomPara: '01/11/2026', status: 'Quitado', dataCompensacao: '03/11/2026' },
    ],
    F2: { 0: { id: 'CHQ4', num: '2001', valor: 1200, bomPara: '09/11/2026', finalidade: 'Adiantamento', status: 'Devolvido' } },
    F9: [{ id: 'CHQ9', num: '9001', valor: 100, bomPara: '09/11/2026', finalidade: 'Adiantamento' }],
  };
  seed.erp.chequesPorFornDeleted = ['F9'];
  const { cheques } = await listAdvanceCheques(who, { db: memoryDb(seed) });
  assert.deepEqual(
    cheques.map((row) => [row.numero, row.cliente, row.valor, row.situacao, row.origem]),
    [
      ['1001', 'FORNECEDOR TESTE 1', 5000, 'A compensar', 'Cheque cadastrado no fornecedor'],
      ['1003', 'FORNECEDOR TESTE 1', 700, 'Compensado', 'Cheque cadastrado no fornecedor'],
      ['2001', 'FELIPE AF', 1200, 'Devolvido', 'Cheque cadastrado no fornecedor'],
    ],
    'cheque de pagamento e fornecedor excluído ficam de fora',
  );
});

test('adiantamento em cheque sem cheque cadastrado aparece uma vez, com o valor original e sem duplicar as partes', async () => {
  const seed = base();
  seed.erp.adiantamentos = {
    F1: [
      { cod: 'ADT100001', data: '20/10/2026', valor: 25150, forma: 'Cheque', status: 'Pendente', bancoNome: 'Não informado' },
      { cod: 'ADT789702', data: '22/10/2026', valor: 74850, forma: 'Cheque', status: 'Quitado', ticket: 'T827747',
        obs: 'Quitação parcial de ADT100001 — compra 22/10/2026' },
      { cod: 'ADT200001', data: '01/11/2026', valor: 0, valorOriginal: 8000, forma: 'Cheque', status: 'Quitado' },
      { cod: 'ADTSERVER1', data: '02/11/2026', valor: 500, forma: 'Cheque', status: 'Pendente', chequeIds: ['CC1'] },
      { cod: 'ADTCP1', data: '03/11/2026', valor: 300, forma: 'Cheque', status: 'Quitado', adiantamentoOrigem: 'ADTSERVER1', origem: 'compensacao_cp' },
      { cod: 'ADTPIX', data: '03/11/2026', valor: 300, forma: 'PIX', status: 'Pendente' },
    ],
  };
  const { cheques } = await listAdvanceCheques(who, { db: memoryDb(seed) });
  assert.deepEqual(
    cheques.map((row) => [row.adiantamento, row.numero, row.valor, row.cliente]),
    [
      ['ADT100001', '', 100000, 'FORNECEDOR TESTE 1'],
      ['ADT200001', '', 8000, 'FORNECEDOR TESTE 1'],
    ],
    'a parte usada (ADT789702) soma no original; o cheque com cadastro (ADTSERVER1) já vem do controle de cheques',
  );
});

test('tela do relatório mostra "não informado" quando o cheque não tem número', async () => {
  const report = await import('../web/modules/cheque-report/domain/cheque-report.ts');
  const rows = report.usableCheques([
    { numero: '', cliente: 'FORNECEDOR TESTE 1', empresa: '', data: '22/10/2026', valor: 100000 },
    { numero: '1', cliente: '', valor: 10 },
    { numero: '2', cliente: 'X', valor: 0 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(report.chequeNumber(rows[0]), 'não informado');
  assert.match(report.chequesCsv(rows), /"não informado"/);
  assert.match(report.chequesPrintHtml(rows), /<td>não informado<\/td>/);
  assert.deepEqual(report.chequesSummary(rows), { count: 1, total: 100000 });
});
