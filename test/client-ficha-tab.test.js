import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const pick = (from, to) => core.slice(core.indexOf(from), core.indexOf(to, core.indexOf(from)));

test('aba Ficha do Cliente soma lançamentos manuais e saldo anterior e não conta cheque devolvido (igual à ficha da aba Clientes)', () => {
  const code = pick('function _fcData2Ord(d){', 'function _fcClientesAtivos(){') + pick('function _fcMovimentos(cli){', 'function fcSetAba(a){');
  const ctx = {
    esc: (v) => String(v ?? ''),
    _fcMesmoNome: (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase(),
    VENDAS_DB: [{ cliente: 'ANDERSON', data: '10/11/2026', total: 1000, itens: [{ mat: 'FERRO', qt: 100 }] }],
    ADT_CLI: { ANDERSON: [{ data: '2026-11-11', valor: 300, forma: 'PIX' }] },
    CHEQUES_CLI: { ANDERSON: [{ num: '11', valor: 200, data: '2026-11-12', status: 'Pendente' }, { num: '12', valor: 100, data: '2026-11-12', status: 'Devolvido' }] },
    CHQ_CTRL: {},
    CONTAS_RECEBER: [],
    FC_LANC: { Anderson: [{ data: '2026-11-13', tipo: 'entrega', debito: 500, peso: 50 }, { data: '2026-11-14', tipo: 'deposito', credito: 50 }, { data: '2026-11-15', tipo: 'pendente', valorPend: 999 }] },
    FC_SALDO_INI: { ANDERSON: { valor: 100, data: '01/11/2026' } },
  };
  runInNewContext(code + ';this.totais=_fcTotais;', ctx);
  const t = ctx.totais('ANDERSON');
  assert.equal(t.deb, 1500);
  assert.equal(t.cred, 650);
  assert.equal(t.saldo, 850);
  assert.equal(t.kg, 150);
  assert.equal(t.mov[0].tipo, 'ini');
  ctx.FC_SALDO_INI.ANDERSON.valor = -40;
  assert.equal(ctx.totais('ANDERSON').saldo, 990, 'saldo anterior negativo é dívida do cliente');
});
