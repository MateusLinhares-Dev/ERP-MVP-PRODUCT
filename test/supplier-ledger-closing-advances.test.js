import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const start = core.indexOf('function _ffEntryAmount(entry){');
const end = core.indexOf('function _cpAjustarCompraAntiga(t, extra){', start);

function ledger(tickets = []) {
  assert.ok(start >= 0 && end > start);
  const context = {
    _r2: (x) => { const n = Number(x); return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0; },
    _ticketsDeCompra: () => tickets,
  };
  runInNewContext(core.slice(start, end) + ';this.uses=_ffClosingAdvanceUses;this.split=_ffAdvanceClosingSplit;this.amount=_ffEntryAmount;', context);
  return context;
}

const total = (parts, split) =>
  Math.round((parts.concat(split.slices).reduce((sum, part) => sum + part.valor, 0) + split.rest) * 100) / 100;

test('ficha: parte do adiantamento usada no fechamento vira linha própria e o saldo fecha com o valor pago', () => {
  const { uses, split } = ledger([
    { ticket: 'T1421', dataCompra: '2026-11-26', reciboFinanceiro: { adiantamentos: [{ cod: 'A1', valorAplicado: 32040.2 }] } },
    { ticket: 'T999', reciboFinanceiro: { adiantamentos: [{ cod: 'A1', valorAplicado: 0 }] } },
  ]);
  const advance = { cod: 'A1', valor: 14090.78, valorOriginal: 90000, status: 'Pendente', forma: 'PIX' };
  const parts = [{ valor: 30653.18 }, { valor: 13215.84 }];
  const result = split(advance, parts, uses().A1);
  assert.equal(result.rest, 14090.78);
  assert.equal(result.slices.length, 1);
  assert.equal(result.slices[0].ticket, 'T1421');
  assert.equal(result.slices[0].valor, 32040.2);
  assert.equal(result.slices[0].data, '2026-11-26');
  assert.equal(result.slices[0].fechamento, true);
  assert.equal(total(parts, result), 90000);
});

test('ficha: adiantamento que terminou no fechamento mostra o último pedaço na própria linha', () => {
  const { split } = ledger();
  const advance = { cod: 'B1', valor: 7775.07, valorOriginal: 7775.07, status: 'Quitado', ticket: 'T937' };
  const parts = [{ valor: 2002.91 }];
  const result = split(advance, parts, [{ ticket: 'T937', valor: 5772.16, data: '' }]);
  assert.equal(result.slices.length, 0);
  assert.equal(result.rest, 5772.16);
  assert.equal(total(parts, result), 7775.07);

  const whole = split({ cod: 'C1', valor: 8321, valorOriginal: 8321, status: 'Quitado', ticket: 'T1117' }, [], [{ ticket: 'T1117', valor: 8321 }]);
  assert.equal(whole.slices.length, 0);
  assert.equal(whole.rest, 8321);
});

test('ficha: sem uso no fechamento ou com dado que não fecha, a linha continua com o valor gravado', () => {
  const { split, amount } = ledger();
  const plain = split({ cod: 'D1', valor: 500, valorOriginal: 1000, status: 'Pendente' }, [{ valor: 500 }], []);
  assert.deepEqual({ rest: plain.rest, slices: plain.slices.length }, { rest: 500, slices: 0 });
  const broken = split({ cod: 'D2', valor: 300, valorOriginal: 400, status: 'Pendente' }, [{ valor: 200 }], [{ ticket: 'T1', valor: 500 }]);
  assert.deepEqual({ rest: broken.rest, slices: broken.slices.length }, { rest: 300, slices: 0 });
  assert.equal(amount({ amount: 0, raw: { valor: 99 } }), 0);
  assert.equal(amount({ amount: null, raw: { valor: 99 } }), 99);
});

test('ficha: linha de uso no fechamento não tem editar nem excluir e o total pago usa o valor da linha', () => {
  assert.match(core, /e\.raw\.origem==='devolucao'\|\|e\.raw\.fechamento\)\)\)\{ editBtn=''; delKey=''; \}/);
  assert.match(core, /\}\)\.reduce\(function\(s,e\)\{return s\+_ffEntryAmount\(e\);\},0\);/);
  assert.match(core, /closingUses:_ffClosingAdvanceUses\(\)/);
});
