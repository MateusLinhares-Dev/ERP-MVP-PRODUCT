import { createHash, randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLease } from '../../../shared/firebase/rtdb-transaction.js';

type Row = Record<string, unknown>;

interface RepassePayment {
  id?: string;
  data?: string;
  valor?: number;
  [field: string]: unknown;
}

interface RepasseRecord {
  id?: string;
  operationId?: string;
  fornCod?: string;
  data?: string;
  valor?: number;
  valorPago?: number;
  saldo?: number;
  status?: string;
  versao?: number;
  obs?: string;
  pagamentos?: RepassePayment[];
  criadoEm?: string;
  [field: string]: unknown;
}

export interface RepasseInput {
  action?: unknown;
  fornCod?: unknown;
  operationId?: unknown;
  data?: unknown;
  valor?: unknown;
  obs?: unknown;
  comprovante?: unknown;
  receiptId?: unknown;
  bancoCod?: unknown;
  expectedVersion?: unknown;
}

interface RepasseDeps {
  db?: Database;
  uuid?: () => string;
  now?: () => number;
}

function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

const clean = (value: unknown, max = 180): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function key(value: unknown): string {
  const text = clean(value, 100);
  if (!text || /[.#$[\]/]/.test(text) || hasControlChars(text))
    fail(422, 'INVALID_KEY', 'Identificador inválido.');
  return text;
}

function currency(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100000000 ||
    Math.abs(Math.round(value * 100) - value * 100) > 0.00001
  ) {
    fail(422, 'INVALID_AMOUNT', 'Valor inválido.');
  }
  return Math.round(value * 100);
}

function dateISO(value: unknown): string {
  const text = clean(value, 10);
  const date = new Date(text + 'T12:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    fail(422, 'INVALID_DATE', 'Data inválida.');
  }
  return text;
}

const money = (cents: number): number => Number((cents / 100).toFixed(2));

function authorize(identity: Identity | null | undefined): void {
  if (identity?.erpAccess !== true || (identity.canPayables !== true && identity.canFinance !== true)) {
    fail(403, 'REPASS_PERMISSION_REQUIRED', 'É necessário acesso a Contas a Pagar para registrar repasses.');
  }
}

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

const objects = (raw: unknown): Row[] =>
  Object.values(raw && typeof raw === 'object' ? (raw as Row) : {}).filter(
    (value): value is Row => Boolean(value) && typeof value === 'object',
  );

function supplierExists(raw: unknown, code: string): boolean {
  return objects(raw).some(
    (supplier) =>
      String(supplier.cod || '') === code && supplier.ativo !== false && supplier.excluido !== true,
  );
}

function bankOptions(raw: unknown): { cod: string; banco: string }[] {
  return objects(raw)
    .filter((bank) => !Array.isArray(bank))
    .map((bank) => ({ cod: clean(bank.cod), banco: clean(bank.banco || bank.nome) }))
    .filter((bank) => bank.cod && bank.banco);
}

function visibleReceipt(record: RepasseRecord) {
  return {
    id: record.id,
    operationId: record.operationId,
    fornCod: record.fornCod,
    data: record.data,
    valor: record.valor,
    valorPago: record.valorPago || 0,
    saldo: record.saldo,
    status: record.status,
    versao: record.versao,
    obs: record.obs || '',
    pagamentos: record.pagamentos || [],
    criadoEm: record.criadoEm,
  };
}

async function supplierLock(
  db: Database,
  code: string,
  owner: string,
  now: () => number,
): Promise<Reference> {
  const ref = db.ref('erpSupplierRepasseLocks/' + code);
  const acquired = await acquireLease(ref, owner, { now, ttlMs: 90000, meta: { kind: 'supplier-repasse' } });
  if (!acquired) {
    fail(
      409,
      'SUPPLIER_REPASSE_BUSY',
      'Outro lançamento deste fornecedor está sendo processado. Aguarde alguns segundos e tente novamente.',
    );
  }
  return ref;
}

export async function listSupplierCashRepasses(
  identity: Identity,
  fornCod: unknown,
  { db }: { db?: Database } = {},
) {
  authorize(identity);
  const instance = await database(db);
  const code = key(fornCod);
  const [listSnap, banksSnap] = await Promise.all([
    instance.ref('erp/fornecedorRepasses/' + code).get(),
    instance.ref('erp/bancos').get(),
  ]);
  const records = (objects(listSnap.val()) as RepasseRecord[])
    .map(visibleReceipt)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  return {
    records,
    banks: bankOptions(banksSnap.val()).sort((a, b) => a.banco.localeCompare(b.banco, 'pt-BR')),
    totalEmAberto: money(records.reduce((sum, record) => sum + Math.round(Number(record.saldo) * 100), 0)),
  };
}

export async function summarizeSupplierCashRepasses(identity: Identity, { db }: { db?: Database } = {}) {
  authorize(identity);
  const instance = await database(db);
  const [recordsSnap, suppliersSnap] = await Promise.all([
    instance.ref('erp/fornecedorRepasses').get(),
    instance.ref('erp/fornecedores').get(),
  ]);
  const suppliers = new Map(
    objects(suppliersSnap.val()).map((supplier) => [String(supplier.cod || ''), clean(supplier.nome, 180)]),
  );
  const months: Record<string, { entradas: number; saidas: number }> = {};
  const rows: Row[] = [];
  const add = (date: unknown, kind: 'entradas' | 'saidas', value: unknown): void => {
    const month = String(date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const entry = (months[month] ??= { entradas: 0, saidas: 0 });
    entry[kind] = money(Math.round(entry[kind] * 100) + Math.round(Number(value || 0) * 100));
  };
  for (const [fornCod, group] of Object.entries((recordsSnap.val() ?? {}) as Row)) {
    if (!group || typeof group !== 'object') continue;
    for (const record of objects(group) as RepasseRecord[]) {
      add(record.data, 'entradas', record.valor);
      for (const payment of record.pagamentos ?? []) add(payment.data, 'saidas', payment.valor);
      if (Number(record.saldo) > 0) {
        rows.push({
          fornCod,
          id: record.id,
          nome: suppliers.get(fornCod) || fornCod,
          data: record.data,
          valor: record.valor,
          saldo: record.saldo,
          status: record.status,
        });
      }
    }
  }
  rows.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  return {
    rows,
    months,
    totalEmAberto: money(rows.reduce((sum, row) => sum + Math.round(Number(row.saldo) * 100), 0)),
  };
}

export async function changeSupplierCashRepasse(
  identity: Identity,
  input: RepasseInput,
  { db, uuid = randomUUID, now = () => Date.now() }: RepasseDeps = {},
) {
  authorize(identity);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Dados inválidos.');
  const action = clean(input.action, 12);
  const fornCod = key(input.fornCod);
  const operationId = key(input.operationId);
  if (!/^[a-f\d-]{36}$/i.test(operationId))
    fail(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  if (action !== 'receive' && action !== 'pay') fail(422, 'INVALID_ACTION', 'Operação inválida.');
  const date = dateISO(input.data);
  const amount = currency(input.valor);
  const note = clean(input.obs, 500);
  const comprovante = clean(input.comprovante, 180);
  const actor = clean(identity.uid || identity.erpUser || 'user', 100);
  const tokenId = createHash('sha256')
    .update(actor + '|' + fornCod + '|' + operationId)
    .digest('hex')
    .slice(0, 40);
  const receiptId = action === 'pay' ? key(input.receiptId) : 'RCS-' + tokenId;
  const bankCode = action === 'pay' ? key(input.bancoCod) : '';
  const instance = await database(db);
  const opKey =
    key(String(identity.uid || identity.erpUser || 'user').replace(/[^\w-]/g, '_')) + '_' + operationId;
  const intent = createHash('sha256')
    .update(JSON.stringify([action, fornCod, receiptId, date, amount, bankCode, note, comprovante]))
    .digest('hex');
  const opRef = instance.ref('erp/fornecedorRepasseOperations/' + opKey);
  const replay = (value: unknown): Row | null => {
    const stored = value as { result?: Row; intent?: string } | null;
    if (!stored?.result) return null;
    if (stored.intent !== intent)
      fail(409, 'OPERATION_ID_REUSED', 'Identificador já usado em outro lançamento. Atualize a tela.');
    return { ...stored.result, alreadyCommitted: true };
  };
  const previous = replay((await opRef.get()).val());
  if (previous) return previous;
  const owner = uuid();
  const lock = await supplierLock(instance, fornCod, owner, now);
  let committed = false;
  try {
    const again = replay((await opRef.get()).val());
    if (again) return again;
    const rowRef = instance.ref('erp/fornecedorRepasses/' + fornCod + '/' + receiptId);
    const [recordSnap, supplierSnap, bankSnap] = await Promise.all([
      rowRef.get(),
      action === 'receive' ? instance.ref('erp/fornecedores').get() : Promise.resolve(null),
      action === 'pay' ? instance.ref('erp/bancos').get() : Promise.resolve(null),
    ]);
    const stored = recordSnap.val() as RepasseRecord | null;
    const updates: Row = {};
    let record: RepasseRecord;
    let movement: Row | null = null;
    if (action === 'receive') {
      if (stored)
        fail(409, 'RECEIPT_ALREADY_EXISTS', 'Este recebimento já existe. Atualize a ficha financeira.');
      if (!supplierExists(supplierSnap?.val(), fornCod))
        fail(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado ou inativo.');
      record = {
        id: receiptId,
        operationId,
        fornCod,
        data: date,
        valor: money(amount),
        valorPago: 0,
        saldo: money(amount),
        status: 'Pendente',
        versao: 1,
        obs: note,
        origem: 'Recebimento em espécie para repasse via PIX',
        pagamentos: [],
        criadoEm: new Date(now()).toISOString(),
        criadoPor: clean(identity.erpUser || identity.uid),
      };
      updates['fornecedorRepassesCaixa/' + receiptId] = {
        id: receiptId,
        fornCod,
        data: date,
        tipo: 'Entrada',
        valor: money(amount),
        origem: 'Recebimento para repasse',
        obs: note,
      };
    } else {
      if (!stored || stored.fornCod !== fornCod)
        fail(404, 'RECEIPT_NOT_FOUND', 'Recebimento não encontrado.');
      if (Number(input.expectedVersion) !== Number(stored.versao)) {
        fail(409, 'RECEIPT_CHANGED', 'O saldo foi alterado por outra sessão. Atualize os dados.');
      }
      const balanceCents = Math.round(Number(stored.saldo) * 100);
      if (amount > balanceCents) fail(409, 'OVERPAYMENT', 'Valor do repasse ultrapassa o saldo disponível.');
      const bank = bankOptions(bankSnap?.val()).find((option) => option.cod === bankCode);
      if (!bank) fail(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada.');
      const movementId = 'LB-REP-' + tokenId;
      movement = {
        id: movementId,
        bancoCod: bankCode,
        data: date.split('-').reverse().join('/'),
        tipo: 'Saida',
        valor: money(amount),
        descricao: 'Repasse via PIX ao fornecedor ' + fornCod + ' (recebimento ' + receiptId + ')',
      };
      updates['lancBanco/' + movementId] = movement;
      const payment: RepassePayment = {
        id: operationId,
        data: date,
        valor: money(amount),
        bancoCod: bankCode,
        bancoNome: bank.banco,
        forma: 'PIX',
        movBancoId: movementId,
        comprovante,
        obs: note,
        criadoEm: new Date(now()).toISOString(),
      };
      const remaining = balanceCents - amount;
      record = {
        ...stored,
        valorPago: money(Math.round(Number(stored.valorPago || 0) * 100) + amount),
        saldo: money(remaining),
        status: remaining ? 'Parcial' : 'Quitado',
        versao: Number(stored.versao) + 1,
        pagamentos: [...(Array.isArray(stored.pagamentos) ? stored.pagamentos : []), payment],
      };
    }
    updates['fornecedorRepasses/' + fornCod + '/' + receiptId] = record;
    const result = { record: visibleReceipt(record), movement };
    updates['fornecedorRepasseOperations/' + opKey] = {
      result,
      intent,
      action,
      receiptId,
      criadoEm: new Date(now()).toISOString(),
    };
    updates._ts = now();
    const atomic: Row = Object.fromEntries(
      Object.entries(updates).map(([path, value]) => ['erp/' + path, value]),
    );
    const live = (await lock.get()).val() as { owner?: string } | null;
    if (live?.owner !== owner) {
      fail(
        409,
        'SUPPLIER_REPASSE_BUSY',
        'A reserva deste fornecedor expirou durante o lançamento. Atualize os dados e tente novamente.',
      );
    }
    atomic['erpSupplierRepasseLocks/' + fornCod] = null;
    try {
      await instance.ref().update(atomic);
      committed = true;
    } catch (error) {
      const recovered = (await opRef.get().catch(() => null))?.val() as
        | { result?: Row; intent?: string }
        | null
        | undefined;
      if (recovered?.result && recovered.intent === intent) {
        committed = true;
        return { ...recovered.result, alreadyCommitted: true };
      }
      throw error;
    }
    return { ...result, alreadyCommitted: false };
  } finally {
    if (!committed) await releaseLease(lock, owner, { label: 'supplier.repasse.lock.release' });
  }
}
