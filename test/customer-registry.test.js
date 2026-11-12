import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';
import { cleanCustomer, nextCustomerCode, nameProblem } from '../server/modules/customers/domain/customer-rules.ts';
import { moveReferences, openFinance } from '../server/modules/customers/domain/customer-references.ts';

const identity = { uid: 'erp:thais', erpUser: 'thais', erpAccess: true, canCustomers: true };
const admin = { ...identity, uid: 'erp:elaine', erpUser: 'elaine', admin: true };
let srv, db, app, changeCustomer;
const read = async (path) => (await db.ref(path).get()).val();
const call = (body, who = identity) => changeCustomer(who, { operationId: randomUUID(), ...body }, { db, now: () => 5000 });
const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
};

const baseData = () => ({
  erp: {
    _ts: 1,
    clientes: {
      CLabc: { id: 'CLabc', cod: 'C001', nome: 'GERDAU', cnpj: '11.222.333/0001-81', _upd: 10 },
      CLdef: { id: 'CLdef', cod: 'C003', nome: "JOÃO D'ÁVILA", cpf: '529.982.247-25' },
      CLold: { id: 'CLold', cod: 'C002', nome: 'APAGADO' },
      CLtupy: { id: 'CLtupy', cod: 'C004', nome: 'TUPY' },
    },
    clientesDeleted: ['CLold'],
    vendas: {
      V1: { id: 'V1', cliente: 'GERDAU', total: 100 },
      V2: { id: 'V2', cliente: 'Gerdau ', total: 50 },
      V3: { id: 'V3', cliente: 'TUPY', total: 10 },
    },
    contasReceber: {
      R1: { id: 'R1', cli: 'GERDAU', valor: 100, status: 'Recebido' },
      R2: { id: 'R2', cli: 'TUPY', valor: 10, status: 'Pendente' },
    },
    adtCli: { GERDAU: [{ cod: 'ADTC1', valor: 0, status: 'Quitado' }] },
    chequesCli: {},
    fcLanc: { GERDAU: [{ tipo: 'entrega', valor: 1 }] },
    fcSaldoIni: { GERDAU: { valor: 20, data: '01/01/2026' } },
    precosCli: { GERDAU: { FERRO: 1.5 } },
    tickets: {
      T1: { tipo: 'venda', cliente: 'GERDAU', fornecedor: 'GERDAU' },
      T2: { tipo: 'compra', fornecedor: 'GERDAU' },
    },
  },
});

before(async () => {
  srv = await startFakeRtdb();
  process.env.USE_FIREBASE_EMULATORS = 'true';
  process.env.FIREBASE_PROJECT_ID = 'demo-erp-test';
  process.env.FIREBASE_DATABASE_URL = srv.databaseURL;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = srv.host;
  process.env.FIREBASE_STORAGE_BUCKET = 'demo-erp-test.appspot.com';
  delete process.env.APP_ENV;
  delete process.env.VERCEL_ENV;
  const firebase = await import('../server/shared/firebase/firebase-admin.js');
  ({ app, db } = firebase.getFirebaseAdmin());
  ({ changeCustomer } = await import('../server/modules/customers/application/customer-registry.js'));
});
beforeEach(() => srv.reset(baseData()));
after(async () => {
  try {
    await app?.delete();
  } catch {}
  await srv?.close();
});

test('regras: próximo código não repete, nome sem caracteres de chave, limite e documentos', () => {
  assert.equal(nextCustomerCode(['C001', 'C003', 'CL12345678', 'CLabc']), 'C004');
  assert.equal(nameProblem('J.A. METAIS')?.code, 'INVALID_CUSTOMER_NAME');
  assert.equal(nameProblem('')?.code, 'CUSTOMER_NAME_REQUIRED');
  assert.equal(nameProblem('JOÃO DA SILVA'), null);
  const { fields, problems } = cleanCustomer({ nome: '  nova   sucata ', limite: '1500,5', uf: 'sc', cpf: '111.111.111-11' });
  assert.equal(fields.nome, 'NOVA SUCATA');
  assert.equal(fields.limite, 1500.5);
  assert.equal(fields.uf, 'SC');
  assert.equal(problems[0]?.code, 'INVALID_CPF');
});

test('trocar nome leva vendas, contas a receber, ficha, preços e pesagens de venda (sem mexer em compra)', () => {
  const data = baseData().erp;
  const { updates, moved, invalidKey } = moveReferences(data, 'GERDAU', 'GERDAU SA');
  assert.equal(invalidKey, false);
  assert.equal(updates['vendas/V1/cliente'], 'GERDAU SA');
  assert.equal(updates['vendas/V2/cliente'], 'GERDAU SA');
  assert.equal(updates['vendas/V3/cliente'], undefined);
  assert.equal(updates['contasReceber/R1/cli'], 'GERDAU SA');
  assert.equal(updates['adtCli/GERDAU'], null);
  assert.deepEqual(updates['adtCli/GERDAU SA'], [{ cod: 'ADTC1', valor: 0, status: 'Quitado' }]);
  assert.deepEqual(updates['fcSaldoIni/GERDAU SA'], { valor: 20, data: '01/01/2026' });
  assert.deepEqual(updates['precosCli/GERDAU SA'], { FERRO: 1.5 });
  assert.equal(updates['tickets/T1/cliente'], 'GERDAU SA');
  assert.equal(updates['tickets/T1/fornecedor'], 'GERDAU SA');
  assert.equal(updates['tickets/T2/fornecedor'], undefined);
  assert.equal(moved.vendas, 2);
  assert.equal(moveReferences(data, 'GERDAU', 'G.A.').invalidKey, true);
  assert.deepEqual(openFinance(data, 'TUPY'), ['conta a receber em aberto']);
  assert.deepEqual(openFinance(data, 'GERDAU'), []);
});

test('cadastrar: código novo pelo servidor, nome e CPF/CNPJ repetidos são barrados', async () => {
  const created = await call({ action: 'create', customer: { nome: 'sucata nova', tel: '47 9999' } });
  assert.equal(created.customer.cod, 'C005');
  assert.equal(created.customer.id, 'C005');
  assert.equal((await read('erp/clientes/C005')).nome, 'SUCATA NOVA');
  assert.equal(await read('erp/_ts'), 5000);
  assert.equal((await failure(call({ action: 'create', customer: { nome: 'Gerdau' } })))?.code, 'CUSTOMER_NAME_EXISTS');
  assert.equal(
    (await failure(call({ action: 'create', customer: { nome: 'OUTRA', cnpj: '11.222.333/0001-81' } })))?.code,
    'CUSTOMER_DOCUMENT_EXISTS',
  );
  assert.equal((await failure(call({ action: 'create', customer: { nome: 'A/B' } })))?.code, 'INVALID_CUSTOMER_NAME');
  assert.equal((await failure(call({ action: 'create', customer: { nome: 'APAGADO' } }))), null, 'cliente excluído não bloqueia o nome');
});

test('editar: troca o nome e leva o histórico junto; conflito de edição é detectado', async () => {
  const result = await call({ action: 'update', id: 'CLabc', customer: { nome: 'gerdau sa', tel: '47' }, expectedUpdate: 10 });
  assert.equal(result.customer.nome, 'GERDAU SA');
  assert.equal(result.renamed.from, 'GERDAU');
  assert.match(result.renamed.moved, /2 venda\(s\)/);
  assert.equal(await read('erp/vendas/V1/cliente'), 'GERDAU SA');
  assert.equal(await read('erp/contasReceber/R1/cli'), 'GERDAU SA');
  assert.equal(await read('erp/adtCli/GERDAU'), null);
  assert.equal(await read('erp/tickets/T1/cliente'), 'GERDAU SA');
  assert.equal(await read('erp/tickets/T2/fornecedor'), 'GERDAU');
  assert.equal((await read('erp/clientes/CLabc')).cod, 'C001');
  const stale = await failure(call({ action: 'update', id: 'CLabc', customer: { tel: '1' }, expectedUpdate: 10 }));
  assert.equal(stale?.code, 'CUSTOMER_CHANGED');
  const same = await call({ action: 'update', id: 'CLdef', customer: { tel: '9' } });
  assert.equal(same.renamed, undefined);
  assert.equal((await failure(call({ action: 'update', id: 'CLdef', customer: { nome: 'tupy' } })))?.code, 'CUSTOMER_NAME_EXISTS');
  assert.equal((await failure(call({ action: 'update', id: 'CLold', customer: { tel: '1' } })))?.code, 'CUSTOMER_NOT_FOUND');
});

test('excluir: bloqueia com conta a receber em aberto; sem pendência apaga e marca excluído', async () => {
  const blocked = await failure(call({ action: 'delete', ids: ['CLtupy'] }));
  assert.equal(blocked?.code, 'CUSTOMER_HAS_OPEN_FINANCE');
  assert.match(blocked.message, /C004 — TUPY \(conta a receber em aberto\)/);
  const done = await call({ action: 'delete', ids: ['CLdef'] });
  assert.deepEqual(done.deleted, ['CLdef']);
  assert.equal(await read('erp/clientes/CLdef'), null);
  assert.equal((await read('erp/clientesDeleted'))?.CLdef, true);
});

test('juntar: só administração; move o histórico e apaga o cliente juntado', async () => {
  assert.equal((await failure(call({ action: 'merge', from: 'CLtupy', into: 'CLabc' })))?.code, 'ADMIN_REQUIRED');
  const result = await call({ action: 'merge', from: 'CLtupy', into: 'CLabc' }, admin);
  assert.deepEqual(result.deleted, ['CLtupy']);
  assert.equal(await read('erp/vendas/V3/cliente'), 'GERDAU');
  assert.equal(await read('erp/contasReceber/R2/cli'), 'GERDAU');
  assert.equal(await read('erp/clientes/CLtupy'), null);
  const byName = await call({ action: 'merge', fromName: 'CLIENTE ANTIGO', into: 'CLabc' }, admin);
  assert.deepEqual(byName.deleted, []);
});

test('documentos, perfil sem permissão, repetição da mesma operação e endpoint', async () => {
  const docs = await call({ action: 'set-docs', id: 'CLabc', docs: [{ id: 'D1', nomeArq: 'contrato.pdf', _nuvem: true }] });
  assert.deepEqual(docs.docs, [{ id: 'D1', nomeArq: 'contrato.pdf', categoria: '', data: '', mimeType: '', _nuvem: true }]);
  const denied = await failure(changeCustomer({ ...identity, canCustomers: false }, { action: 'create', customer: { nome: 'X' } }, { db }));
  assert.equal(denied?.code, 'CUSTOMERS_REQUIRED');
  const operationId = randomUUID();
  const first = await changeCustomer(identity, { operationId, action: 'create', customer: { nome: 'UMA VEZ' } }, { db });
  const again = await changeCustomer(identity, { operationId, action: 'create', customer: { nome: 'UMA VEZ' } }, { db });
  assert.equal(again.alreadyCommitted, true);
  assert.equal(again.customer.cod, first.customer.cod);
  const endpoint = readFileSync(new URL('../api/master-data/customers.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /changeCustomer\(identity, body as Body\)/);
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.erp;
  assert.equal(rules.clientes['.write'], false);
  assert.equal(rules.clientesDeleted['.write'], false);
  assert.deepEqual(rules.customerOperations, { '.read': false, '.write': false });
});
