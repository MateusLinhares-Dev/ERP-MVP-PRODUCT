import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  amountField,
  checkPayment,
  checkReceipt,
  flowTotal,
  openBalance,
  paymentFingerprint,
  repasseList,
  repasseSummary,
} from '../web/modules/supplier-repasses/domain/repasses.ts';

test('repasses: lista do servidor vira registros tipados; bancos sem código são ignorados', () => {
  const list = repasseList({
    records: [{ id: 'R1', operationId: 'op', data: '2026-11-10', valor: '1000', valorPago: 400, saldo: 600.004, status: 'Parcial', versao: 2,
      pagamentos: [{ id: 'P1', data: '2026-11-11', valor: 400, bancoNome: 'Sicredi', comprovante: 'TX1' }] }, null],
    banks: [{ cod: 'B1', banco: 'Sicredi' }, { cod: '', banco: 'Sem código' }],
    totalEmAberto: 600,
  });
  assert.equal(list.records.length, 1);
  assert.equal(list.records[0].valor, 1000);
  assert.equal(list.records[0].saldo, 600);
  assert.equal(list.records[0].pagamentos[0].comprovante, 'TX1');
  assert.deepEqual(list.banks, [{ cod: 'B1', banco: 'Sicredi' }]);
  assert.equal(openBalance([...list.records, { ...list.records[0], id: 'R2', saldo: 0.1 }]), 600.1);
  assert.deepEqual(repasseList(null), { records: [], banks: [], totalEmAberto: 0 });
});

test('repasses: resumo alimenta o fluxo de caixa por mês', () => {
  const summary = repasseSummary({ totalEmAberto: 600, rows: [{ fornCod: 'F1', nome: 'CICLO', data: '2026-11-10', saldo: 600 }],
    months: { '2026-11': { entradas: 1000, saidas: 400 } } });
  assert.equal(flowTotal(summary, 11, 2026, 'entradas'), 1000);
  assert.equal(flowTotal(summary, 11, 2026, 'saidas'), 400);
  assert.equal(flowTotal(summary, 10, 2026, 'saidas'), 0);
  assert.equal(flowTotal(null, 11, 2026, 'saidas'), 0);
});

test('repasses: valores aceitam formato brasileiro, recusam centavos quebrados e PIX acima do saldo', () => {
  assert.deepEqual(checkReceipt('11.000,50'), { ok: true, value: 11000.5 });
  assert.equal(checkReceipt('0').ok, false);
  assert.equal(checkReceipt('10,005').ok, false);
  assert.equal(checkReceipt('abc').ok, false);
  assert.deepEqual(checkPayment('600,00', 600), { ok: true, value: 600 });
  const over = checkPayment('600,01', 600);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.message, /máximo R\$\s?600,00/);
  assert.equal(amountField(1234.5), '1.234,50');
});

test('repasses: impressão digital do PIX muda com a versão do recebimento', () => {
  const record = { id: 'R1', versao: 1 };
  assert.notEqual(paymentFingerprint('F1', record, '2026-11-11', 10, 'B1', ''), paymentFingerprint('F1', { ...record, versao: 2 }, '2026-11-11', 10, 'B1', ''));
});

test('repasses: tela antiga removida; a ilha React expõe a mesma interface para o fluxo de caixa', () => {
  assert.equal(existsSync(new URL('../public/modules/finance/supplier-cash-repasses.js', import.meta.url)), false);
  const boot = readFileSync(new URL('../public/app/bootstrap.js', import.meta.url), 'utf8');
  assert.doesNotMatch(boot, /supplier-cash-repasses\.js/);
  assert.match(boot, /supplier-cash-repasses\.css/);
  const island = readFileSync(new URL('../web/erp/supplier-repasses.tsx', import.meta.url), 'utf8');
  assert.match(island, /SupplierCashRepasse/);
  assert.match(island, /erp:supplier-ficha-rendered/);
  assert.match(island, /erpBankMovementAdded/);
});
