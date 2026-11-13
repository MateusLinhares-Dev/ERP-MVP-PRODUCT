import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_FILTER,
  chequeDifference,
  filterReceivables,
  formRequest,
  receivableKpis,
  receivableRows,
  receiveRequest,
  totalOf,
} from '../web/modules/receivables/domain/receivables.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const rows = receivableRows(
  [
    { id: 'CR1', cli: 'TUPY', nf: '55', valor: 300, status: 'Pendente', venc: '20/11/2026', obs: 'sucata de cobre' },
    { id: 'CR2', cli: 'ÁGUIA SUCATAS', valor: '150.255', status: 'Pendente', venc: '2026-11-01', vendaId: 'VD-1', movBancoId: '' },
    { id: 'CR3', cli: 'TUPY', valor: 99.9, status: 'Recebido', venc: '01/10/2026', dataReceb: '02/10/2026', forma: 'PIX', banco: '—', movBancoId: 'LB-CR-1', chequesRecebimento: ['850', ''], atualizadoEm: 7, fiscalPartyId: 'FP1' },
    { cli: 'SEM ID', valor: 10 },
    null,
  ],
  '2026-11-13',
);

test('linhas de Contas a Receber: só registros com id, valor em centavos, situação e vínculos', () => {
  assert.deepEqual(rows.map((row) => row.id), ['CR3', 'CR2', 'CR1']);
  const [received, late, open] = rows;
  assert.equal(late.amount, 150.26);
  assert.equal(late.overdue, true);
  assert.equal(late.saleId, 'VD-1');
  assert.equal(late.bankLinked, false);
  assert.equal(open.overdue, false);
  assert.equal(received.overdue, false, 'conta recebida não fica atrasada');
  assert.equal(received.bank, '', 'traço antigo vira vazio');
  assert.deepEqual(received.cheques, ['850']);
  assert.equal(received.update, 7);
  assert.equal(received.fiscal, true);
  assert.equal(received.receivedOn, '2026-10-02');
});

test('indicadores e filtros: aberto, atrasado, recebido, busca sem acento e faixa de vencimento', () => {
  assert.deepEqual(receivableKpis(rows), { open: 450.26, openCount: 2, overdue: 150.26, overdueCount: 1, received: 99.9, receivedCount: 1 });
  const ids = (filter) => filterReceivables(rows, { ...EMPTY_FILTER, ...filter }).map((row) => row.id);
  assert.deepEqual(ids({}), ['CR2', 'CR1']);
  assert.deepEqual(ids({ status: 'atrasados' }), ['CR2']);
  assert.deepEqual(ids({ status: 'recebidos' }), ['CR3']);
  assert.deepEqual(ids({ status: 'todos', query: 'aguia' }), ['CR2']);
  assert.deepEqual(ids({ status: 'todos', query: 'cobre 55' }), ['CR1']);
  assert.deepEqual(ids({ status: 'todos', from: '2026-11-01', to: '2026-11-19' }), ['CR2']);
  assert.equal(totalOf(rows), 550.16);
});

test('formulário: lançar manda tudo; venda e conta recebida não reenviam valor nem cliente que não podem mudar', () => {
  const form = { client: '  tupy  ltda ', number: ' 77 ', amount: '1.234,50', due: '2026-12-05', notes: ' x ' };
  assert.deepEqual(formRequest(form, null), {
    ok: true,
    payload: { action: 'create', receivable: { nf: '77', venc: '2026-12-05', obs: 'x', cli: 'tupy ltda', valor: 1234.5 } },
  });
  assert.equal(formRequest({ ...form, client: ' ' }, null).message, 'Informe o cliente.');
  assert.equal(formRequest({ ...form, amount: '0' }, null).message, 'Informe um valor maior que zero.');
  assert.equal(formRequest({ ...form, due: '' }, null).message, 'Informe o vencimento.');
  const [received, fromSale, open] = rows;
  const sale = formRequest({ ...form, amount: '' }, fromSale);
  assert.equal(sale.ok, true);
  assert.equal('cli' in sale.payload.receivable || 'valor' in sale.payload.receivable, false);
  const paid = formRequest({ ...form, amount: '99,9' }, received).payload;
  assert.equal(paid.action, 'update');
  assert.equal(paid.expectedUpdate, 7);
  assert.equal('valor' in paid.receivable, false);
  assert.equal(formRequest({ ...form, amount: '310' }, open).payload.receivable.valor, 310);
});

test('baixa: banco ou cheques (cheque zera a conta bancária), confere a soma dos cheques', () => {
  const [, , open] = rows;
  const base = { date: '2026-11-13', bank: 'B1', method: 'PIX', notes: ' ok ', cheques: [] };
  assert.deepEqual(receiveRequest(base, open).payload, { action: 'receive', id: 'CR1', date: '2026-11-13', bank: 'B1', method: 'PIX', notes: 'ok', cheques: [] });
  assert.equal(receiveRequest({ ...base, date: '' }, open).message, 'Informe a data do recebimento.');
  const cheques = [{ num: ' 850 ', banco: 'Itaú', valor: '200', bomPara: '' }, { num: '851', banco: '', valor: '100,5', bomPara: '2026-12-01' }];
  const payload = receiveRequest({ ...base, cheques }, open).payload;
  assert.equal(payload.bank, '');
  assert.equal(payload.method, 'Cheque');
  assert.deepEqual(payload.cheques.map((cheque) => [cheque.num, cheque.valor]), [['850', 200], ['851', 100.5]]);
  assert.deepEqual(chequeDifference(cheques, open.amount), { total: 300.5, difference: 0.5 });
  assert.equal(receiveRequest({ ...base, cheques: [{ ...cheques[0], valor: '' }] }, open).message, 'Preencha número e valor do cheque 1.');
});

test('tela antiga de Contas a Receber saiu; a ilha React monta na aba e grava pela API', () => {
  const core = read('public/legacy/app-core.js');
  assert.match(core, /function renderContasReceber\(\)\{\}/);
  for (const name of ['salvarContaReceber', 'salvarEditContaReceber', 'confirmarReceberCR', 'crAddChequeRow', 'popularCrCliList', 'toggleNovoCrCli', 'salvarNovoCrCliInline'])
    assert.doesNotMatch(core, new RegExp('function ' + name + '\\('), name);
  assert.doesNotMatch(core, /conta_receber:`/);
  assert.match(core, /window\.erpReceivablesList=function\(\)\{ return CONTAS_RECEBER; \};/);
  assert.match(core, /Promise\.resolve\(excluirContaReceber\(idx\)\)/);
  const html = read('public/index.template.html');
  assert.match(html, /<div id="contas-receber-app">/);
  assert.doesNotMatch(html, /id="kpi-cr-aberto-val"|id="tb-contas-receber"/);
  assert.doesNotMatch(read('public/modules/phase3/phase3-homologation.js'), /decorateReceivables|findReceivableForRow/);
  assert.match(read('web/erp/islands.tsx'), /installReceivables\(\);/);
  const island = read('web/erp/receivables.tsx');
  for (const name of ['renderContasReceber', 'erpReceivablesOpen', 'editContaReceber', 'receberContaRapido', 'excluirContaReceber', 'estornarContaReceber'])
    assert.match(island, new RegExp(name + ':'), name);
  assert.match(read('web/modules/receivables/ui/actions.ts'), /action: 'delete'[\s\S]*action: 'reopen'/);
});
