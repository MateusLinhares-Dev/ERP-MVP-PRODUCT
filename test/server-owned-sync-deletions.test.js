import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');

function load(storage, clock) {
  const start = core.indexOf('function _criarSincroniaPorChave(nome, lista, prefixoId){');
  const end = core.indexOf('\n}\n', start) + 3;
  const context = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    window: {}, console, JSON, Set, Map, Object, Array, String, Number, Math, Boolean,
    Date: { now: () => clock.now },
    _idsDeArrayOuObjeto: (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : []),
  };
  runInNewContext(core.slice(start, end) + ';this.make=_criarSincroniaPorChave;', context);
  return context.make;
}

test('venda que ainda existe no servidor aparece em todos os computadores, mesmo se uma versão antiga a escondeu só neste navegador', () => {
  const storage = new Map([['mm_vendas_deletados', JSON.stringify(['VD-4', 'VD-5'])]]);
  const clock = { now: 1_000_000 };
  const make = load(storage, clock);
  const vendas = [];
  const sync = make('vendas', vendas, 'VD');
  sync.carregarDeRemoto({ 'VD-4': { id: 'VD-4', nf: 'V0004' }, 'VD-5': { id: 'VD-5', nf: 'V0005' }, 'VD-9': { id: 'VD-9', nf: 'V0009' } }, true);
  assert.deepEqual(vendas.map((v) => v.nf).sort(), ['V0004', 'V0005', 'V0009']);
  sync.aplicarTombstonesRemotos({ 'VD-9': true });
  assert.deepEqual(vendas.map((v) => v.nf).sort(), ['V0004', 'V0005'], 'exclusão confirmada na nuvem esconde');
  sync.carregarDeRemoto({ 'VD-4': { id: 'VD-4', nf: 'V0004' }, 'VD-5': { id: 'VD-5', nf: 'V0005' }, 'VD-9': { id: 'VD-9', nf: 'V0009' } }, true);
  assert.deepEqual(vendas.map((v) => v.nf).sort(), ['V0004', 'V0005']);
});

test('venda excluída agora não pisca de volta com um retrato antigo da nuvem; depois de 2 minutos vale o que o servidor tem', () => {
  const storage = new Map();
  const clock = { now: 1_000_000 };
  const make = load(storage, clock);
  const vendas = [];
  const sync = make('vendas', vendas, 'VD');
  const remoto = { 'VD-4': { id: 'VD-4', nf: 'V0004' }, 'VD-5': { id: 'VD-5', nf: 'V0005' } };
  sync.carregarDeRemoto(remoto, true);
  sync.remover(vendas.findIndex((v) => v.id === 'VD-4'));
  sync.carregarDeRemoto(remoto, true);
  assert.deepEqual(vendas.map((v) => v.nf), ['V0005']);
  clock.now += 121_000;
  sync.carregarDeRemoto(remoto, true);
  assert.deepEqual(vendas.map((v) => v.nf).sort(), ['V0004', 'V0005'], 'se o servidor não excluiu, a venda continua visível');
  sync.carregarDeRemoto({ 'VD-5': { id: 'VD-5', nf: 'V0005' } }, true);
  assert.deepEqual(vendas.map((v) => v.nf), ['V0005']);
});

test('contas a receber, extrato, bancos, clientes e fornecedores seguem a mesma regra; listas gravadas pelo navegador continuam com a exclusão local', () => {
  for (const nome of ['contasReceber', 'lancBanco', 'bancos', 'clientes', 'fornecedores']) {
    const storage = new Map([['mm_' + nome + '_deletados', JSON.stringify(['X1'])]]);
    const make = load(storage, { now: 5 });
    const lista = [];
    make(nome, lista, 'ZZ').carregarDeRemoto({ X1: { id: 'X1', v: 1 } }, true);
    assert.equal(lista.length, 1, nome);
  }
  const storage = new Map([['mm_combustivel_deletados', JSON.stringify(['X1'])]]);
  const lista = [];
  load(storage, { now: 5 })('combustivel', lista, 'CB').carregarDeRemoto({ X1: { id: 'X1', v: 1 } }, true);
  assert.equal(lista.length, 0);
});
