import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { nameKey, tombstoneIds } from '../../../shared/domain/person.js';
import { fail } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import {
  moveReferences,
  movedSummary,
  openFinance,
  type ReferenceData,
} from '../domain/customer-references.js';
import {
  cleanCustomer,
  customerEntries,
  describe,
  duplicateDocument,
  duplicateName,
  findCustomer,
  nameProblem,
  nextCustomerCode,
  type CustomerFields,
  type Row,
  type StoredCustomer,
} from '../domain/customer-rules.js';

export interface CustomerDeps {
  db?: Database;
  now?: () => number;
}

const MAX_DELETE = 200;
const MAX_DOCS = 200;
const CODE_ATTEMPTS = 6;

const text = (value: unknown, max = 160): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function customerId(value: unknown): string {
  const result = text(value, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(result))
    fail(422, 'INVALID_CUSTOMER_ID', 'Cliente inválido. Atualize a tela.');
  return result;
}

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

function requireCustomers(identity: Identity): void {
  if (identity.erpAccess !== true || identity.canCustomers !== true)
    fail(403, 'CUSTOMERS_REQUIRED', 'Seu perfil não pode alterar o cadastro de clientes.');
}

async function loadDirectory(db: Database): Promise<StoredCustomer[]> {
  const [customersSnap, deletedSnap] = await Promise.all([
    db.ref('erp/clientes').get(),
    db.ref('erp/clientesDeleted').get(),
  ]);
  return customerEntries(customersSnap.val(), tombstoneIds(deletedSnap.val()));
}

async function loadReferences(db: Database, withTickets: boolean): Promise<ReferenceData> {
  const paths = [
    'vendas',
    'contasReceber',
    'adtCli',
    'chequesCli',
    'fcLanc',
    'fcSaldoIni',
    'precosCli',
  ] as const;
  const [values, tickets] = await Promise.all([
    Promise.all(paths.map(async (path) => (await db.ref('erp/' + path).get()).val() as unknown)),
    withTickets ? db.ref('erp/tickets').orderByChild('tipo').equalTo('venda').get() : Promise.resolve(null),
  ]);
  const data: ReferenceData = Object.fromEntries(paths.map((path, index) => [path, values[index]]));
  if (tickets) data.tickets = tickets.val();
  return data;
}

function clean(input: unknown): CustomerFields {
  const { fields, problems } = cleanCustomer(input);
  const problem = problems[0];
  if (problem) fail(422, problem.code, problem.message);
  return fields;
}

function checkName(entries: readonly StoredCustomer[], name: string, ignoreKey = ''): void {
  const problem = nameProblem(name);
  if (problem) fail(422, problem.code, problem.message);
  const same = duplicateName(entries, name, ignoreKey);
  if (same) fail(409, 'CUSTOMER_NAME_EXISTS', `Já existe o cliente ${describe(same)}.`);
}

function checkDocument(entries: readonly StoredCustomer[], fields: CustomerFields, ignoreKey = ''): void {
  const same = duplicateDocument(entries, fields, ignoreKey);
  if (same) fail(409, 'CUSTOMER_DOCUMENT_EXISTS', `CPF/CNPJ já cadastrado no cliente ${describe(same)}.`);
}

const prefixed = (updates: Row): Row =>
  Object.fromEntries(Object.entries(updates).map(([path, value]) => ['erp/' + path, value]));

async function createOne(db: Database, identity: Identity, input: unknown, now: () => number) {
  const fields = clean(input);
  const name = String(fields.nome ?? '');
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const entries = await loadDirectory(db);
    checkName(entries, name);
    checkDocument(entries, fields);
    const cod = nextCustomerCode(entries.flatMap(({ key, record }) => [key, String(record.cod ?? '')]));
    const record: Row = {
      ...fields,
      id: cod,
      cod,
      status: fields.status || 'Ativo',
      criadoEm: new Date(now()).toISOString(),
      criadoPor: text(identity.erpUser || identity.uid, 80),
      _upd: now(),
    };
    const result = await runTransaction(db.ref('erp/clientes/' + cod), (previous) =>
      previous === null ? record : undefined,
    );
    if (result.committed) {
      await db.ref('erp/_ts').set(now());
      return { action: 'create', key: cod, customer: record };
    }
  }
  return fail(409, 'CUSTOMER_CODE_BUSY', 'Outro cadastro foi feito ao mesmo tempo. Tente de novo.');
}

function existing(entries: readonly StoredCustomer[], id: string): StoredCustomer {
  const found = findCustomer(entries, id);
  if (!found) fail(404, 'CUSTOMER_NOT_FOUND', 'Cliente não encontrado. Atualize a tela.');
  return found as StoredCustomer;
}

async function updateOne(db: Database, identity: Identity, input: Row, now: () => number) {
  const id = customerId(input.id);
  const fields = clean(input.customer);
  const entries = await loadDirectory(db);
  const current = existing(entries, id);
  const expected = input.expectedUpdate;
  if (expected != null && current.record._upd != null && Number(current.record._upd) !== Number(expected))
    fail(409, 'CUSTOMER_CHANGED', 'O cadastro foi alterado em outra tela. Atualize e tente de novo.');
  checkDocument(entries, fields, current.key);
  const oldName = String(current.record.nome ?? '');
  const newName = 'nome' in fields ? String(fields.nome ?? '') : oldName;
  const renamed = newName !== oldName;
  if (renamed) checkName(entries, newName, current.key);
  const customer: Row = {
    ...current.record,
    ...fields,
    id: current.record.id ?? current.key,
    alteradoPor: text(identity.erpUser || identity.uid, 80),
    _upd: now(),
  };
  const updates: Row = { ['erp/clientes/' + current.key]: customer, 'erp/_ts': now() };
  let moved = '';
  if (renamed && oldName) {
    const result = moveReferences(await loadReferences(db, true), oldName, newName);
    if (result.invalidKey) fail(422, 'INVALID_CUSTOMER_NAME', 'O novo nome não pode ter . # $ [ ] /.');
    Object.assign(updates, prefixed(result.updates));
    moved = movedSummary(result.moved);
  }
  await db.ref().update(updates);
  return {
    action: 'update',
    key: current.key,
    customer,
    ...(renamed && oldName ? { renamed: { from: oldName, to: newName, moved } } : {}),
  };
}

async function deleteMany(db: Database, input: Row, now: () => number) {
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(customerId))];
  if (!ids.length || ids.length > MAX_DELETE)
    fail(422, 'INVALID_CUSTOMER_IDS', 'Selecione de 1 a 200 clientes.');
  const entries = await loadDirectory(db);
  const targets = ids.map((id) => existing(entries, id));
  if (targets.length >= entries.length)
    fail(409, 'CUSTOMER_DELETE_ALL', 'Não é permitido excluir todos os clientes de uma vez.');
  const references = await loadReferences(db, false);
  const blocked = targets
    .map((target) => ({ target, reasons: openFinance(references, String(target.record.nome ?? '')) }))
    .filter(({ reasons }) => reasons.length)
    .map(({ target, reasons }) => `${describe(target)} (${reasons.join(', ')})`);
  if (blocked.length)
    fail(
      409,
      'CUSTOMER_HAS_OPEN_FINANCE',
      'Não dá para excluir cliente com pendência financeira: ' + blocked.slice(0, 5).join('; ') + '.',
    );
  const updates: Row = { 'erp/_ts': now() };
  for (const target of targets) {
    updates['erp/clientes/' + target.key] = null;
    updates['erp/clientesDeleted/' + target.key] = true;
  }
  await db.ref().update(updates);
  return { action: 'delete', deleted: targets.map(({ key }) => key) };
}

async function mergeInto(db: Database, identity: Identity, input: Row, now: () => number) {
  if (identity.admin !== true) fail(403, 'ADMIN_REQUIRED', 'Apenas a administração pode juntar clientes.');
  const entries = await loadDirectory(db);
  const target = existing(entries, customerId(input.into));
  const origin = input.from ? existing(entries, customerId(input.from)) : null;
  const from = origin ? String(origin.record.nome ?? '') : text(input.fromName);
  const to = String(target.record.nome ?? '');
  if (!from) fail(422, 'MERGE_ORIGIN_REQUIRED', 'Escolha o cliente que vai ser juntado.');
  if (origin?.key === target.key || nameKey(from) === nameKey(to))
    fail(422, 'SAME_CUSTOMER', 'Não dá para juntar o cliente com ele mesmo.');
  const result = moveReferences(await loadReferences(db, true), from, to);
  if (result.invalidKey)
    fail(
      422,
      'INVALID_CUSTOMER_NAME',
      'O nome do cliente principal tem . # $ [ ] /. Renomeie antes de juntar.',
    );
  const updates: Row = { ...prefixed(result.updates), 'erp/_ts': now() };
  if (origin) {
    updates['erp/clientes/' + origin.key] = null;
    updates['erp/clientesDeleted/' + origin.key] = true;
  }
  await db.ref().update(updates);
  return {
    action: 'merge',
    deleted: origin ? [origin.key] : [],
    renamed: { from, to, moved: movedSummary(result.moved) },
    counts: result.moved,
  };
}

function cleanDocs(value: unknown): Row[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_DOCS) fail(422, 'TOO_MANY_DOCUMENTS', 'Limite de 200 documentos por cliente.');
  return list.map((raw: unknown) => {
    const doc = raw && typeof raw === 'object' ? (raw as Row) : {};
    const id = text(doc.id, 120);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) fail(422, 'INVALID_DOCUMENT', 'Documento inválido.');
    const clean: Row = {
      id,
      nomeArq: text(doc.nomeArq, 200),
      categoria: text(doc.categoria, 80),
      data: text(doc.data, 30),
      mimeType: text(doc.mimeType, 100),
    };
    if (doc._nuvem === true) clean._nuvem = true;
    if (doc.venc) clean.venc = text(doc.venc, 30);
    return clean;
  });
}

async function setDocs(db: Database, input: Row, now: () => number) {
  const id = customerId(input.id);
  const docs = cleanDocs(input.docs);
  const current = existing(await loadDirectory(db), id);
  await db.ref().update({
    ['erp/clientes/' + current.key + '/docs']: docs,
    ['erp/clientes/' + current.key + '/_upd']: now(),
    'erp/_ts': now(),
  });
  return { action: 'set-docs', key: current.key, docs };
}

export async function changeCustomer(
  identity: Identity,
  input: unknown,
  { db, now = () => Date.now() }: CustomerDeps = {},
) {
  requireCustomers(identity);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const body = input as Row;
  const instance = await database(db);
  const action = text(body.action, 20);
  const operationId = text(body.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? instance.ref('erp/customerOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  let result: Row;
  if (action === 'create') result = await createOne(instance, identity, body.customer, now);
  else if (action === 'update') result = await updateOne(instance, identity, body, now);
  else if (action === 'delete') result = await deleteMany(instance, body, now);
  else if (action === 'merge') result = await mergeInto(instance, identity, body, now);
  else if (action === 'set-docs') result = await setDocs(instance, body, now);
  else return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  if (opRef) await opRef.set({ result, createdAt: now() });
  return result;
}
