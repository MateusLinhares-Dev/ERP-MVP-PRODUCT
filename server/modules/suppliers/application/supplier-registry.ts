import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { fail } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import { supplierTombstones } from '../domain/supplier-directory.js';
import {
  cleanSupplier,
  documentKey,
  duplicateDocument,
  nameKey,
  nextSupplierCode,
  supplierEntries,
  type Row,
  type StoredSupplier,
} from '../domain/supplier-rules.js';

export interface SupplierDeps {
  db?: Database;
  now?: () => number;
}

const MAX_DELETE = 200;
const MAX_IMPORT = 500;
const MAX_DOCS = 200;
const CODE_ATTEMPTS = 6;

const text = (value: unknown, max = 160): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function code(value: unknown): string {
  const result = text(value, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(result))
    fail(422, 'INVALID_SUPPLIER_CODE', 'Código de fornecedor inválido.');
  return result;
}

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

function requireSuppliers(identity: Identity): void {
  if (identity.erpAccess !== true || identity.canSuppliers !== true)
    fail(403, 'SUPPLIERS_REQUIRED', 'Seu perfil não pode alterar o cadastro de fornecedores.');
}

async function loadDirectory(db: Database) {
  const [suppliersSnap, deletedSnap] = await Promise.all([
    db.ref('erp/fornecedores').get(),
    db.ref('erp/fornDeleted').get(),
  ]);
  return { entries: supplierEntries(suppliersSnap.val()), deleted: supplierTombstones(deletedSnap.val()) };
}

function clean(input: unknown, requireName: boolean) {
  const { fields, problems } = cleanSupplier(input);
  const problem = problems[0];
  if (problem) fail(422, problem.code, problem.message);
  if (requireName && !fields.nome) fail(422, 'SUPPLIER_NAME_REQUIRED', 'Informe o nome do fornecedor.');
  if ('nome' in fields && !fields.nome) fail(422, 'SUPPLIER_NAME_REQUIRED', 'Informe o nome do fornecedor.');
  return fields;
}

function duplicateMessage(found: StoredSupplier): string {
  return `CPF/CNPJ já cadastrado no fornecedor ${text(found.record.cod, 20)} — ${text(found.record.nome)}.`;
}

async function notify(db: Database, now: () => number): Promise<void> {
  await db.ref('erp/_ts').set(now());
}

async function createOne(db: Database, identity: Identity, input: unknown, now: () => number) {
  const fields = clean(input, true);
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const { entries, deleted } = await loadDirectory(db);
    const duplicate = duplicateDocument(entries, deleted, fields);
    if (duplicate) fail(409, 'SUPPLIER_DOCUMENT_EXISTS', duplicateMessage(duplicate));
    const reserved = new Set([...entries.map(({ key, record }) => String(record.cod ?? key)), ...deleted]);
    const cod = nextSupplierCode(reserved);
    const record: Row = {
      ...fields,
      id: cod,
      cod,
      ativo: true,
      criadoEm: new Date(now()).toISOString(),
      criadoPor: text(identity.erpUser || identity.uid, 80),
      _upd: now(),
    };
    const result = await runTransaction(db.ref('erp/fornecedores/' + cod), (previous) =>
      previous === null ? record : undefined,
    );
    if (result.committed) {
      await notify(db, now);
      return { action: 'create', key: cod, supplier: record };
    }
  }
  return fail(409, 'SUPPLIER_CODE_BUSY', 'Outro cadastro foi feito ao mesmo tempo. Tente de novo.');
}

function findByCode(entries: readonly StoredSupplier[], deleted: ReadonlySet<string>, cod: string) {
  const matches = entries.filter(({ record }) => String(record.cod ?? '') === cod);
  if (!matches.length || deleted.has(cod))
    fail(404, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado. Atualize a tela.');
  return matches;
}

async function updateOne(db: Database, identity: Identity, input: Row, now: () => number) {
  const cod = code(input.cod);
  const fields = clean(input.supplier, false);
  const { entries, deleted } = await loadDirectory(db);
  const matches = findByCode(entries, deleted, cod);
  const expected = input.expectedUpdate;
  if (
    expected != null &&
    matches.some(({ record }) => record._upd != null && Number(record._upd) !== Number(expected))
  )
    fail(409, 'SUPPLIER_CHANGED', 'O cadastro foi alterado em outra tela. Atualize e tente de novo.');
  const duplicate = duplicateDocument(entries, deleted, fields, cod);
  if (duplicate) fail(409, 'SUPPLIER_DOCUMENT_EXISTS', duplicateMessage(duplicate));
  const updates: Row = {};
  let supplier: Row = {};
  let key = '';
  for (const match of matches) {
    supplier = {
      ...match.record,
      ...fields,
      cod,
      id: match.record.id ?? match.key,
      alteradoPor: text(identity.erpUser || identity.uid, 80),
      _upd: now(),
    };
    key = match.key;
    updates['erp/fornecedores/' + match.key] = supplier;
  }
  updates['erp/_ts'] = now();
  await db.ref().update(updates);
  return { action: 'update', key, supplier };
}

async function openFinance(db: Database, cod: string): Promise<string[]> {
  const [advancesSnap, repassesSnap, ticketsSnap] = await Promise.all([
    db.ref('erp/adiantamentos/' + cod).get(),
    db.ref('erp/fornecedorRepasses/' + cod).get(),
    db.ref('erp/tickets').get(),
  ]);
  const rows = (value: unknown): Row[] =>
    Object.values(value && typeof value === 'object' ? (value as Row) : {}).filter(
      (item): item is Row => Boolean(item) && typeof item === 'object',
    );
  const reasons: string[] = [];
  if (rows(advancesSnap.val()).some((advance) => advance.status === 'Pendente' && Number(advance.valor) > 0))
    reasons.push('adiantamento em aberto');
  if (rows(repassesSnap.val()).some((repasse) => Number(repasse.saldo) > 0))
    reasons.push('dinheiro a repassar');
  if (
    rows(ticketsSnap.val()).some(
      (ticket) => String(ticket.fornecedorCod ?? '') === cod && Number(ticket.saldoPagar) > 0.005,
    )
  )
    reasons.push('compra com saldo a pagar');
  return reasons;
}

async function deleteMany(db: Database, input: Row, now: () => number) {
  const codes = [...new Set((Array.isArray(input.codes) ? input.codes : []).map(code))];
  if (!codes.length || codes.length > MAX_DELETE)
    fail(422, 'INVALID_SUPPLIER_CODES', 'Selecione de 1 a 200 fornecedores.');
  const { entries, deleted } = await loadDirectory(db);
  for (const cod of codes) findByCode(entries, deleted, cod);
  const active = new Set(
    entries.map(({ record }) => String(record.cod ?? '')).filter((cod) => cod && !deleted.has(cod)),
  );
  if (codes.length >= active.size)
    fail(409, 'SUPPLIER_DELETE_ALL', 'Não é permitido excluir todos os fornecedores de uma vez.');
  const blocked: string[] = [];
  for (const cod of codes) {
    const reasons = await openFinance(db, cod);
    if (reasons.length) {
      const name = text(entries.find(({ record }) => String(record.cod) === cod)?.record.nome);
      blocked.push(`${cod} — ${name} (${reasons.join(', ')})`);
    }
  }
  if (blocked.length)
    fail(
      409,
      'SUPPLIER_HAS_OPEN_FINANCE',
      'Não dá para excluir fornecedor com pendência financeira: ' + blocked.slice(0, 5).join('; ') + '.',
    );
  const updates: Row = Object.fromEntries(codes.map((cod) => ['erp/fornDeleted/' + cod, true]));
  updates['erp/_ts'] = now();
  await db.ref().update(updates);
  return { action: 'delete', deleted: codes };
}

async function restoreAll(db: Database, identity: Identity, now: () => number) {
  if (identity.admin !== true)
    fail(403, 'ADMIN_REQUIRED', 'Apenas a administração pode restaurar fornecedores.');
  const deleted = supplierTombstones((await db.ref('erp/fornDeleted').get()).val());
  await db.ref().update({ 'erp/fornDeleted': null, 'erp/_ts': now() });
  return { action: 'restore-all', restored: [...deleted] };
}

async function importMany(db: Database, identity: Identity, input: Row, now: () => number) {
  const rows = Array.isArray(input.suppliers) ? input.suppliers : [];
  if (!rows.length || rows.length > MAX_IMPORT)
    fail(422, 'INVALID_IMPORT', 'A planilha precisa ter de 1 a 500 fornecedores.');
  const { entries, deleted } = await loadDirectory(db);
  const documents = new Set(
    entries.flatMap(({ record }) => [documentKey(record.cpf), documentKey(record.cnpj)]).filter(Boolean),
  );
  const names = new Set(entries.map(({ record }) => nameKey(record.nome)).filter(Boolean));
  const reserved = new Set([...entries.map(({ key, record }) => String(record.cod ?? key)), ...deleted]);
  const added: Row[] = [];
  const invalid: { row: number; message: string }[] = [];
  let duplicates = 0;
  rows.forEach((raw: unknown, index: number) => {
    const { fields, problems } = cleanSupplier(raw);
    if (!fields.nome || problems.length) {
      invalid.push({ row: index + 1, message: problems[0]?.message || 'Sem nome.' });
      return;
    }
    const keys = [documentKey(fields.cpf), documentKey(fields.cnpj)].filter(Boolean);
    if (keys.some((key) => documents.has(key)) || (!keys.length && names.has(nameKey(fields.nome)))) {
      duplicates++;
      return;
    }
    const cod = nextSupplierCode(reserved);
    reserved.add(cod);
    keys.forEach((key) => documents.add(key));
    names.add(nameKey(fields.nome));
    added.push({
      ...fields,
      id: cod,
      cod,
      ativo: true,
      criadoEm: new Date(now()).toISOString(),
      criadoPor: text(identity.erpUser || identity.uid, 80),
      origem: 'importacao',
      _upd: now(),
    });
  });
  if (added.length) {
    const updates: Row = Object.fromEntries(
      added.map((supplier) => ['erp/fornecedores/' + String(supplier.cod), supplier]),
    );
    for (const supplier of added) {
      const current = (await db.ref('erp/fornecedores/' + String(supplier.cod)).get()).val();
      if (current !== null)
        fail(409, 'SUPPLIER_CODE_BUSY', 'Outro cadastro foi feito ao mesmo tempo. Importe de novo.');
    }
    updates['erp/_ts'] = now();
    await db.ref().update(updates);
  }
  return { action: 'import', added, duplicates, invalid };
}

function cleanDocs(value: unknown): Row[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_DOCS) fail(422, 'TOO_MANY_DOCUMENTS', 'Limite de 200 documentos por fornecedor.');
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
  const cod = code(input.cod);
  const docs = cleanDocs(input.docs);
  const { entries, deleted } = await loadDirectory(db);
  const matches = findByCode(entries, deleted, cod);
  const updates: Row = { 'erp/_ts': now() };
  for (const match of matches) {
    updates['erp/fornecedores/' + match.key + '/docs'] = docs;
    updates['erp/fornecedores/' + match.key + '/_upd'] = now();
  }
  await db.ref().update(updates);
  return { action: 'set-docs', cod, docs };
}

export async function changeSupplier(
  identity: Identity,
  input: unknown,
  { db, now = () => Date.now() }: SupplierDeps = {},
) {
  requireSuppliers(identity);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const body = input as Row;
  const instance = await database(db);
  const action = text(body.action, 20);
  const operationId = text(body.operationId, 40);
  const opRef =
    action !== 'restore-all' && /^[a-f0-9-]{36}$/i.test(operationId)
      ? instance.ref('erp/supplierOperations/' + actorKey(identity) + '_' + operationId)
      : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  let result: Row;
  if (action === 'create') result = await createOne(instance, identity, body.supplier, now);
  else if (action === 'update') result = await updateOne(instance, identity, body, now);
  else if (action === 'delete') result = await deleteMany(instance, body, now);
  else if (action === 'restore-all') result = await restoreAll(instance, identity, now);
  else if (action === 'import') result = await importMany(instance, identity, body, now);
  else if (action === 'set-docs') result = await setDocs(instance, body, now);
  else return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  if (opRef) await opRef.set({ result, createdAt: now() });
  return result;
}
