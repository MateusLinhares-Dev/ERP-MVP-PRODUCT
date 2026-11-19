import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  autoDebit,
  bankSummaries,
  checkNumber,
  csvOf,
  depositLines,
  destinationsOf,
  gapLabel,
  matchDestinations,
  normalizeCheques,
  parseAmount,
  pendingForDeposit,
  pickDestination,
  reviewOf,
  sequences,
  totalsOf,
  visibleCheques,
} from '../web/modules/cheque-control/domain/control.ts';
import { batchPayload, deleteBlock, formFor, reopenBlock, savePayload } from '../web/modules/cheque-control/domain/forms.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const banks = [
  { name: 'Sicredi', slug: 'SIC', code: 'BC-001', color: '#c0392b', order: 1 },
  { name: 'Itaú', slug: 'ITA', code: 'BC-002', color: '#1565c0', order: 2 },
];
const raw = {
  C1: { id: 'C1', n: '501', b: 'Sicredi', v: 120.5, c: 'Cliente Ágil', s: 'A', d: '10/11/2026' },
  C2: { id: 'C2', n: '505', b: 'Sicredi', v: 999, c: 'JOAO', s: 'C', cd: '12/11/2026', movBancoId: 'LB-1' },
  C3: { id: 'C3', n: '10', b: 'Itaú', v: 50, c: 'X', s: 'X' },
  C4: { id: 'C4', n: '502', b: 'Sicredi', v: 5, c: 'Y', s: 'A', dc: true },
  ADT1: { id: 'ADT1', n: '777', b: 'Sicredi', v: 300, c: 'CICLO', s: 'A', dc: true, advanceCode: 'A1', fornCod: 'F1', tipoCheque: 'Cheque' },
  GONE: { id: 'GONE', n: '1', b: 'Sicredi', v: 1, s: 'A' },
};
const cheques = normalizeCheques(raw, { GONE: true });
const byId = (id) => cheques.find((c) => c.id === id);

test('lista: cheques excluídos saem; totais e cartões por banco somam A compensar e compensados', () => {
  assert.equal(cheques.length, 5);
  const totals = totalsOf(cheques);
  assert.deepEqual([totals.A.count, totals.A.value, totals.C.count, totals.C.value, totals.X.count, totals.all], [3, 425.5, 1, 999, 1, 5]);
  assert.deepEqual(bankSummaries(cheques, banks).map((b) => [b.bank, b.pendingCount, b.pendingValue, b.clearedValue]), [['Sicredi', 3, 425.5, 999]]);
});

test('filtro: situação, banco e busca sem acento na lista inteira; ordem por banco e número', () => {
  assert.deepEqual(visibleCheques(cheques, { situation: 'A', bank: 'TODOS', search: '' }, banks).map((c) => c.number), ['501', '502', '777']);
  assert.deepEqual(visibleCheques(cheques, { situation: 'TODOS', bank: 'Itaú', search: '' }, banks).map((c) => c.id), ['C3']);
  assert.deepEqual(visibleCheques(cheques, { situation: 'TODOS', bank: 'TODOS', search: 'agil' }, banks).map((c) => c.id), ['C1']);
  assert.deepEqual(visibleCheques(cheques, { situation: 'TODOS', bank: 'TODOS', search: '505 joão' }, banks).map((c) => c.id), ['C2']);
});

test('compensação: cheque próprio de adiantamento baixa o banco; de terceiro não; o que já debitou não; legado pergunta', () => {
  const moved = (supplier, code) => supplier === 'F1' && code === 'A2';
  assert.equal(autoDebit({ advanceCode: 'A1', supplierCode: 'F1', chequeType: 'Cheque' }, moved), true);
  assert.equal(autoDebit({ advanceCode: 'A1', supplierCode: 'F1', chequeType: 'Cheque de Terceiro' }, moved), false);
  assert.equal(autoDebit({ advanceCode: 'A2', supplierCode: 'F1', chequeType: 'Cheque' }, moved), false);
  assert.equal(autoDebit({ advanceCode: '', supplierCode: '', chequeType: '' }, moved), null);
});

test('depósito em lote: só os A compensar, com a conta do banco e se desconta (abate compra não desconta de novo)', () => {
  const lines = depositLines([byId('C1'), byId('C4'), byId('C2'), byId('ADT1')], (name) => banks.find((b) => b.name === name)?.code ?? '', () => false);
  assert.deepEqual(lines, [
    { id: 'C1', bankCode: 'BC-001', debit: true },
    { id: 'C4', bankCode: 'BC-001', debit: false },
    { id: 'ADT1', bankCode: 'BC-001', debit: true },
  ]);
  assert.deepEqual(pendingForDeposit(cheques, 'Itaú'), []);
  assert.deepEqual(pendingForDeposit(cheques, 'TODOS').map((c) => c.number), ['501', '502', '777']);
});

test('excluir e reabrir: cheque de adiantamento sai pelo adiantamento; cheque que já saiu do banco exige acesso a Bancos', () => {
  assert.match(deleteBlock(byId('ADT1'), true), /pertence ao adiantamento A1/);
  assert.match(deleteBlock(byId('C2'), false), /acesso a Bancos/);
  assert.equal(deleteBlock(byId('C2'), true), '');
  assert.match(reopenBlock(byId('C2'), false), /acesso a Bancos/);
  assert.equal(reopenBlock(byId('C2'), true), '');
  assert.equal(deleteBlock(byId('C1'), false), '');
});

test('remessa e novo cheque mandam ao servidor o mesmo formato de antes', () => {
  assert.deepEqual(
    batchPayload({ bank: 'Sicredi', holder: ' AF SUCATAS ', start: '180', count: '3', value: '4.990,00', issued: '2026-11-05', due: '', situation: 'A', discountsPurchase: true }, banks),
    { action: 'batch-cheques', slug: 'SIC', start: 180, count: 3, s: 'A', dc: true, cheque: { b: 'Sicredi', c: 'AF SUCATAS', v: 4990, d: '05/11/2026', venc: '' } },
  );
  const destinations = [
    { name: 'JOAO ELIAS', code: 'C1', type: 'Cliente' },
    { name: 'JOAO ELIAS', code: 'F003', type: 'Fornecedor' },
  ];
  const form = { ...formFor(null, banks), number: '200', holder: 'JOAO ELIAS', value: '1500,00', issued: '2026-10-27', due: '2026-10-28', destinationCode: 'F003', destinationType: 'Fornecedor' };
  const saved = savePayload(form, banks, destinations);
  assert.deepEqual(saved, {
    action: 'save-cheque', id: '', slug: 'SIC',
    cheque: { b: 'Sicredi', n: '200', c: 'JOAO ELIAS', v: 1500, d: '27/10/2026', venc: '28/10/2026', cd: '', s: 'A' },
    destino: { tipo: 'Fornecedor', cod: 'F003', nome: 'JOAO ELIAS' },
  }, 'salva o código do fornecedor escolhido, não o do cliente de mesmo nome');
  assert.equal(savePayload({ ...form, destinationCode: '', destinationType: '' }, banks, destinations).destino, null, 'nome repetido sem escolha não chuta o destino');
  const edit = formFor(byId('C2'), banks);
  assert.deepEqual([edit.id, edit.cleared, edit.situation, edit.value], ['C2', '2026-11-12', 'C', '999']);
  assert.equal(parseAmount('R$ 1.234,56'), 1234.56);
  assert.equal(parseAmount('abc'), 0);
});

test('destinos: clientes e fornecedores ativos, sem excluídos nem repetidos; fornecedores primeiro', () => {
  const list = destinationsOf(
    [{ nome: 'CLIENTE TESTE', cod: 'C1' }],
    [{ nome: 'JOAO ELIAS', cod: 'F3' }, { nome: 'FORN INATIVO', cod: 'F4', inativo: true }, { nome: 'APAGADO', cod: 'F9' }, { nome: 'JOAO ELIAS', cod: 'F3' }],
    [{ razaoSocial: 'POSTO X', id: 'D1' }],
    new Set(['F9']),
  );
  assert.deepEqual(list.map((d) => [d.type, d.name, d.code]), [['Fornecedor', 'JOAO ELIAS', 'F3'], ['Fornecedor de despesa', 'POSTO X', 'D1'], ['Cliente', 'CLIENTE TESTE', 'C1']]);
  assert.deepEqual(matchDestinations(list, 'joão', false).map((d) => d.code), ['F3']);
  assert.equal(matchDestinations(list, 'joão', true).length, 3, 'depois de escolher, a lista mostra tudo para trocar');
  assert.equal(pickDestination(list, { code: '', type: '' }, 'cliente teste')?.code, 'C1');
});

test('numeração: lacunas por banco, salto grande sem listar milhões de números, e aviso ao digitar', () => {
  const make = (pairs) => normalizeCheques(Object.fromEntries(pairs.map(([b, n], i) => ['k' + i, { b, n: String(n) }])), {});
  const huge = sequences(make([['A', 1], ['A', 1000000]]));
  assert.deepEqual([huge[0].gaps.length, huge[0].gaps[0].count, huge[0].gaps[0].large], [1, 999998, true]);
  const review = reviewOf(huge);
  assert.deepEqual([review.rows.length, review.rows[0].type, review.rows[0].number, review.jumps], [1, 'jump', null, 1]);
  const small = reviewOf(sequences(make([['Banco A', 445], ['Banco A', 450], ['Banco B', 450], ['Banco B', 451]])));
  assert.equal(small.total, 1);
  assert.deepEqual(small.rows.map((r) => [r.bank, r.number, r.type]), [['Banco A', 446, 'missing'], ['Banco A', 447, 'missing'], ['Banco A', 448, 'missing'], ['Banco A', 449, 'missing']]);
  const many = reviewOf(sequences(make(Array.from({ length: 1000 }, (_, i) => ['A', i * 12 + 1]))));
  assert.equal(many.total, 999);
  assert.ok(many.rows.length <= 48 && many.limited);
  assert.match(gapLabel({ start: 446, end: 449, count: 4 }), /446–449 \(4\)/);
  const list = make([['Sicredi', 10], ['Sicredi', 11], ['Itaú', 99]]);
  assert.deepEqual([checkNumber(list, 'Sicredi', '11', '').duplicate, checkNumber(list, 'Sicredi', '12', '').tone, checkNumber(list, 'Itaú', '11', '').tone], [true, 'ok', '']);
  const jump = checkNumber(list, 'Sicredi', '15', '');
  assert.equal(jump.tone, 'warn');
  assert.match(jump.confirm, /Números faltantes: 12–14/);
  assert.equal(checkNumber(list, 'Sicredi', '15', 'k0').confirm, '', 'editando não pergunta de novo');
  assert.match(checkNumber(list, 'Sicredi', '999999', '').confirm, /Salto de numeração/);
});

test('exportar: CSV com BOM, ponto e vírgula e situação por extenso', () => {
  const csv = csvOf(cheques);
  assert.ok(csv.startsWith('﻿Nº;Banco;Cliente;Valor;Data Saída;Caiu em;Situação'));
  assert.match(csv, /\n501;Sicredi;Cliente Ágil;120,50;10\/11\/2026;;A Compensar/);
  assert.match(csv, /\n10;Itaú;X;50,00;;;Cancelado/);
});

test('tela em React: ilha instalada no lugar da antiga; camadas antigas não mexem mais na aba; nada grava chequesControle direto', () => {
  const core = read('public/legacy/app-core.js');
  const html = read('public/index.template.html');
  const islands = read('web/erp/islands.tsx');
  const phase2 = read('public/modules/phase2/phase2-feedback.js');
  const phase3 = read('public/modules/phase3/phase3-homologation.js');
  assert.match(html, /<div id="cheques-compensar-app"><\/div>/);
  assert.doesNotMatch(html, /chq-ctrl-root/);
  assert.match(islands, /installChequeControl\(\);/);
  assert.match(core, /window\.erpChequeControlSnapshot=function\(\)\{/);
  assert.match(core, /function renderChequesCompensar\(\)\{\}/);
  for (const name of ['chqMarcarComp', 'chqRemessaDepConfirmar', 'chqSalvarModal', '_chqModal', 'chqExcluir', 'chqExportCSV'])
    assert.doesNotMatch(core, new RegExp('function ' + name + '\\('), name);
  for (const name of ['cleanChequeControl', 'phase2ChequeCreateMissing', 'enhanceChequeModal']) assert.doesNotMatch(phase2, new RegExp(name), name);
  assert.doesNotMatch(phase3, /decorateCheque|chequeSequence/);
  assert.doesNotMatch(core, /function _chqMovBancoCriar|function _chqMovBancoRemover|function registrarMovBanco/);
  assert.doesNotMatch(core, /_chqRef\(\)\.update\(|_chqRef\(\)\.child\(|r\.child\(id\)\.(set|update|remove)\(|dr\.child\(id\)\.set\(/);
  assert.doesNotMatch(core, /function chqCorrigirAcredi|function chqCompletarGratusSicredi|_CHQ_FIX_GS/);
});
