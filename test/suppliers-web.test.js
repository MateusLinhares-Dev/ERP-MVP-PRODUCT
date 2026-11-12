import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { formatCep, formatCnpj, formatCpf, formatPhone, validCnpj, validCpf } from '../web/shared/domain/documents.ts';
import { pageOf } from '../web/shared/ui/Pager.tsx';
import { bankSummary, checkForm, documentOf, formOf, payloadOf, searchSuppliers, supplierRows } from '../web/modules/suppliers/domain/suppliers.ts';

const rows = supplierRows([
  { cod: 'F002', nome: 'ÁGUIA SUCATAS', cnpj: '11.222.333/0001-81', cidade: 'Joinville/SC', pix: 'pix@aguia', banco: 'Sicredi', agencia: '0101', conta: '123', _upd: 5 },
  { cod: 'F001', nome: "JOÃO D'ÁVILA", cpf: '529.982.247-25', tel: '(47) 9 9999-0000' },
  { cod: '', nome: 'SEM CODIGO' },
  null,
]);

test('lista: ordena por nome, ignora registros sem código e resume banco/PIX', () => {
  assert.deepEqual(rows.map((row) => row.cod), ['F002', 'F001']);
  assert.equal(rows[0].update, 5);
  assert.equal(documentOf(rows[0]), '11.222.333/0001-81');
  assert.equal(bankSummary(rows[0]), 'PIX: pix@aguia · Sicredi · Ag 0101 · C/C 123');
  assert.equal(bankSummary(rows[1]), '');
});

test('busca: sem acento, por código, cidade, telefone e números do documento', () => {
  assert.deepEqual(searchSuppliers(rows, 'joao d').map((row) => row.cod), ['F001']);
  assert.deepEqual(searchSuppliers(rows, 'davila').map((row) => row.cod), ['F001']);
  assert.deepEqual(searchSuppliers(rows, "d'ávila").map((row) => row.cod), ['F001']);
  assert.deepEqual(searchSuppliers(rows, 'aguia').map((row) => row.cod), ['F002']);
  assert.deepEqual(searchSuppliers(rows, 'joinville').map((row) => row.cod), ['F002']);
  assert.deepEqual(searchSuppliers(rows, '52998').map((row) => row.cod), ['F001']);
  assert.deepEqual(searchSuppliers(rows, '11222333').map((row) => row.cod), ['F002']);
  assert.equal(searchSuppliers(rows, '').length, 2);
});

test('paginação: 25 por página e página fora do limite volta para a última', () => {
  const many = Array.from({ length: 60 }, (_, index) => index);
  assert.deepEqual(pageOf(many, 1, 25).rows.slice(0, 2), [0, 1]);
  const last = pageOf(many, 9, 25);
  assert.equal(last.page, 3);
  assert.equal(last.pages, 3);
  assert.deepEqual(last.rows, [50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
});

test('máscaras e documentos: CPF, CNPJ numérico e alfanumérico, telefone e CEP', () => {
  assert.equal(formatCpf('52998224725'), '529.982.247-25');
  assert.equal(formatCnpj('00000000e08g12'), '00.000.000/E08G-12');
  assert.equal(formatCnpj('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatPhone('47999990000'), '(47) 9 9999-0000');
  assert.equal(formatPhone('4733334444'), '(47) 3333-4444');
  assert.equal(formatCep('89219730'), '89219-730');
  assert.equal(validCpf('529.982.247-25'), true);
  assert.equal(validCpf('111.111.111-11'), false);
  assert.equal(validCnpj('00.000.000/E08G-12'), true);
  assert.equal(validCnpj('11.222.333/0001-80'), false);
});

test('formulário: novo vem com data de hoje; editar antigo não inventa data e separa cidade/UF', () => {
  const fresh = formOf(null, '2026-11-12');
  assert.equal(fresh.desde, '2026-11-12');
  assert.equal(fresh.personType, 'PF');
  assert.equal(fresh.contribuinte, 'Não informado');
  const old = formOf({ cod: 'F002', nome: 'X', cnpj: '11.222.333/0001-81', cidade: 'Joinville/sc' }, '2026-11-12');
  assert.equal(old.desde, '');
  assert.equal(old.personType, 'PJ');
  assert.equal(old.cidadeNome, 'Joinville');
  assert.equal(old.uf, 'SC');
});

test('salvar: valida documento do tipo escolhido, pede confirmação para apagar o outro e limpa o envio', () => {
  const base = formOf(null, '2026-11-12');
  assert.deepEqual(checkForm({ ...base, nome: ' ' }), { ok: false, field: 'nome', message: 'Informe o nome do fornecedor.' });
  assert.equal(checkForm({ ...base, nome: 'A', cpf: '111.111.111-11' }).field, 'cpf');
  assert.equal(checkForm({ ...base, nome: 'A', personType: 'PJ', cnpj: '11.222.333/0001-80' }).field, 'cnpj');
  assert.equal(checkForm({ ...base, nome: 'A', personType: 'PJ', cnpj: '00.000.000/E08G-12' }).ok, true);
  assert.equal(checkForm({ ...base, nome: 'A', email: 'sem-arroba' }).field, 'email');
  const both = { ...base, nome: '  nova   sucata ', personType: 'PJ', cnpj: '00.000.000/e08g-12', cpf: '529.982.247-25', cidadeNome: 'Joinville', uf: 'sc' };
  assert.equal(checkForm(both).ok, 'confirm');
  assert.match(checkForm(both).message, /CPF será removido/);
  const payload = payloadOf(both);
  assert.equal(payload.nome, 'NOVA SUCATA');
  assert.equal(payload.cpf, '');
  assert.equal(payload.cnpj, '00.000.000/E08G-12');
  assert.equal(payload.cidade, 'Joinville/SC');
  assert.equal(payload.nomeFantasia, '');
  assert.equal(payload.dataCadastro, '2026-11-12');
});

test('tela antiga de fornecedores saiu do app-core, supplier-compat e master-data', () => {
  const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const compat = readFileSync(new URL('../public/legacy/supplier-compat.js', import.meta.url), 'utf8');
  const master = readFileSync(new URL('../public/modules/master-data/master-data-forms.js', import.meta.url), 'utf8');
  for (const name of ['filtrarTabelaForn', 'excluirSelecionados', 'excluirFornecedor', 'toggleAllForn'])
    assert.doesNotMatch(core, new RegExp('function ' + name + '\\('), name);
  assert.match(core, /function renderTabelaFornecedores\(\)\{\}/);
  assert.doesNotMatch(compat, /window\.renderTabelaFornecedores\s*=/);
  assert.match(compat, /window\.fornContas=/);
  assert.doesNotMatch(master, /supplierForm|salvarNovoFornecedor|editFornecedor/);
  const island = readFileSync(new URL('../web/erp/suppliers.tsx', import.meta.url), 'utf8');
  assert.match(island, /renderTabelaFornecedores: renderList/);
  assert.match(island, /type === 'fornecedor' \? openForm\(''\)/);
  assert.ok(existsSync(new URL('../web/modules/suppliers/ui/SupplierFormView.tsx', import.meta.url)));
});
