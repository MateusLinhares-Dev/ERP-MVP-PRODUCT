import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreAdvances } from '../server/modules/payables/domain/advance-reversal.ts';

test('uso inteiro: volta a pendente, tira a marca da observação e o vínculo com a compra', () => {
  const ledger = [{ cod: 'A1', valor: 300, valorOriginal: 300, valorCompensado: 300, valorDisponivel: 0, status: 'Quitado', ticket: 'T1', obs: 'pix | Compensado em CP 10/11/2026' }];
  const { entries } = restoreAdvances(ledger, { data: '10/11/2026', adt: 300 }, 'T1');
  assert.deepEqual(entries, [{ cod: 'A1', valor: 300, valorOriginal: 300, valorCompensado: 0, valorDisponivel: 300, status: 'Pendente', ticket: '', obs: 'pix' }]);
  assert.equal(ledger[0].status, 'Quitado', 'não altera a lista recebida');
});

test('uso parcial: devolve o valor ao adiantamento de origem, apaga a parte dividida e solta o ticket de origem', () => {
  const ledger = [
    { cod: 'A2', valor: 700, valorOriginal: 1000, valorCompensado: 300, status: 'Pendente', ticket: '', ticketOrigem: 'T2' },
    { cod: 'S1', valor: 300, status: 'Quitado', ticket: 'T2', origem: 'compensacao_cp', adiantamentoOrigem: 'A2', data: '10/11/2026' },
    { cod: 'OUTRO', valor: 50, status: 'Pendente' },
  ];
  const { entries } = restoreAdvances(ledger, { data: '10/11/2026', adt: 300 }, 'T2');
  assert.deepEqual(entries.map((row) => [row.cod, row.valor, row.valorCompensado, row.status, row.ticket, 'ticketOrigem' in row]), [
    ['A2', 1000, 0, 'Pendente', '', false],
    ['OUTRO', 50, undefined, 'Pendente', undefined, false],
  ]);
});

test('registro exato do pagamento (adtUsos) tem prioridade sobre a busca pela data', () => {
  const ledger = [
    { cod: 'A3', valor: 200, valorCompensado: 200, status: 'Quitado', ticket: 'T3', obs: 'Compensado em CP 10/11/2026' },
    { cod: 'A4', valor: 100, valorCompensado: 100, status: 'Quitado', ticket: 'T3', obs: 'Compensado em CP 10/11/2026' },
  ];
  const { entries } = restoreAdvances(ledger, { data: '10/11/2026', adt: 100, adtUsos: [{ cod: 'A4', valor: 100 }] }, 'T3');
  assert.deepEqual(entries.map((row) => row.status), ['Quitado', 'Pendente']);
  assert.match(restoreAdvances(ledger, { data: '10/11/2026', adt: 100 }, 'T3').problem, /identificar com segurança/, 'sem registro, dois pagamentos no mesmo dia não batem');
});

test('recusa quando não acha, quando o valor não bate ou quando o adiantamento foi usado de novo', () => {
  assert.match(restoreAdvances([], { data: '10/11/2026', adt: 50 }, 'T4').problem, /identificar com segurança/);
  const reused = [
    { cod: 'A5', valor: 700, valorCompensado: 1000, status: 'Quitado', ticket: 'T9' },
    { cod: 'S2', valor: 300, status: 'Quitado', ticket: 'T5', origem: 'compensacao_cp', adiantamentoOrigem: 'A5', data: '10/11/2026' },
  ];
  assert.match(restoreAdvances(reused, { data: '10/11/2026', adt: 300 }, 'T5').problem, /usado de novo/);
  assert.deepEqual(restoreAdvances([{ cod: 'X' }], { adt: 0 }, 'T6').entries, [{ cod: 'X' }]);
});

test('tela: 🕒 permite excluir pagamento com adiantamento e atualiza os adiantamentos; exclusão de compra ignora banco gravado e estornos', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /Este pagamento usou adiantamento/);
  assert.match(core, /ADT_POR_FORN\[result\.fornCod\]=result\.advanceEntries/);
  assert.match(readFileSync(new URL('../web/modules/payables/ui/PaymentDialogs.tsx', import.meta.url), 'utf8'), /voltam para o adiantamento do fornecedor/);
  const remove = readFileSync(new URL('../server/modules/purchases/application/delete-purchase-order.ts', import.meta.url), 'utf8');
  assert.match(remove, /return Boolean\(payable\.dataPgto \|\| payable\.movBancoIdCP\);/);
  assert.match(remove, /operation\.kind === 'reversal' \? -1 : 1/);
  assert.doesNotMatch(remove, /hasTicketRef\(paymentOps/);
});
