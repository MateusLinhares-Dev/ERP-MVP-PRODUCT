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

test('a tela não reescreve adiantamentos (data da compensação parcial, empresa do banco de terceiro): editar e excluir enviam o que está no servidor', () => {
  assert.doesNotMatch(core, /function adtCorrigeEmpresa\(/);
  assert.doesNotMatch(core, /_adtCorrigirDataCompensacaoParcial/);
  const render = core.slice(core.indexOf('function renderAdiantamentos(){'), core.indexOf('function renderAdiantamentos(){') + 400);
  assert.doesNotMatch(render, /saveDB\(\)/);
});

test('tempestade de gravações: um "apagar" já confirmado não é reenviado a cada salvamento (só volta se o registro reaparecer na nuvem)', () => {
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  const start = sync.indexOf('const _fbEnviadoOk = {};');
  const end = sync.indexOf('function _fbRegistrarBaseConfirmada(d){');
  const fim = sync.indexOf('\n  function _dividirEmLotes(', end);
  const ctx = { console, window: {}, _fbRejeitadoIgual: () => false };
  runInNewContext(sync.slice(start, fim) + ';this.filtrar=_fbFiltrarJaEnviado;this.marcar=_fbMarcarEnviado;this.base=_fbRegistrarBaseConfirmada;', ctx);
  let enviado = ctx.filtrar({ 'estoque/MEDALHA': null, _ts: 1 });
  assert.deepEqual(Object.keys(enviado).sort(), ['_ts', 'estoque/MEDALHA'], 'primeira vez o apagar vai');
  ctx.marcar(enviado);
  enviado = ctx.filtrar({ 'estoque/MEDALHA': null, _ts: 2 });
  assert.deepEqual(Object.keys(enviado), ['_ts'], 'depois de confirmado não vai de novo (antes ia em todo salvamento e acordava os outros computadores)');
  ctx.base({ estoque: { MEDALHA: { mat: 'MEDALHA', inicial: 1 } } });
  enviado = ctx.filtrar({ 'estoque/MEDALHA': null, _ts: 3 });
  assert.deepEqual(Object.keys(enviado).sort(), ['_ts', 'estoque/MEDALHA'], 'se o registro voltou na nuvem, o apagar é enviado de novo');
});

test('arredondamento de centavos não mexe em notinha nem adiantamento gravados pelo servidor (cada recarga pedia um novo salvamento)', () => {
  const fn = core.slice(core.indexOf('function _arredondarDinheiro2Casas(){'), core.indexOf("window['_arredondarDinheiro2Casas']"));
  assert.match(fn, /if\(!t \|\| t\._purchaseOperationId\) return;/);
  assert.doesNotMatch(fn, /ADT_POR_FORN/);
  const ctx = { TICKETS_DB: { T1: { _purchaseOperationId: 'op', itens: [{ total: 1223.6000000000001 }], totalKg: 176.42000000000002 }, T2: { itens: [{ total: 10.005 }] } }, _r2: (v) => Math.round((v + Number.EPSILON) * 100) / 100, saveDB: () => { ctx.salvou = true; }, console };
  runInNewContext(fn + ';_arredondarDinheiro2Casas();', ctx);
  assert.equal(ctx.TICKETS_DB.T1.itens[0].total, 1223.6000000000001);
  assert.equal(ctx.TICKETS_DB.T2.itens[0].total, 10.01);
  assert.equal(ctx.salvou, true);
});

test('registro apagado que reaparece na nuvem (outro computador regravou) volta a receber o apagar em qualquer recarga', () => {
  const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
  const start = sync.indexOf('const _fbEnviadoOk = {};');
  const fim = sync.indexOf('\n  function _dividirEmLotes(', sync.indexOf('function _fbRegistrarBaseConfirmada(d){'));
  const ctx = { console, window: {}, _fbRejeitadoIgual: () => false };
  runInNewContext(sync.slice(start, fim) + ';this.filtrar=_fbFiltrarJaEnviado;this.marcar=_fbMarcarEnviado;this.reabrir=_fbReabrirApagadosQueVoltaram;', ctx);
  ctx.marcar({ 'agendaEntregas/AG1': null, 'estoque/MEDALHA': null });
  ctx.reabrir({ agendaEntregas: { AG1: { id: 'AG1' } }, estoque: {} });
  const enviado = ctx.filtrar({ 'agendaEntregas/AG1': null, 'estoque/MEDALHA': null, _ts: 1 });
  assert.deepEqual(Object.keys(enviado).sort(), ['_ts', 'agendaEntregas/AG1']);
});
