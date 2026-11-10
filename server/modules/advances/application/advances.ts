import { createHash, randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { supplierOptions, supplierTombstones } from '../../suppliers/domain/supplier-directory.js';
import {
  advanceChequeRows,
  customerChequeRows,
  serverChequeRows,
  supplierChequeRows,
  supplierNames,
  type ChequeReportRow,
} from '../domain/cheque-report.js';
import {
  advanceRecords,
  amount,
  assertLinkedBankMovement,
  bankEntries,
  chequeFingerprint,
  clean,
  expectedMatches,
  failure,
  isoDate,
  operationKeyOf,
  pathKey,
  requireFinance,
  supplierExists,
  supplierNamed,
  toDisplayDate,
  type AdvanceRecord,
  type ChequeRecord,
  type Row,
} from '../domain/advance-rules.js';
import {
  acquireAdvanceLock,
  commitAdvanceAndRelease,
  releaseAdvanceLocks,
} from '../infrastructure/advance-locks.js';

export { supplierOptions, supplierTombstones } from '../../suppliers/domain/supplier-directory.js';

export interface AdvanceDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface ChequeInput {
  b: string;
  n: string;
  v: number;
  d: string;
  venc: string;
  cli: string;
}

interface StoredOperation {
  advance?: AdvanceRecord;
  bankMovement?: Row | null;
  cheques?: ChequeRecord[];
  requestFingerprint?: string;
  fornCod?: string;
  action?: string;
  adtCod?: string;
  result?: ChangeReceipt;
  createdAt?: string;
}

interface ChangeReceipt {
  action: string;
  advance: AdvanceRecord | null;
  removedCode: string | null;
  bankMovement: Row | null;
  movementRemovedId: string;
  fornCod: string;
  newFornCod: string;
  restoredDeletion?: boolean;
}

const PAYMENT_FORMS = ['PIX', 'TED', 'Dinheiro', 'Cheque', 'Cheque de Terceiro'];
const EDIT_FORMS = ['PIX', 'TED', 'Dinheiro', 'Cheque', 'Cheque de Terceiro', 'Transferência', 'Crédito'];
const BANK_TRANSFER_FORMS = ['PIX', 'TED', 'Dinheiro', 'Transferência'];
const CHEQUE_FORMS = ['Cheque', 'Cheque de Terceiro'];
const GLOBAL_CHEQUES = '__global_cheques__';
const OPERATIONS_PATH = 'erp/financeAdvanceOperations/';

async function resolveDatabase(db?: Database): Promise<Database> {
  if (db) return db;
  const { getFirebaseAdmin } = await import('../../../shared/firebase/firebase-admin.js');
  return getFirebaseAdmin().db;
}

const lower = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR');

function inProgress(message: string, active: unknown, now: () => number): AppError {
  const seconds = Math.ceil((Number((active as { expiresAt?: unknown } | null)?.expiresAt) - now()) / 1000);
  return new AppError(
    409,
    'ADVANCE_IN_PROGRESS',
    message,
    Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.min(seconds, 120) } : {},
  );
}

export async function listAdvanceBankOptions(identity: Identity, { db }: { db?: Database } = {}) {
  requireFinance(identity);
  const instance = await resolveDatabase(db);
  const paths = [
    'erp/bancos',
    'erp/fornecedores',
    'erp/fornDeleted',
    'erp/fornDeletedV2',
    'erp/fornecedoresDeleted',
    'erp/fornecedoresDeletedV2',
  ];
  const values = (await Promise.all(paths.map((path) => instance.ref(path).get()))).map((snap): unknown =>
    snap.val(),
  );
  const banks = bankEntries(values[0]).map(({ cod, banco }) => ({ cod, banco }));
  banks.sort((a, b) => a.banco.localeCompare(b.banco, 'pt-BR') || a.cod.localeCompare(b.cod, 'pt-BR'));
  const deletedCodes = new Set([...supplierTombstones(values[2]), ...supplierTombstones(values[3])]);
  const deletedIds = new Set([...supplierTombstones(values[4]), ...supplierTombstones(values[5])]);
  return { banks, suppliers: supplierOptions(values[1], deletedCodes, deletedIds) };
}

export async function listAdvanceCheques(identity: Identity, { db }: { db?: Database } = {}) {
  requireFinance(identity);
  const instance = await resolveDatabase(db);
  const paths = [
    'erp/chequesControle',
    'erp/chequesControle_del',
    'erp/cheques',
    'erp/chequesPorFornDeleted',
    'erp/adiantamentos',
    'erp/adtPorFornDeleted',
    'erp/fornecedores',
  ];
  const [
    control,
    controlDeleted,
    supplierCheques,
    supplierChequesDeleted,
    advances,
    advancesDeleted,
    suppliers,
  ] = (await Promise.all(paths.map((path) => instance.ref(path).get()))).map((snap): unknown => snap.val());
  const names = supplierNames(suppliers);
  const rows: ChequeReportRow[] = [
    ...serverChequeRows(control, controlDeleted),
    ...supplierChequeRows(supplierCheques, names, supplierChequesDeleted),
    ...advanceChequeRows(advances, names, advancesDeleted),
  ];
  if (identity.canFinance === true) {
    rows.push(...customerChequeRows((await instance.ref('erp/chequesCli').get()).val()));
  }
  return { cheques: rows };
}

export async function getAdvanceOperationStatus(
  identity: Identity,
  input: { operationId?: unknown; fornCod?: unknown } | null,
  { db, now = () => Date.now() }: { db?: Database; now?: () => number } = {},
) {
  requireFinance(identity);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    failure(400, 'INVALID_INPUT', 'Dados inválidos.');
  const operationId = pathKey(input.operationId);
  if (!/^[a-f\d-]{36}$/i.test(operationId))
    failure(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  const fornCod = pathKey(input.fornCod);
  const instance = await resolveDatabase(db);
  const record = (
    await instance.ref(OPERATIONS_PATH + operationKeyOf(identity, operationId)).get()
  ).val() as StoredOperation | null;
  if (record?.advance) {
    if (record.fornCod && record.fornCod !== fornCod) {
      failure(409, 'ADVANCE_SUPPLIER_MISMATCH', 'Operação não corresponde ao fornecedor selecionado.');
    }
    const entries = advanceRecords((await instance.ref('erp/adiantamentos/' + fornCod).get()).val());
    if (!entries.some((entry) => entry.cod === record.advance?.cod)) {
      failure(409, 'ADVANCE_SUPPLIER_MISMATCH', 'Operação não corresponde ao fornecedor selecionado.');
    }
    return {
      state: 'confirmed',
      advance: record.advance,
      bankMovement: record.bankMovement || null,
      cheques: record.cheques || [],
      entries,
      alreadyCommitted: true,
    };
  }
  const lock = (await instance.ref('erpFinanceAdvanceLocks/' + fornCod).get()).val() as {
    expiresAt?: unknown;
  } | null;
  const remaining = Number(lock?.expiresAt) - now();
  if (Number.isFinite(remaining) && remaining > 0) {
    return { state: 'processing', retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
  }
  return { state: 'not_found' };
}

function parseCheques(input: Row, forma: string, date: string, value: number): ChequeInput[] {
  const items = input.cheques;
  if (!Array.isArray(items) || items.length === 0 || items.length > 200)
    failure(422, 'INVALID_CHEQUES', 'Informe de 1 a 200 cheques.');
  const cheques = items.map((raw: unknown): ChequeInput => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      failure(422, 'INVALID_CHEQUE', 'Cheque inválido.');
    const row = raw as Row;
    const bank = clean(row.b, 120);
    const number = clean(row.n, 40);
    if (!bank || !/^[a-zA-Z0-9_-]{1,40}$/.test(number))
      failure(422, 'INVALID_CHEQUE', 'Informe banco e número do cheque válidos.');
    return {
      b: bank,
      n: number,
      v: amount(row.v),
      d: row.d ? isoDate(row.d) : date,
      venc: row.venc ? isoDate(row.venc) : '',
      cli: clean(row.cli, 180),
    };
  });
  const totalCents = cheques.reduce((sum, cheque) => sum + Math.round(cheque.v * 100), 0);
  if (totalCents !== Math.round(value * 100)) {
    failure(422, 'CHEQUE_TOTAL_MISMATCH', 'A soma dos cheques deve ser igual ao valor do adiantamento.');
  }
  const ids = new Set<string>();
  const duplicateRows: ChequeInput[] = [];
  for (const cheque of cheques) {
    if (forma === 'Cheque de Terceiro' && !cheque.cli) {
      failure(422, 'CHEQUE_DRAWER_REQUIRED', 'Informe o dono/emitente de cada cheque de terceiro.');
    }
    const key = (cheque.b + '|' + cheque.n).toLocaleLowerCase('pt-BR');
    if (ids.has(key)) {
      if (forma === 'Cheque')
        failure(
          409,
          'DUPLICATE_CHEQUE',
          'Cheque próprio repetido na lista: ' + cheque.b + ' nº ' + cheque.n + '.',
        );
      duplicateRows.push(cheque);
    }
    ids.add(key);
  }
  const firstDuplicate = duplicateRows[0];
  if (firstDuplicate && input.confirmDuplicates !== true) {
    failure(
      409,
      'CHEQUE_DUPLICATE_CONFIRMATION_REQUIRED',
      'Há ' +
        duplicateRows.length +
        ' cheque(s) de terceiro com banco e número repetidos nesta lista (ex.: ' +
        firstDuplicate.b +
        ' nº ' +
        firstDuplicate.n +
        '). Confirme conscientemente para continuar.',
    );
  }
  return cheques;
}

export async function createAdvance(
  identity: Identity,
  input: Row,
  { db, now = () => Date.now(), uuid = randomUUID }: AdvanceDeps = {},
) {
  requireFinance(identity);
  const instance = await resolveDatabase(db);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    failure(400, 'INVALID_INPUT', 'Dados de adiantamento inválidos.');
  const operationId = pathKey(input.operationId);
  if (!/^[a-f\d-]{36}$/i.test(operationId))
    failure(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  const fornCod = pathKey(input.fornCod);
  const date = isoDate(input.data);
  const value = amount(input.valor);
  const forma = clean(input.forma, 30);
  const isCheque = CHEQUE_FORMS.includes(forma);
  if (!PAYMENT_FORMS.includes(forma)) failure(422, 'INVALID_PAYMENT_METHOD', 'Forma de pagamento inválida.');
  const bankCode = isCheque ? '' : pathKey(input.bancoCod);
  const ticket = clean(input.ticket, 100);
  const empresa = clean(input.empresa, 120);
  const obs = clean(input.obs, 1000);
  const chequeSituation = clean(input.chequeSituation || 'A', 1);
  if (isCheque && !['A', 'C'].includes(chequeSituation))
    failure(422, 'INVALID_CHEQUE_STATUS', 'Situação do cheque inválida.');
  const confirmDuplicates = input.confirmDuplicates === true;
  const cheques = isCheque ? parseCheques(input, forma, date, value) : [];
  const requestFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        fornCod,
        date,
        value,
        forma,
        bankCode,
        ticket,
        empresa,
        obs,
        chequeSituation: isCheque ? chequeSituation : '',
        cheques: isCheque ? cheques : [],
      }),
    )
    .digest('hex');
  const operationKey = operationKeyOf(identity, operationId);
  const opRef = instance.ref(OPERATIONS_PATH + operationKey);
  const replay = async (record: StoredOperation | null) => {
    if (!record?.advance) return null;
    if (record.requestFingerprint && record.requestFingerprint !== requestFingerprint) {
      failure(409, 'OPERATION_REUSED', 'A identificação já foi usada por outro adiantamento.');
    }
    return {
      advance: record.advance,
      bankMovement: record.bankMovement || null,
      cheques: record.cheques || [],
      entries: advanceRecords((await instance.ref('erp/adiantamentos/' + fornCod).get()).val()),
      alreadyCommitted: true,
    };
  };
  const existing = await replay((await opRef.get()).val() as StoredOperation | null);
  if (existing) return existing;
  const owner = uuid();
  const locks: Reference[] = [];
  const keys = (isCheque ? [fornCod, GLOBAL_CHEQUES] : [fornCod]).sort();
  let committedAndUnlocked = false;
  try {
    for (const key of keys) {
      const lockRef = instance.ref('erpFinanceAdvanceLocks/' + key);
      const acquired = await acquireAdvanceLock(lockRef, owner, now, {
        db: instance,
        operationKey,
        fornCod,
        kind: 'create',
        requestFingerprint,
      });
      if (!acquired) {
        const active: unknown = (await lockRef.get()).val();
        const wait = Math.max(
          1,
          Math.ceil((Number((active as { expiresAt?: unknown } | null)?.expiresAt) - now()) / 1000),
        );
        throw new AppError(
          409,
          'ADVANCE_IN_PROGRESS',
          'Outra operação financeira está em andamento. Aguarde a confirmação antes de tentar novamente.',
          Number.isFinite(wait) ? { retryAfterSeconds: Math.min(wait, 120) } : {},
        );
      }
      locks.push(lockRef);
    }
    const committed = await replay((await opRef.get()).val() as StoredOperation | null);
    if (committed) return committed;
    const [banksSnap, suppliersSnap, advancesSnap, chequesSnap] = await Promise.all([
      isCheque ? Promise.resolve(null) : instance.ref('erp/bancos').get(),
      instance.ref('erp/fornecedores').get(),
      instance.ref('erp/adiantamentos/' + fornCod).get(),
      isCheque ? instance.ref('erp/chequesControle').get() : Promise.resolve(null),
    ]);
    const suppliers: unknown = suppliersSnap.val();
    if (!supplierExists(suppliers, fornCod))
      failure(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado no Firebase.');
    const bank = isCheque ? null : bankEntries(banksSnap?.val()).find((option) => option.cod === bankCode);
    if (!isCheque && !bank)
      failure(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada ou removida. Atualize a lista.');
    const records = advanceRecords(advancesSnap.val());
    const id = 'ADT' + now().toString(36).toUpperCase() + uuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    const dataFmt = toDisplayDate(date);
    const supplier = supplierNamed(suppliers, fornCod);
    const advance: AdvanceRecord = {
      cod: id,
      data: dataFmt,
      valor: value,
      status: 'Pendente',
      ticket,
      forma,
      bancoCod: bank?.cod || '',
      bancoNome: bank?.banco || 'Não informado',
      empresa,
      obs,
    };
    const updates: Row = {};
    let movement: Row | null = null;
    const createdCheques: ChequeRecord[] = [];
    if (isCheque) {
      const storedCheques = (chequesSnap?.val() ?? {}) as Record<string, unknown>;
      const previousCheques = Object.values(storedCheques).filter(
        (cheque): cheque is ChequeRecord => Boolean(cheque) && typeof cheque === 'object',
      );
      for (const [chequeIndex, cheque] of cheques.entries()) {
        const duplicatedInBatch = cheques
          .slice(0, chequeIndex)
          .some((old) => lower(old.b) === lower(cheque.b) && lower(old.n) === lower(cheque.n));
        const duplicated = previousCheques.some(
          (old) => lower(old.b) === lower(cheque.b) && lower(old.n) === lower(cheque.n),
        );
        if (duplicated && forma === 'Cheque') {
          failure(
            409,
            'CHEQUE_ALREADY_EXISTS',
            'Cheque próprio ' + cheque.n + ' de ' + cheque.b + ' já cadastrado.',
          );
        }
        if (duplicated && !confirmDuplicates) {
          failure(
            409,
            'CHEQUE_DUPLICATE_CONFIRMATION_REQUIRED',
            'Cheque de terceiro nº ' +
              cheque.n +
              ' do banco ' +
              cheque.b +
              ' já existe. Confira o emitente (' +
              cheque.cli +
              '), valor e documento e confirme para manter ambos.',
          );
        }
        const slug =
          cheque.b
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 8)
            .toUpperCase() || 'XX';
        const chequeId =
          'CC' +
          slug +
          cheque.n +
          '-' +
          uuid().replace(/-/g, '').slice(0, 12) +
          '-' +
          chequeIndex.toString(36);
        if (
          chequeId.length > 100 ||
          createdCheques.some((item) => item.id === chequeId) ||
          storedCheques[chequeId]
        ) {
          failure(409, 'CHEQUE_ID_CONFLICT', 'Identificador de cheque já utilizado.');
        }
        const issued = toDisplayDate(cheque.d);
        const supplierName = clean(supplier?.nome, 240) || fornCod;
        const record: ChequeRecord = {
          id: chequeId,
          b: cheque.b,
          n: cheque.n,
          c: cheque.cli ? cheque.cli + ' → ' + supplierName : supplierName,
          emitente: cheque.cli,
          dest: supplierName,
          v: cheque.v,
          d: issued,
          venc: cheque.venc ? toDisplayDate(cheque.venc) : '',
          cd: chequeSituation === 'C' ? issued : '',
          s: chequeSituation,
          dc: true,
          advanceCode: id,
          fornCod,
          tipoCheque: forma,
          duplicidadeConfirmada: Boolean(duplicated || duplicatedInBatch),
        };
        if (empresa) record.origem = empresa;
        createdCheques.push(record);
        updates['chequesControle/' + chequeId] = record;
      }
      advance.chequeIds = createdCheques.map((cheque) => String(cheque.id));
      advance.chequeFingerprints = Object.fromEntries(
        createdCheques.map((cheque) => [String(cheque.id), chequeFingerprint(cheque)]),
      );
    } else if (bank) {
      const movementId = 'LB-' + now() + '-' + uuid().replace(/-/g, '').slice(0, 8);
      advance.movBancoId = movementId;
      movement = {
        id: movementId,
        bancoCod: bank.cod,
        data: dataFmt,
        descricao:
          'Adiantamento: ' + (clean(supplier?.nome) || fornCod) + (ticket ? ' Ticket ' + ticket : ''),
        tipo: 'Saida',
        valor: value,
        advanceCode: id,
        source: 'advance',
      };
      updates['lancBanco/' + movementId] = movement;
    }
    const entries = [...records, advance];
    updates['adiantamentos/' + fornCod] = entries;
    updates['financeAdvanceOperations/' + operationKey] = {
      advance,
      bankMovement: movement,
      cheques: createdCheques,
      requestFingerprint,
      fornCod,
      createdAt: new Date(now()).toISOString(),
      createdBy: clean(identity.erpUser || identity.uid),
    };
    updates._ts = now();
    await commitAdvanceAndRelease(instance, updates, keys, owner, now);
    committedAndUnlocked = true;
    return { advance, bankMovement: movement, cheques: createdCheques, entries, alreadyCommitted: false };
  } finally {
    if (!committedAndUnlocked) await releaseAdvanceLocks(locks, owner);
  }
}

interface RestoreContext {
  db: Database;
  now: () => number;
  uuid: () => string;
  fornCod: string;
  adtCod: string;
  previous: AdvanceRecord;
  operationKey: string;
}

const REFERENCED_PATHS = [
  'tickets',
  'contasPagar',
  'chequesControle',
  'chequesCli',
  'financePayableOperations',
  'purchaseCreateOperations',
  'purchaseEditOperations',
  'saldoDevedor',
  'saldos',
  'cheques',
];

async function restoreConfirmedDelete(identity: Identity, context: RestoreContext) {
  const { db, now, uuid, fornCod, adtCod, previous, operationKey } = context;
  const movementId = clean(previous.movBancoId || '');
  if (
    !movementId ||
    previous.status !== 'Pendente' ||
    previous.ticket ||
    previous.ticketOrigem ||
    previous.adiantamentoOrigem ||
    Number(previous.valorCompensado || 0) > 0 ||
    Number(previous.valorAplicado || 0) > 0 ||
    previous.origem ||
    previous.chequeIds?.length
  ) {
    return null;
  }
  const operations = ((await db.ref('erp/financeAdvanceOperations').get()).val() ?? {}) as Record<
    string,
    unknown
  >;
  const related = Object.values(operations).filter(
    (receipt): receipt is StoredOperation =>
      Boolean(receipt) &&
      typeof receipt === 'object' &&
      ((receipt as StoredOperation).adtCod === adtCod ||
        (receipt as StoredOperation).advance?.cod === adtCod ||
        (receipt as StoredOperation).result?.removedCode === adtCod),
  );
  const creates = related.filter((receipt) => {
    const advance = receipt.advance;
    if (
      advance?.cod !== adtCod ||
      receipt.action ||
      receipt.result ||
      String(advance.movBancoId || '') !== movementId ||
      Number(advance.valor) !== Number(previous.valor) ||
      String(advance.bancoCod || '') !== String(previous.bancoCod || '')
    ) {
      return false;
    }
    return (
      receipt.fornCod == null || String(receipt.fornCod).trim() === '' || String(receipt.fornCod) === fornCod
    );
  });
  const deletes = related.filter(
    (receipt) =>
      receipt.action === 'delete' &&
      receipt.result?.removedCode === adtCod &&
      receipt.result.fornCod === fornCod &&
      receipt.result.movementRemovedId === movementId,
  );
  const created = creates.length === 1 ? creates[0] : undefined;
  if (
    !created ||
    deletes.length === 0 ||
    related.some((receipt) => !creates.includes(receipt) && !deletes.includes(receipt))
  ) {
    return null;
  }
  const createdAt = Date.parse(created.createdAt || '');
  if (
    !Number.isFinite(createdAt) ||
    deletes.some(
      (receipt) =>
        !Number.isFinite(Date.parse(receipt.createdAt || '')) ||
        Date.parse(String(receipt.createdAt)) < createdAt,
    )
  ) {
    return null;
  }
  const deletion = deletes.reduce((latest, current) =>
    Date.parse(String(current.createdAt)) > Date.parse(String(latest.createdAt)) ? current : latest,
  );
  const lockRef = db.ref('erpFinanceAdvanceLocks/' + fornCod);
  const owner = uuid();
  const acquired = await acquireAdvanceLock(lockRef, owner, now, {
    db,
    operationKey,
    fornCod,
    kind: 'change',
  });
  if (!acquired) failure(409, 'ADVANCE_IN_PROGRESS', 'Aguarde a conclusão da operação anterior.');
  let committed = false;
  try {
    const source = advanceRecords((await db.ref('erp/adiantamentos/' + fornCod).get()).val());
    const matches = source.filter((row) => row.cod === adtCod);
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match || !expectedMatches(match, previous))
      failure(409, 'ADVANCE_CHANGED', 'O adiantamento foi alterado. Atualize a consulta.');
    if ((await db.ref('erp/lancBanco/' + pathKey(movementId)).get()).val()) {
      failure(409, 'BANK_LEDGER_CHANGED', 'O lançamento bancário reapareceu; é necessária conferência.');
    }
    const readings = await Promise.all(REFERENCED_PATHS.map((path) => db.ref('erp/' + path).get()));
    for (const reading of readings) {
      if (JSON.stringify(reading.val() ?? null).includes(JSON.stringify(adtCod))) {
        failure(
          409,
          'ADVANCE_USED',
          'Encontrada utilização financeira posterior; não é possível remover automaticamente.',
        );
      }
    }
    const fullLedger = ((await db.ref('erp/lancBanco').get()).val() ?? {}) as Record<string, unknown>;
    if (
      Object.values(fullLedger).some((item) => {
        const movement = item as Row | null;
        return (
          Boolean(movement) &&
          (String(movement?.advanceCode || '') === adtCod || String(movement?.id || '') === movementId)
        );
      })
    ) {
      failure(409, 'BANK_LEDGER_CHANGED', 'Outro movimento bancário pode estar vinculado ao adiantamento.');
    }
    const tombstone = {
      removedAt: now(),
      removedCode: adtCod,
      movementRemovedId: movementId,
      reason: 'confirmed_delete_receipt_reappeared',
      originalDeletedAt: deletion.createdAt || null,
    };
    const receipt: ChangeReceipt = {
      action: 'delete',
      advance: null,
      removedCode: adtCod,
      bankMovement: null,
      movementRemovedId: movementId,
      fornCod,
      newFornCod: fornCod,
      restoredDeletion: true,
    };
    const entries = source.filter((row) => row.cod !== adtCod);
    await commitAdvanceAndRelease(
      db,
      {
        ['adiantamentos/' + fornCod]: entries,
        ['financeAdvanceDeleted/' + fornCod + '/' + adtCod]: tombstone,
        ['financeAdvanceOperations/' + operationKey]: {
          action: 'delete',
          adtCod,
          result: receipt,
          createdAt: new Date(now()).toISOString(),
          createdBy: clean(identity.erpUser),
          recoveredFromReceipt: true,
        },
        _ts: now(),
      },
      [fornCod],
      owner,
      now,
    );
    committed = true;
    return { ...receipt, entries, targetEntries: null, alreadyCommitted: false };
  } finally {
    if (!committed) await releaseAdvanceLocks([lockRef], owner);
  }
}

export async function changeAdvance(
  identity: Identity,
  input: Row,
  { db, now = () => Date.now(), uuid = randomUUID }: AdvanceDeps = {},
) {
  requireFinance(identity);
  const instance = await resolveDatabase(db);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    failure(400, 'INVALID_INPUT', 'Dados inválidos.');
  const action = clean(input.action, 10);
  if (action !== 'edit' && action !== 'delete') failure(422, 'INVALID_ACTION', 'Ação não permitida.');
  const fornCod = pathKey(input.fornCod);
  const adtCod = pathKey(input.adtCod);
  const newFornCod = action === 'edit' && input.newFornCod ? pathKey(input.newFornCod) : fornCod;
  const operationId = pathKey(input.operationId);
  if (!/^[a-f\d-]{36}$/i.test(operationId))
    failure(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  const operationKey = operationKeyOf(identity, operationId);
  const opRef = instance.ref(OPERATIONS_PATH + operationKey);
  const replay = async (record: StoredOperation | null) => {
    if (record?.action !== action || record.adtCod !== adtCod || !record.result) return null;
    const receipt = record.result;
    const [source, target] = await Promise.all([
      instance.ref('erp/adiantamentos/' + receipt.fornCod).get(),
      receipt.newFornCod !== receipt.fornCod
        ? instance.ref('erp/adiantamentos/' + receipt.newFornCod).get()
        : Promise.resolve(null),
    ]);
    return {
      ...receipt,
      entries: advanceRecords(source.val()),
      targetEntries: target ? advanceRecords(target.val()) : null,
      alreadyCommitted: true,
    };
  };
  const existing = await replay((await opRef.get()).val() as StoredOperation | null);
  if (existing) return existing;
  const candidate = advanceRecords((await instance.ref('erp/adiantamentos/' + fornCod).get()).val()).find(
    (row) => String(row.cod) === adtCod,
  );
  if (
    action === 'delete' &&
    candidate &&
    expectedMatches(candidate, input.expected) &&
    candidate.movBancoId
  ) {
    const bankMovement: unknown = (
      await instance.ref('erp/lancBanco/' + pathKey(candidate.movBancoId)).get()
    ).val();
    if (!bankMovement) {
      const repaired = await restoreConfirmedDelete(identity, {
        db: instance,
        now,
        uuid,
        fornCod,
        adtCod,
        previous: candidate,
        operationKey,
      });
      if (repaired) return repaired;
    }
  }
  if (candidate && expectedMatches(candidate, input.expected)) {
    if (Number(candidate.valorCompensado || 0) > 0 || candidate.origem === 'compensacao_cp') {
      failure(
        409,
        'ADVANCE_ALREADY_COMPENSATED',
        'Adiantamento já compensado total ou parcialmente. Para alterar ou excluir, faça o estorno financeiro auditado.',
      );
    }
    if (candidate.movBancoId) {
      assertLinkedBankMovement(
        candidate,
        (await instance.ref('erp/lancBanco/' + pathKey(candidate.movBancoId)).get()).val(),
      );
    }
  }
  const touchesCheques = Boolean(
    candidate &&
      ((Array.isArray(candidate.chequeIds) && candidate.chequeIds.length > 0) ||
        CHEQUE_FORMS.includes(String(candidate.forma))),
  );
  const keys = [...new Set([fornCod, newFornCod, ...(touchesCheques ? [GLOBAL_CHEQUES] : [])])].sort();
  const owner = uuid();
  const locks: Reference[] = [];
  let committedAndUnlocked = false;
  try {
    for (const key of keys) {
      const lockRef = instance.ref('erpFinanceAdvanceLocks/' + key);
      const acquired = await acquireAdvanceLock(lockRef, owner, now, {
        db: instance,
        operationKey,
        fornCod: key,
        kind: 'change',
      });
      if (!acquired) {
        const active = (await lockRef.get()).val() as { kind?: unknown } | null;
        const error = inProgress(
          'Outra alteração financeira ainda está em processamento para este fornecedor.',
          active,
          now,
        );
        console.warn('finance.advance.change.lock_busy', {
          scope: key === GLOBAL_CHEQUES ? 'cheques' : 'fornecedor',
          kind: String(active?.kind || 'sem_metadados'),
          retryAfterSeconds: error.retryAfterSeconds || null,
        });
        throw error;
      }
      locks.push(lockRef);
    }
    const again = await replay((await opRef.get()).val() as StoredOperation | null);
    if (again) return again;
    const [sourceSnap, targetSnap, banksSnap, suppliersSnap] = await Promise.all([
      instance.ref('erp/adiantamentos/' + fornCod).get(),
      newFornCod === fornCod ? Promise.resolve(null) : instance.ref('erp/adiantamentos/' + newFornCod).get(),
      instance.ref('erp/bancos').get(),
      instance.ref('erp/fornecedores').get(),
    ]);
    const source = advanceRecords(sourceSnap.val());
    const matches = source.filter((advance) => String(advance.cod) === adtCod);
    const previous = matches.length === 1 ? matches[0] : undefined;
    if (!previous)
      failure(409, 'ADVANCE_CHANGED', 'Adiantamento não encontrado ou duplicado. Atualize os dados.');
    if (!expectedMatches(previous, input.expected)) {
      failure(
        409,
        'ADVANCE_CHANGED',
        'O adiantamento foi alterado por outra sessão. Atualize antes de salvar.',
      );
    }
    if (Number(previous.valorCompensado || 0) > 0 || previous.origem === 'compensacao_cp') {
      failure(
        409,
        'ADVANCE_ALREADY_COMPENSATED',
        'Adiantamento já compensado total ou parcialmente. Para alterar ou excluir, faça o estorno financeiro auditado.',
      );
    }
    const suppliers: unknown = suppliersSnap.val();
    if (newFornCod !== fornCod && !supplierExists(suppliers, newFornCod)) {
      failure(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor de destino não encontrado.');
    }
    const oldMovementId = clean(previous.movBancoId || '');
    const originalMovement: unknown = oldMovementId
      ? (await instance.ref('erp/lancBanco/' + pathKey(oldMovementId)).get()).val()
      : null;
    assertLinkedBankMovement(previous, originalMovement);
    let changed: AdvanceRecord | null = null;
    let movement: Row | null = null;
    let movementRemovedId = '';
    const updates: Row = {};
    const linkedChequeIds = Array.isArray(previous.chequeIds) ? previous.chequeIds.map(pathKey) : [];
    if (CHEQUE_FORMS.includes(String(previous.forma)) && !linkedChequeIds.length) {
      failure(
        409,
        'LEGACY_CHEQUE_RESTRICTED',
        'Adiantamento legado com cheque exige conferência manual antes da alteração.',
      );
    }
    if (linkedChequeIds.length) {
      for (const chequeId of linkedChequeIds) {
        const cheque = (
          await instance.ref('erp/chequesControle/' + chequeId).get()
        ).val() as ChequeRecord | null;
        if (cheque && cheque.advanceCode === adtCod && cheque.s === 'C') {
          failure(
            409,
            'CHEQUE_ALREADY_CLEARED',
            'O cheque nº ' +
              clean(cheque.n, 40) +
              ' deste adiantamento já foi compensado. Para alterar ou excluir o adiantamento, primeiro reabra o cheque em "Cheques a compensar".',
          );
        }
        if (
          !cheque ||
          cheque.advanceCode !== adtCod ||
          cheque.fornCod !== fornCod ||
          !previous.chequeFingerprints ||
          chequeFingerprint(cheque) !== previous.chequeFingerprints[chequeId]
        ) {
          failure(
            409,
            'CHEQUE_LEDGER_CHANGED',
            'Cheque vinculado foi alterado. A operação foi bloqueada para evitar divergências.',
          );
        }
      }
      if (action === 'edit') {
        failure(
          409,
          'CHEQUE_EDIT_RESTRICTED',
          'Para alterar um adiantamento com cheques vinculados, exclua o lançamento e cadastre os cheques novamente.',
        );
      }
      for (const chequeId of linkedChequeIds) updates['chequesControle/' + chequeId] = null;
    }
    const nextSource = source.filter((advance) => String(advance.cod) !== adtCod);
    if (action === 'edit') {
      const date = isoDate(input.data);
      const value = amount(input.valor);
      const forma = clean(input.forma, 30);
      if (!EDIT_FORMS.includes(forma)) failure(422, 'INVALID_PAYMENT_METHOD', 'Forma de pagamento inválida.');
      const isBankTransfer = BANK_TRANSFER_FORMS.includes(forma);
      if (CHEQUE_FORMS.includes(forma)) {
        failure(
          422,
          'CHEQUE_EDIT_RESTRICTED',
          'Não é possível transformar um adiantamento em cheque pela edição. Cadastre os cheques pela operação específica.',
        );
      }
      const bankCode = isBankTransfer ? pathKey(input.bancoCod) : '';
      const bank = isBankTransfer
        ? bankEntries(banksSnap.val()).find((option) => option.cod === bankCode)
        : null;
      if (isBankTransfer && !bank) failure(422, 'BANK_NOT_FOUND', 'Conta bancária não encontrada.');
      if (isBankTransfer && !oldMovementId && previous.bancoNome && previous.bancoNome !== 'Não informado') {
        failure(
          409,
          'LEGACY_LEDGER_NOT_LINKED',
          'Adiantamento antigo sem movimento bancário vinculado. Solicite conciliação antes de alterar.',
        );
      }
      const status = clean(input.status, 20);
      if (!['Pendente', 'Quitado'].includes(status)) failure(422, 'INVALID_STATUS', 'Status inválido.');
      const dataFmt = toDisplayDate(date);
      changed = {
        ...previous,
        data: dataFmt,
        valor: value,
        forma,
        status,
        bancoCod: bank?.cod || '',
        bancoNome: bank?.banco || 'Não informado',
        empresa: clean(input.empresa, 120),
        ticket: clean(input.ticket, 100),
        obs: clean(input.obs, 1000),
      };
      if (isBankTransfer && bank) {
        const movementId = oldMovementId || 'LB-' + now() + '-' + uuid().replace(/-/g, '').slice(0, 8);
        changed.movBancoId = movementId;
        const supplier = supplierNamed(suppliers, newFornCod);
        movement = {
          id: movementId,
          bancoCod: bank.cod,
          data: dataFmt,
          descricao:
            'Adiantamento: ' +
            (clean(supplier?.nome) || newFornCod) +
            (changed.ticket ? ' Ticket ' + changed.ticket : ''),
          tipo: 'Saida',
          valor: value,
          advanceCode: adtCod,
          source: 'advance',
        };
        updates['lancBanco/' + movementId] = movement;
      } else {
        delete changed.movBancoId;
        if (oldMovementId) {
          movementRemovedId = oldMovementId;
          updates['lancBanco/' + oldMovementId] = null;
        }
      }
    } else if (oldMovementId) {
      movementRemovedId = oldMovementId;
      updates['lancBanco/' + oldMovementId] = null;
    }
    const target = targetSnap ? advanceRecords(targetSnap.val()) : [];
    if (changed) {
      if (newFornCod !== fornCod && target.some((advance) => String(advance.cod) === adtCod)) {
        failure(409, 'ADVANCE_EXISTS', 'Já existe um adiantamento com esse código no fornecedor de destino.');
      }
      (newFornCod === fornCod ? nextSource : target).push(changed);
    }
    updates['adiantamentos/' + fornCod] = nextSource;
    if (action === 'delete') {
      updates['financeAdvanceDeleted/' + fornCod + '/' + adtCod] = {
        removedAt: now(),
        removedCode: adtCod,
        movementRemovedId: oldMovementId || '',
        reason: 'confirmed_financial_delete',
      };
    }
    if (newFornCod !== fornCod) updates['adiantamentos/' + newFornCod] = target;
    const receipt: ChangeReceipt = {
      action,
      advance: changed,
      removedCode: action === 'delete' ? adtCod : null,
      bankMovement: movement,
      movementRemovedId,
      fornCod,
      newFornCod,
    };
    updates['financeAdvanceOperations/' + operationKey] = {
      action,
      adtCod,
      result: receipt,
      createdAt: new Date(now()).toISOString(),
      createdBy: clean(identity.erpUser),
    };
    updates._ts = now();
    await commitAdvanceAndRelease(instance, updates, keys, owner, now);
    committedAndUnlocked = true;
    return {
      ...receipt,
      entries: nextSource,
      targetEntries: newFornCod !== fornCod ? target : null,
      alreadyCommitted: false,
    };
  } finally {
    if (!committedAndUnlocked) await releaseAdvanceLocks(locks, owner);
  }
}
