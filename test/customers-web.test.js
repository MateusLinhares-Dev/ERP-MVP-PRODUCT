import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPartyForm, partyFormOf, partyPayload } from '../web/shared/domain/party.ts';
import { customerRows, renamedMessage, searchCustomers } from '../web/modules/customers/domain/customers.ts';

const rows = customerRows([
  { id: 'CLx', cod: 'C002', nome: "JOÃO D'ÁVILA", cpf: '529.982.247-25', email: 'joao@x.com', limite: 1500 },
  { id: 'C001', cod: 'C001', nome: 'ÁGUIA SUCATAS', cnpj: '11.222.333/0001-81', cidade: 'Joinville/SC', _upd: 7 },
  { cod: 'C003', nome: 'SEM ID' },
  { nome: 'SEM NADA' },
  null,
]);

test('lista de clientes: chave é o id do Firebase (código pode repetir em cadastro antigo), ordena por nome', () => {
  assert.deepEqual(rows.map((row) => [row.key, row.cod]), [['C001', 'C001'], ['CLx', 'C002'], ['C003', 'C003']]);
  assert.equal(rows[0].update, 7);
  assert.equal(rows[1].limite, 1500);
  assert.deepEqual(searchCustomers(rows, 'davila').map((row) => row.key), ['CLx']);
  assert.deepEqual(searchCustomers(rows, 'joao@x').map((row) => row.key), ['CLx']);
  assert.deepEqual(searchCustomers(rows, '11222333').map((row) => row.key), ['C001']);
});

test('formulário de cliente: limite de crédito vai como número; mensagens falam de cliente', () => {
  const form = partyFormOf({ nome: 'X', limite: 2500.5, cidade: 'Joinville/sc' }, '2026-11-12');
  assert.equal(form.limite, '2500,5');
  assert.equal(form.cidadeNome, 'Joinville');
  assert.equal(checkPartyForm({ ...form, nome: '' }, 'cliente').message, 'Informe o nome do cliente.');
  assert.equal(checkPartyForm({ ...form, limite: '-1' }, 'cliente').field, 'limite');
  const payload = partyPayload({ ...form, limite: '1.234,56' }, true);
  assert.equal(payload.limite, 1234.56);
  assert.equal(payload.cidade, 'Joinville/SC');
  assert.equal('limite' in partyPayload(form, false), false, 'fornecedor não manda limite');
  assert.equal(renamedMessage({ renamed: { moved: '2 venda(s)' } }), 'O nome também foi trocado em: 2 venda(s).');
  assert.equal(renamedMessage({}), '');
});

test('tela antiga de clientes saiu; a nova grava pela API e não recebe botões injetados', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  assert.match(core, /function renderClientes\(\)\{\}/);
  assert.doesNotMatch(core, /function editCliente\(|function excluirCliente\(|function salvarNovoCliente\(|cliente:`<h3>/);
  assert.match(core, /window\.erpCustomersList=function\(\)\{ return CLIENTES; \};/);
  const island = readFileSync(new URL('../web/erp/customers.tsx', import.meta.url), 'utf8');
  assert.match(island, /request\(\{ action: 'delete', ids: keys \}\)/);
  assert.match(island, /action: 'update',\s*id: key,/);
  for (const file of ['phase1/phase1-usability.js', 'phase1/phase1-commercial.js', 'phase3/phase3-homologation.js'])
    assert.doesNotMatch(readFileSync(new URL('../public/modules/' + file, import.meta.url), 'utf8'), /tb-clientes-list/, file);
  const html = readFileSync(new URL('../public/index.template.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="clientes-app">/);
  assert.doesNotMatch(html, /filtrarTabelaCli/);
});
