import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = core.indexOf(from);
  const end = core.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `não encontrei ${from}`);
  return core.slice(start, end);
};

function cashFlow(year, sources) {
  const context = {};
  runInNewContext(slice('function _fluxoTotaisAno(ano, fontes){', 'function renderFluxo(){') + ';this.run=_fluxoTotaisAno;', context);
  return JSON.parse(JSON.stringify(context.run(year, sources)));
}

test('fluxo: pagamento parcial entra no mês em que o dinheiro saiu', () => {
  const totals = cashFlow(2026, {
    contasPagar: [
      {
        cat: 'Sucata',
        status: 'Pago',
        valor: 700,
        dataPgto: '05/11/2026',
        pagamentos: [
          { data: '20/10/2026', valor: 300, adt: 0 },
          { data: '05/11/2026', valor: 700, adt: 0 },
        ],
      },
      { cat: 'Energia', status: 'Pendente', valor: 600, pagamentos: [{ data: '12/11/2026', valor: 400, adt: 0 }] },
    ],
  });
  assert.equal(totals.sucata[9], 300);
  assert.equal(totals.sucata[10], 700);
  assert.equal(totals.outros[10], 400);
});

test('fluxo: parte paga com adiantamento não entra de novo como saída', () => {
  const totals = cashFlow(2026, {
    contasPagar: [
      { cat: 'Sucata', status: 'Pago', valor: 1000, dataPgto: '10/11/2026', pagamentos: [{ data: '10/11/2026', valor: 400, adt: 600 }] },
      { cat: 'Sucata', status: 'Pago', valor: 250, pagamentos: [{ data: '11/11/2026', valor: 0, adt: 250, obs: 'Coberto por adiantamento (Ficha) — marcado como pago' }] },
    ],
    adiantamentos: { F1: [{ cod: 'A1', data: '01/10/2026', valor: 850, status: 'Quitado', forma: 'PIX' }] },
  });
  assert.equal(totals.sucata[10], 400);
  assert.equal(totals.adiantamentos[9], 850);
  assert.equal(totals.adiantamentos[10], 0);
});

test('fluxo: compensação parcial do adiantamento fica no mês em que ele foi pago', () => {
  const totals = cashFlow(2026, {
    adiantamentos: {
      F1: [
        { cod: 'A1', data: '03/10/2026', valor: 700, valorOriginal: 1000, status: 'Pendente', forma: 'PIX' },
        { cod: 'A2', data: '08/11/2026', valor: 300, status: 'Quitado', adiantamentoOrigem: 'A1', origem: 'compensacao_cp' },
        { cod: 'A3', data: '04/10/2026', valor: 200, status: 'Pendente', forma: 'Dinheiro' },
        { cod: 'A4', data: '09/11/2026', valor: 50, status: 'Quitado', obs: 'Quitação parcial de A3 — compra 09/11/2026' },
        { cod: 'A5', data: '09/11/2026', valor: 90, status: 'Pendente', forma: 'Crédito' },
      ],
    },
  });
  assert.equal(totals.adiantamentos[9], 1250);
  assert.equal(totals.adiantamentos[10], 0);
});

test('fluxo: conta paga sem histórico usa a data de pagamento; outro ano não entra', () => {
  const totals = cashFlow(2026, {
    contasPagar: {
      a: { cat: 'Folha de pagamento', status: 'Pago', valor: 5000, dataPgto: '2026-11-05' },
      b: { cat: 'Folha de pagamento', status: 'Pago', valor: 9, dataPgto: '05/11/2025' },
      c: { cat: 'Folha', status: 'Pendente', valor: 77 },
    },
    contasReceber: [
      { status: 'Recebido', valor: 1500, dataReceb: '07/11/2026' },
      { status: 'Pendente', valor: 999, data: '07/11/2026' },
    ],
  });
  assert.equal(totals.folha[10], 5000);
  assert.equal(totals.folha.reduce((sum, value) => sum + value, 0), 5000);
  assert.equal(totals.vendas[10], 1500);
});

function undoContext({ payable, movements, tickets = {} }) {
  const removedCloud = [];
  const context = {
    Math, Number, Date, String, Array, Boolean,
    CONTAS_PAGAR: [payable],
    LANC_BANCO_DB: movements,
    TICKETS_DB: tickets,
    _syncLancBanco: { remover(index) { movements.splice(index, 1); } },
    window: { _fbRawDB: { ref: (path) => ({ remove: () => { removedCloud.push(path); return Promise.resolve(); } }) } },
    saveBancos() {}, renderBancos() {}, saveContasPagar() {}, saveDB() {}, renderContasPagar() {}, renderTickets() {}, renderFluxo() {}, renderDashboard() {}, registrarHistorico() {},
    console,
  };
  runInNewContext(
    slice('function _bancoRemoverMovimento(movId){', 'function excluirPagamentoCP(id,pIdx){') +
      slice('function _bancoMovimentoDoServidor(mov){', 'function _bloquearEdicaoMovimentoAdiantamento(movement){') +
      ';this.undo=_cpExcluirPagamento;',
    context,
  );
  return { context, removedCloud };
}

test('excluir pagamento de conta já paga deixa em aberto só o valor do pagamento excluído', () => {
  const payable = {
    id: 'CP1', ticket: 'T1', status: 'Pago', valor: 700, valorPago: 1000, dataPgto: '05/11/2026', movBancoIdCP: 'LB-PG-2-b',
    pagamentos: [
      { data: '20/10/2026', valor: 300, adt: 0, movBancoId: 'LB-PG-1-a' },
      { data: '05/11/2026', valor: 700, adt: 0, movBancoId: 'LB-PG-2-b' },
    ],
  };
  const movements = [
    { id: 'LB-PG-1-a', valor: 300, payableId: 'CP1' },
    { id: 'LB-PG-2-b', valor: 700, payableId: 'CP1' },
  ];
  const tickets = { T1: { saldoPagar: 0, status: 'Pago' } };
  const { context, removedCloud } = undoContext({ payable, movements, tickets });
  assert.equal(context.undo(payable, 0), '');
  assert.equal(payable.status, 'Pendente');
  assert.equal(payable.valor, 300);
  assert.equal(payable.valorPago, 700);
  assert.equal(payable.pagamentos.length, 1);
  assert.equal(payable.movBancoIdCP, 'LB-PG-2-b');
  assert.deepEqual(movements.map((m) => m.id), ['LB-PG-2-b']);
  assert.deepEqual(removedCloud, ['erp/lancBanco/LB-PG-1-a']);
  assert.equal(tickets.T1.saldoPagar, 300);
  assert.equal(tickets.T1.status, 'Parcial');
});

test('excluir pagamento parcial soma o valor de volta ao saldo; pagamento com adiantamento é recusado', () => {
  const payable = {
    id: 'CP2', status: 'Pendente', valor: 600, valorPago: 400,
    pagamentos: [{ data: '12/11/2026', valor: 400, adt: 0 }, { data: '13/11/2026', valor: 0, adt: 100 }],
  };
  const { context } = undoContext({ payable, movements: [] });
  assert.match(context.undo(payable, 1), /adiantamento/);
  assert.equal(context.undo(payable, 0), '');
  assert.equal(payable.valor, 1000);
  assert.equal(payable.valorPago, 0);
  assert.match(context.undo(payable, 5), /não encontrado/);
});
