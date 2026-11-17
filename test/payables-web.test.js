import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarMonth,
  dayChips,
  emptyFilter,
  filterPayables,
  formRequest,
  groupChoices,
  groupPayables,
  installmentPreview,
  payableKpis,
  payableRows,
  shiftMonth,
} from '../web/modules/payables/domain/payables.ts';

const today = '2026-11-14';
const raw = [
  { id: 'CP1', cred: 'CELESC', desc: 'Energia', cat: 'Energia', valor: 300, status: 'Pendente', venc: '20/11/2026', empresa: 'Manuela', tipoForn: 'despesa', bancoNome: 'Sicredi', _upd: 5 },
  { id: 'CP2', cred: 'CICLO', desc: 'Compra T10', valor: 80, status: 'Pendente', venc: '10/11/2026', tipoForn: 'compra', ticket: 'T10' },
  { id: 'CP3', cred: 'X', desc: 'Aluguel', valor: 900, valorPago: 600, adtCompensado: 300, status: 'Pago', venc: '05/11/2026', empresa: 'Gratus', pagamentos: [{ valor: 600 }, { valor: 0, adt: 300 }] },
  { id: 'G1', cred: 'BANCO', desc: 'Financ (1/3)', valor: 100, status: 'Pendente', venc: '14/11/2026', grupoId: 'g', totalParcelas: 3, empresa: 'Manuela' },
  { id: 'G2', cred: 'BANCO', desc: 'Financ (2/3)', valor: 100, status: 'Pendente', venc: '14/12/2026', grupoId: 'g', empresa: 'Manuela', pagamentos: [{ valor: 40 }] },
  { id: 'G3', cred: 'BANCO', desc: 'Financ (3/3)', valor: 100, status: 'Pendente', venc: '14/01/2027', grupoId: 'g', empresa: 'Manuela' },
  { cred: 'sem id', valor: 1 },
  null,
];
const context = { today, companyOf: (item) => String(item.empresa || ''), fromPurchase: (item) => Boolean(item.ticket) };
const rows = payableRows(raw, context);
const ids = (list) => list.map((row) => row.id);

test('linhas: só com id, ordem por vencimento, atrasada, parcial, paga com valor quitado, conta de compra', () => {
  assert.deepEqual(ids(rows), ['CP3', 'CP2', 'G1', 'CP1', 'G2', 'G3']);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.CP2.overdue, true);
  assert.equal(byId.CP2.fromPurchase, true);
  assert.equal(byId.CP2.kind, 'compra');
  assert.equal(byId.G2.partial, true);
  assert.equal(byId.CP3.paidAmount, 900);
  assert.equal(byId.CP3.overdue, false);
  assert.equal(byId.CP1.update, 5);
  assert.deepEqual(ids(payableRows(raw, { ...context, onlyPurchases: true })), ['CP2']);
});

test('filtros: tipo, mês, empresa, situação, valor, busca sem acento, período e dia', () => {
  const base = emptyFilter(today);
  const run = (patch) => ids(filterPayables(rows, { ...base, ...patch }));
  assert.deepEqual(run({}), ['CP2', 'G1', 'CP1']);
  assert.deepEqual(run({ kind: 'compra' }), ['CP2']);
  assert.deepEqual(run({ status: 'todas' }), ['CP3', 'CP2', 'G1', 'CP1']);
  assert.deepEqual(run({ status: 'quitados' }), ['CP3']);
  assert.deepEqual(run({ status: 'atrasadas', month: '' }), ['CP2']);
  assert.deepEqual(run({ company: 'Manuela', month: '' }), ['G1', 'CP1', 'G2', 'G3']);
  assert.deepEqual(run({ min: '150', month: '' }), ['CP1']);
  assert.deepEqual(run({ query: 'celesc energia' }), ['CP1']);
  assert.deepEqual(run({ month: '', from: '2026-11-15', to: '2026-12-31' }), ['CP1', 'G2']);
  assert.deepEqual(run({ day: '2026-11-14' }), ['G1']);
});

test('indicadores do mês, vencendo hoje e atrasadas; dias e calendário', () => {
  const kpis = payableKpis(rows, emptyFilter(today), today);
  assert.deepEqual([kpis.open, kpis.openCount, kpis.dueTodayCount, kpis.dueToday, kpis.overdueCount, kpis.paid], [480, 3, 1, 100, 1, 900]);
  assert.equal(payableKpis(rows, { ...emptyFilter(today), company: 'Gratus' }, today).openCount, 0);
  assert.deepEqual(dayChips(rows, emptyFilter(today), today).map((day) => [day.iso, day.today, day.overdue]), [['2026-11-10', false, true], ['2026-11-14', true, false], ['2026-11-20', false, false]]);
  const cells = calendarMonth(rows, '2026-11', today);
  assert.equal(cells.filter((cell) => cell === null).length, 0, 'novembro de 2026 começa num domingo');
  const day14 = cells.find((cell) => cell && cell.day === 14);
  assert.deepEqual([day14.count, day14.total, day14.today], [1, 100, true]);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('agrupa por dia e, em Despesas, por empresa na ordem da configuração', () => {
  const filtered = filterPayables(rows, { ...emptyFilter(today), month: '' });
  const plain = groupPayables(filtered, filtered, { byCompany: false, companies: [], today });
  assert.deepEqual(plain[0].days.map((day) => [day.due, day.rows.length, day.overdue, day.today]), [
    ['2026-11-10', 1, true, false],
    ['2026-11-14', 1, false, true],
    ['2026-11-20', 1, false, false],
    ['2026-12-14', 1, false, false],
    ['2027-01-14', 1, false, false],
  ]);
  const companies = groupPayables(filtered, filtered, { byCompany: true, companies: ['Manuela'], today });
  assert.deepEqual(companies.map((group) => [group.company, group.count]), [['Manuela', 4], ['Sem empresa', 1]]);
});

test('formulário: lançar avulsa ou parcelada, editar sem reenviar valor de conta paga', () => {
  const form = { description: ' Internet ', kind: 'despesa', supplier: 'VIVO', company: 'Manuela', category: '', bankCode: 'B1', amount: '199,90', due: '2026-11-25', notes: '', installments: false, count: '3', day: '31', firstMonth: '2027-01' };
  assert.deepEqual(formRequest(form, null).payload, { action: 'create', payable: { desc: 'Internet', cred: 'VIVO', cat: 'Outros', empresa: 'Manuela', bancoCod: 'B1', obs: '', valor: 199.9, tipoForn: 'despesa', venc: '2026-11-25' } });
  const plan = formRequest({ ...form, installments: true }, null).payload;
  assert.deepEqual(plan.installments, { count: 3, day: 31, firstMonth: '2027-01' });
  assert.equal('venc' in plan.payable, false);
  assert.equal(installmentPreview({ ...form, installments: true }), '3 parcela(s) — 1ª em 31/01/2027 · última em 31/03/2027');
  assert.equal(formRequest({ ...form, company: '' }, null).message, 'Selecione a empresa responsável por esta conta.');
  assert.equal(formRequest({ ...form, amount: '0' }, null).message, 'Informe um valor maior que zero.');
  assert.equal(formRequest({ ...form, installments: true, count: '0' }, null).ok, false);
  const paid = rows.find((row) => row.id === 'CP3');
  const update = formRequest({ ...form, amount: '1' }, paid).payload;
  assert.equal(update.action, 'update');
  assert.equal('valor' in update.payable || 'tipoForn' in update.payable, false);
  assert.equal(formRequest({ ...form }, rows.find((row) => row.id === 'CP1')).payload.expectedUpdate, 5);
});

test('excluir parcelas do grupo: só esta, esta + pendentes sem pagamento, todas sem pagamento', () => {
  const g1 = rows.find((row) => row.id === 'G1');
  assert.deepEqual(groupChoices(rows, g1), { size: 3, pending: ['G1', 'G3'], all: ['G1', 'G3'] });
  assert.equal(groupChoices(rows, rows.find((row) => row.id === 'CP1')), null);
});
