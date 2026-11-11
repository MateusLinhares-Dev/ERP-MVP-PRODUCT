import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { validCnpj, validCpf, nextSupplierCode, cleanSupplier } from '../server/modules/suppliers/domain/supplier-rules.ts';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canSuppliers: true };
const admin = { ...identity, uid: 'erp:elaine', erpUser: 'elaine', admin: true };
let srv, db, app, changeSupplier;
const viaSdk = async (path) => (await db.ref(path).get()).val();
const call = (body, who = identity) => changeSupplier(who, { operationId: randomUUID(), ...body }, { db });
const baseData = () => ({ erp: {
  fornecedores: {
    FRXabc: { id: 'FRXabc', cod: 'F007', nome: 'CICLO', cnpj: '11.222.333/0001-81', docs: [{ id: 'D1', nomeArq: 'contrato.pdf' }] },
    F009: { id: 'F009', cod: 'F009', nome: 'JOAO ELIAS', cpf: '529.982.247-25' },
  },
  fornDeleted: { F010: true }, adiantamentos: {}, tickets: {}, _ts: 1,
} });

before(async () => {
  srv = await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS = 'true';
  process.env.FIREBASE_PROJECT_ID = 'demo-erp-test';
  process.env.FIREBASE_DATABASE_URL = srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = srv.host;
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-erp-test.appspot.com';
  delete process.env.APP_ENV; delete process.env.VERCEL_ENV;
  const firebase = await import('../server/shared/firebase/firebase-admin.js');
  ({ app, db } = firebase.getFirebaseAdmin());
  ({ changeSupplier } = await import('../server/modules/suppliers/application/supplier-registry.js'));
});
after(async () => {
  try { await app?.delete(); } catch {}
  await srv?.close();
});

test('regras: CPF, CNPJ numérico e alfanumérico, próximo código pulando excluídos', () => {
  assert.equal(validCpf('529.982.247-25'), true);
  assert.equal(validCpf('111.111.111-11'), false);
  assert.equal(validCnpj('11.222.333/0001-81'), true);
  assert.equal(validCnpj('00.000.000/E08G-12'), true);
  assert.equal(validCnpj('11.222.333/0001-80'), false);
  assert.equal(nextSupplierCode(['F007', 'F009', 'F010', 'X1']), 'F011');
  assert.equal(nextSupplierCode([]), 'F001');
  const { fields, problems } = cleanSupplier({ nome: '  ciclo   metais ', uf: 'sc', extra: 'ignorado', email: 'x' });
  assert.equal(fields.nome, 'CICLO METAIS');
  assert.equal(fields.uf, 'SC');
  assert.equal('extra' in fields, false);
  assert.equal(problems[0].code, 'INVALID_EMAIL');
});

test('cadastro novo: código sequencial, campos limpos e aviso às telas', async () => {
  srv.reset(baseData());
  const result = await call({ action: 'create', supplier: { nome: 'nova sucata', cpf: '', cnpj: '00.000.000/E08G-12', cidadeNome: 'Joinville', uf: 'SC', personType: 'PJ', hack: 'x' } });
  assert.equal(result.supplier.cod, 'F011');
  const stored = await viaSdk('erp/fornecedores/F011');
  assert.equal(stored.nome, 'NOVA SUCATA');
  assert.equal(stored.id, 'F011');
  assert.equal(stored.hack, undefined);
  assert.equal(stored.criadoPor, 'thais');
  assert.notEqual(await viaSdk('erp/_ts'), 1);
});

test('cadastro novo: recusa nome vazio, CPF inválido e documento já usado por outro fornecedor', async () => {
  srv.reset(baseData());
  await assert.rejects(call({ action: 'create', supplier: { nome: '  ' } }), { code: 'SUPPLIER_NAME_REQUIRED' });
  await assert.rejects(call({ action: 'create', supplier: { nome: 'X', cpf: '123.456.789-00' } }), { code: 'INVALID_CPF' });
  await assert.rejects(call({ action: 'create', supplier: { nome: 'OUTRO', cnpj: '11222333000181' } }), (error) => error.code === 'SUPPLIER_DOCUMENT_EXISTS' && /F007 — CICLO/.test(error.message));
  await assert.rejects(call({ action: 'create', supplier: { nome: 'X' } }, { ...identity, canSuppliers: false }), { code: 'SUPPLIERS_REQUIRED' });
});

test('editar: mantém documentos e campos extras, grava na chave antiga e detecta edição concorrente', async () => {
  srv.reset(baseData());
  const result = await call({ action: 'update', cod: 'F007', supplier: { nome: 'ciclo reciclagem', tel: '(47) 99999-0000' } });
  assert.equal(result.key, 'FRXabc');
  const stored = await viaSdk('erp/fornecedores/FRXabc');
  assert.equal(stored.nome, 'CICLO RECICLAGEM');
  assert.equal(stored.docs[0].nomeArq, 'contrato.pdf');
  assert.equal(stored.cnpj, '11.222.333/0001-81');
  await assert.rejects(call({ action: 'update', cod: 'F007', expectedUpdate: 1, supplier: { nome: 'X' } }), { code: 'SUPPLIER_CHANGED' });
  await assert.rejects(call({ action: 'update', cod: 'F009', supplier: { cnpj: '11.222.333/0001-81' } }), { code: 'SUPPLIER_DOCUMENT_EXISTS' });
  await assert.rejects(call({ action: 'update', cod: 'F010', supplier: { nome: 'X' } }), { code: 'SUPPLIER_NOT_FOUND' });
});

test('excluir: bloqueia com adiantamento, repasse ou compra em aberto e não deixa apagar todos', async () => {
  srv.reset(baseData());
  await db.ref('erp/adiantamentos/F009').set([{ cod: 'A1', status: 'Pendente', valor: 100 }]);
  await assert.rejects(call({ action: 'delete', codes: ['F009'] }), (error) => error.code === 'SUPPLIER_HAS_OPEN_FINANCE' && /adiantamento em aberto/.test(error.message));
  await db.ref('erp/adiantamentos/F009').set([{ cod: 'A1', status: 'Quitado', valor: 100 }]);
  await db.ref('erp/tickets/T1').set({ ticket: 'T1', fornecedorCod: 'F009', saldoPagar: 50 });
  await assert.rejects(call({ action: 'delete', codes: ['F009'] }), (error) => /compra com saldo a pagar/.test(error.message));
  await db.ref('erp/tickets/T1/saldoPagar').set(0);
  await assert.rejects(call({ action: 'delete', codes: ['F007', 'F009'] }), { code: 'SUPPLIER_DELETE_ALL' });
  const result = await call({ action: 'delete', codes: ['F009'] });
  assert.deepEqual(result.deleted, ['F009']);
  assert.equal(await viaSdk('erp/fornDeleted/F009'), true);
  assert.equal((await viaSdk('erp/fornecedores/F009')).nome, 'JOAO ELIAS');
});

test('restaurar todos só para a administração', async () => {
  srv.reset(baseData());
  await assert.rejects(call({ action: 'restore-all' }), { code: 'ADMIN_REQUIRED' });
  const result = await call({ action: 'restore-all' }, admin);
  assert.deepEqual(result.restored, ['F010']);
  assert.equal(await viaSdk('erp/fornDeleted'), null);
});

test('importar: pula documento ou nome já cadastrado, aponta linha inválida e numera em sequência', async () => {
  srv.reset(baseData());
  const result = await call({ action: 'import', suppliers: [
    { nome: 'novo um', cpf: '' },
    { nome: 'repetido', cnpj: '11.222.333/0001-81' },
    { nome: 'joão elias' },
    { nome: 'cpf ruim', cpf: '111.111.111-11' },
    { nome: 'novo dois' },
    { nome: 'NOVO UM' },
  ] });
  assert.deepEqual(result.added.map((s) => [s.cod, s.nome]), [['F011', 'NOVO UM'], ['F012', 'NOVO DOIS']]);
  assert.equal(result.duplicates, 3);
  assert.deepEqual(result.invalid.map((x) => x.row), [4]);
  assert.equal((await viaSdk('erp/fornecedores/F012')).origem, 'importacao');
});

test('documentos: lista validada e gravada no fornecedor', async () => {
  srv.reset(baseData());
  await call({ action: 'set-docs', cod: 'F007', docs: [{ id: 'D2', nomeArq: 'alvara.pdf', categoria: 'Alvará', data: '11/11/2026', mimeType: 'application/pdf', _nuvem: true, lixo: 'x' }] });
  const docs = await viaSdk('erp/fornecedores/FRXabc/docs');
  assert.deepEqual(docs, [{ id: 'D2', nomeArq: 'alvara.pdf', categoria: 'Alvará', data: '11/11/2026', mimeType: 'application/pdf', _nuvem: true }]);
  await assert.rejects(call({ action: 'set-docs', cod: 'F007', docs: [{ id: '../x' }] }), { code: 'INVALID_DOCUMENT' });
});

test('repetir a mesma operação devolve o resultado gravado sem criar outro fornecedor', async () => {
  srv.reset(baseData());
  const operationId = randomUUID();
  const first = await changeSupplier(identity, { operationId, action: 'create', supplier: { nome: 'UNICO' } }, { db });
  const again = await changeSupplier(identity, { operationId, action: 'create', supplier: { nome: 'UNICO' } }, { db });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.supplier.cod, first.supplier.cod);
  assert.equal(Object.keys(await viaSdk('erp/fornecedores')).length, 3);
});

test('endpoint POST /api/master-data/suppliers chama o cadastro do servidor', () => {
  const endpoint = readFileSync(new URL('../api/master-data/suppliers.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /changeSupplier\(identity, body as Body\)/);
});
