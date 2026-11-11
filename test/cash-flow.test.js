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

test('sincronização: mesmo registro em duas chaves não some ao limpar duplicados', () => {
  const start = core.indexOf('function _criarSincroniaPorChave(nome, lista, prefixoId){');
  const end = core.indexOf('\n}\n', start) + 3;
  const storage = new Map();
  const context = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    window: {}, console, JSON, Set, Map, Object, Array, String, Number, Math, Date, Boolean,
    _idsDeArrayOuObjeto: (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []),
  };
  runInNewContext(core.slice(start, end) + ';this.make=_criarSincroniaPorChave;', context);
  const lista = [];
  const sync = context.make('fornecedores', lista, 'FR');
  sync.carregarDeRemoto({ f1: { cod: 'F1', nome: 'JOAO' }, FRX1: null }, true);
  const id = lista[0].id;
  sync.carregarDeRemoto({ f1: { cod: 'F1', nome: 'JOAO' }, [id]: { cod: 'F1', nome: 'JOAO', id } }, true);
  assert.equal(lista.length, 2);
  assert.equal(sync.limparDuplicatasExatas(), true);
  assert.equal(lista.length, 1);
  assert.equal(sync.deletedSet.has(id), false);
  sync.carregarDeRemoto({ f1: { cod: 'F1', nome: 'JOAO' }, [id]: { cod: 'F1', nome: 'JOAO', id } }, true);
  assert.ok(lista.length >= 1, 'o fornecedor continua na lista depois de recarregar');

  const outra = [];
  const vendas = context.make('vendas', outra, 'VD');
  vendas.carregarDeRemoto({ A: { id: 'A', v: 1 }, B: { id: 'B', v: 1 } }, true);
  vendas.limparDuplicatasExatas();
  assert.equal(outra.length, 1);
  assert.equal(vendas.deletedSet.has('B'), true, 'duplicata com outro id continua sendo marcada como excluída');
});
