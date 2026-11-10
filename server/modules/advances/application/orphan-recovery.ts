import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLease } from '../../../shared/firebase/rtdb-transaction.js';
import type { AdvanceRecord, Row } from '../domain/advance-rules.js';

export interface OrphanInput {
  fornCod?: unknown;
  adtCod?: unknown;
  operationId?: unknown;
  confirmCode?: unknown;
  confirmedNoRealTransfer?: unknown;
  confirmedRealTransfer?: unknown;
  confirmedBankAmount?: unknown;
  statementReference?: unknown;
  reason?: unknown;
  signature?: unknown;
}

interface OperationRecord {
  action?: string;
  advance?: AdvanceRecord;
  bankMovement?: Row | null;
  fornCod?: string;
  adtCod?: string;
  result?: { removedCode?: string; fornCod?: string; movementRemovedId?: string };
}

interface Inspection {
  advance: AdvanceRecord | null;
  entries: unknown;
  issues: string[];
  signature: string;
  checkedPaths: string[];
  bankName: string;
  supplierName: string;
  canRecordTransfer: boolean;
  similarMovements: [string, Row][];
  originalMovement: Row | null | undefined;
}

interface OrphanDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

function key(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) fail(422, 'INVALID_KEY', 'Código inválido.');
  return text;
}

const items = <T = Row>(value: unknown): [string, T][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, T] => Boolean(entry[1]) && typeof entry[1] === 'object',
  );

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requireFinancialManager(identity: Identity | null | undefined): void {
  if (identity?.erpAccess !== true || identity.canAdvances !== true || identity.canBanking !== true) {
    fail(403, 'FINANCIAL_REVIEW_REQUIRED', 'A conferência exige acesso a Adiantamentos e Bancos.');
  }
}

async function resolve(db?: Database): Promise<Database> {
  if (db) return db;
  return (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

const CHECKED_PATHS = [
  'bancos',
  'fornecedores',
  'adiantamentos',
  'lancBanco',
  'tickets',
  'contasPagar',
  'chequesControle',
  'chequesCli',
  'financePayableOperations',
  'purchaseCreateOperations',
  'purchaseEditOperations',
  'financeAdvanceOperations',
  'financeAdvanceRecoveryAudit',
  'saldoDevedor',
  'saldos',
  'cheques',
  'chequesControle_del',
];

const REFERENCE_PATHS = [
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
  'chequesControle_del',
];

function containsId(value: unknown, id: string): boolean {
  return JSON.stringify(value ?? null).includes('"' + id + '"');
}

const differs = (a: unknown, b: unknown): boolean => Math.abs(Number(a) - Number(b)) > 0.009;

function advanceIssues(advance: AdvanceRecord, adtCod: string, fornCod: string, paths: Row): string[] {
  const issues: string[] = [];
  if (advance.status !== 'Pendente') issues.push('Adiantamento não está pendente.');
  if (!['PIX', 'TED', 'Dinheiro', 'Transferência'].includes(String(advance.forma)))
    issues.push('Forma de pagamento não elegível.');
  if (!advance.movBancoId)
    issues.push('Adiantamento sem identificador bancário: exige investigação separada.');
  if (advance.ticket || advance.ticketOrigem || advance.adiantamentoOrigem)
    issues.push('Existe vínculo com compra ou outra compensação.');
  if (
    Number(advance.valorCompensado || 0) !== 0 ||
    Number(advance.valorAplicado || 0) !== 0 ||
    (advance.valorOriginal != null && differs(advance.valorOriginal, advance.valor)) ||
    (advance.valorDisponivel != null && differs(advance.valorDisponivel, advance.valor))
  ) {
    issues.push('Adiantamento possui evidência de utilização parcial.');
  }
  if (advance.chequeIds?.length || advance.chequeFingerprints || advance.origem) {
    issues.push('Registro com origem especial ou cheques associados.');
  }
  if (!Number.isFinite(Number(advance.valor)) || Number(advance.valor) <= 0) issues.push('Valor inválido.');
  if (
    items(paths.lancBanco).some(
      ([id, movement]) =>
        id === advance.movBancoId ||
        String(movement.id || '') === advance.movBancoId ||
        String(movement.advanceCode || '') === adtCod,
    )
  ) {
    issues.push('Existe movimentação bancária que precisa ser conciliada.');
  }
  for (const [supplier, otherRecords] of items(paths.adiantamentos)) {
    const duplicate = items(otherRecords).filter(([, row]) => String(row.cod || '') === adtCod);
    if (supplier !== fornCod && duplicate.length) issues.push('O código aparece em outro fornecedor.');
  }
  for (const name of REFERENCE_PATHS) {
    if (containsId(paths[name], adtCod)) issues.push('Referência financeira detectada em ' + name + '.');
  }
  const confirmedDelete = (op: OperationRecord): boolean =>
    op.action === 'delete' &&
    op.result?.removedCode === adtCod &&
    op.result.fornCod === fornCod &&
    String(op.result.movementRemovedId || '') === String(advance.movBancoId || '');
  const receipts = items<OperationRecord>(paths.financeAdvanceOperations).filter(([, op]) =>
    containsId(op, adtCod),
  );
  for (const [, op] of receipts) {
    if (confirmedDelete(op)) continue;
    if (
      String(op.advance?.cod) !== adtCod ||
      op.action ||
      op.result ||
      (op.fornCod && op.fornCod !== fornCod)
    ) {
      issues.push('Outra operação financeira utiliza esse adiantamento.');
    } else if (
      Number(op.advance?.valor) !== Number(advance.valor) ||
      String(op.advance?.bancoCod || '') !== String(advance.bancoCod || '') ||
      String(op.advance?.movBancoId || '') !== String(advance.movBancoId || '') ||
      (op.bankMovement &&
        (String(op.bankMovement.id || '') !== String(advance.movBancoId) ||
          String(op.bankMovement.advanceCode || '') !== adtCod))
    ) {
      issues.push('O recibo original não corresponde ao adiantamento atual.');
    }
  }
  if (receipts.some(([, op]) => confirmedDelete(op))) {
    issues.push(
      'O servidor já confirmou a exclusão anterior. Feche esta conferência e use a lixeira do adiantamento para finalizar a retirada do registro que reapareceu, sem nova movimentação bancária.',
    );
  }
  if (items<{ adtCod?: string }>(paths.financeAdvanceRecoveryAudit).some(([, op]) => op.adtCod === adtCod)) {
    issues.push('Este adiantamento já possui recuperação registrada.');
  }
  return issues;
}

async function inspect(db: Database, fornCod: string, adtCod: string): Promise<Inspection> {
  const [advSnap, ...other] = await Promise.all([
    db.ref('erp/adiantamentos/' + fornCod).get(),
    ...CHECKED_PATHS.map((path) => db.ref('erp/' + path).get()),
  ]);
  const current: unknown = advSnap.val();
  const matches = items<AdvanceRecord>(current).filter(([, row]) => String(row.cod) === adtCod);
  const advance = matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
  const paths: Row = Object.fromEntries(
    CHECKED_PATHS.map((path, index): [string, unknown] => [path, other[index]?.val()]),
  );
  const issues: string[] = [];
  if (!Array.isArray(current))
    issues.push('O cadastro não usa a estrutura de lista esperada: revisão manual obrigatória.');
  if (matches.length !== 1) issues.push('Registro ausente ou duplicado dentro do fornecedor.');
  if (advance) issues.push(...advanceIssues(advance, adtCod, fornCod, paths));
  const bank = Object.values((paths.bancos ?? {}) as Row).find(
    (row): row is Row =>
      Boolean(row) &&
      typeof row === 'object' &&
      String((row as Row).cod || (row as Row).codigo || (row as Row).id || '') ===
        String(advance?.bancoCod || ''),
  );
  const supplier = Object.values((paths.fornecedores ?? {}) as Row).find(
    (row): row is Row => Boolean(row) && String((row as Row).cod || '') === fornCod,
  );
  const bankName = String(
    bank?.banco || bank?.nome || bank?.nomeBanco || advance?.bancoNome || 'Conta não identificada',
  );
  const supplierName = String(supplier?.nome || fornCod);
  const receipt = items<OperationRecord>(paths.financeAdvanceOperations).find(
    ([, op]) => op.advance?.cod === adtCod && !op.action && !op.result,
  )?.[1];
  const originalMovement = receipt?.bankMovement;
  if (
    originalMovement &&
    ((originalMovement.valor != null && Number(originalMovement.valor) !== Number(advance?.valor)) ||
      (originalMovement.bancoCod && String(originalMovement.bancoCod) !== String(advance?.bancoCod)) ||
      (originalMovement.id && String(originalMovement.id) !== String(advance?.movBancoId)))
  ) {
    issues.push('Dados bancários divergentes entre a criação e o cadastro.');
  }
  const similarMovements = items(paths.lancBanco).filter(
    ([, movement]) =>
      String(movement.bancoCod || '') === String(advance?.bancoCod || '') &&
      Number(movement.valor) === Number(advance?.valor) &&
      String(movement.data || '') === String(advance?.data || '') &&
      /adiantamento/i.test(String(movement.descricao || '')) &&
      String(movement.descricao || '')
        .toLowerCase()
        .includes(supplierName.toLowerCase()),
  );
  return {
    advance,
    entries: current,
    issues: [...new Set(issues)],
    signature: hash({ fornCod, adtCod, current, paths }),
    checkedPaths: [...CHECKED_PATHS],
    bankName,
    supplierName,
    canRecordTransfer: Boolean(bank && advance?.movBancoId && similarMovements.length === 0),
    similarMovements,
    originalMovement,
  };
}

export async function previewOrphanAdvance(
  identity: Identity,
  input: OrphanInput | null,
  { db }: { db?: Database } = {},
) {
  requireFinancialManager(identity);
  const fornCod = key(input?.fornCod);
  const adtCod = key(input?.adtCod);
  const instance = await resolve(db);
  const result = await inspect(instance, fornCod, adtCod);
  const lock = (await instance.ref('erpFinanceAdvanceLocks/' + fornCod).get()).val() as {
    expiresAt?: unknown;
  } | null;
  if (lock && Number(lock.expiresAt) > Date.now())
    result.issues.push('Outra operação do fornecedor está ativa.');
  return {
    fornCod,
    adtCod,
    eligible: result.issues.length === 0,
    issues: result.issues,
    amount: result.advance?.valor ?? null,
    bankCode: result.advance?.bancoCod ?? null,
    bankName: result.bankName,
    supplierName: result.supplierName,
    date: result.advance?.data || '',
    canRecordTransfer: result.canRecordTransfer,
    missingMovementId: result.advance?.movBancoId ?? null,
    signature: result.signature,
    checkedPaths: result.checkedPaths,
  };
}

function auditKey(identity: Identity, operationId: string): string {
  return (
    key(String(identity.uid || identity.erpUser || 'operador').replace(/[^\w-]/g, '_')) + '_' + operationId
  );
}

function previewSignature(input: OrphanInput | null): string {
  const expected = String(input?.signature || '');
  if (!/^[0-9a-f]{64}$/i.test(expected)) fail(422, 'INVALID_PREVIEW', 'Prévia inválida. Consulte novamente.');
  return expected;
}

async function assertOwnLock(
  db: Database,
  fornCod: string,
  owner: string,
  now: () => number,
  message: string,
): Promise<void> {
  const active = (await db.ref('erpFinanceAdvanceLocks/' + fornCod).get()).val() as {
    owner?: string;
    expiresAt?: unknown;
  } | null;
  if (active?.owner !== owner || Number(active.expiresAt) <= now()) fail(409, 'ADVANCE_LOCK_LOST', message);
}

export async function recoverOrphanAdvance(
  identity: Identity,
  input: OrphanInput | null,
  { db, now = () => Date.now(), uuid = randomUUID }: OrphanDeps = {},
) {
  requireFinancialManager(identity);
  const fornCod = key(input?.fornCod);
  const adtCod = key(input?.adtCod);
  const operationId = key(input?.operationId);
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    fail(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  if (String(input?.confirmCode || '') !== adtCod || input?.confirmedNoRealTransfer !== true) {
    fail(
      422,
      'RECONCILIATION_REQUIRED',
      'É obrigatório confirmar o código e que NÃO houve saída bancária real.',
    );
  }
  const reason = String(input?.reason || '').trim();
  if (reason.length < 25 || reason.length > 500)
    fail(422, 'REASON_REQUIRED', 'Informe justificativa de auditoria com ao menos 25 caracteres.');
  const expected = previewSignature(input);
  const instance = await resolve(db);
  const opKey = auditKey(identity, operationId);
  const auditRef = instance.ref('erp/financeAdvanceRecoveryAudit/' + opKey);
  const existing = (await auditRef.get()).val() as {
    adtCod?: string;
    fornCod?: string;
    signature?: string;
    action?: string;
  } | null;
  if (existing) {
    if (
      existing.adtCod !== adtCod ||
      existing.fornCod !== fornCod ||
      existing.signature !== expected ||
      existing.action !== 'orphan-delete'
    ) {
      fail(409, 'OPERATION_REUSED', 'Identificador já utilizado para outra recuperação.');
    }
    return { confirmed: true, alreadyCommitted: true, removedCode: adtCod, fornCod };
  }
  const lockRef = instance.ref('erpFinanceAdvanceLocks/' + fornCod);
  const owner = uuid();
  const acquired = await acquireLease(lockRef, owner, {
    now,
    ttlMs: 120000,
    meta: { kind: 'orphan-recovery', fornCod, operationKey: opKey },
  });
  if (!acquired)
    fail(
      409,
      'ADVANCE_IN_PROGRESS',
      'Outra operação financeira está em andamento. Aguarde alguns segundos e tente novamente.',
    );
  let committed = false;
  try {
    const fresh = await inspect(instance, fornCod, adtCod);
    if (fresh.issues.length) fail(409, 'ORPHAN_NOT_SAFE', 'Recuperação bloqueada: ' + fresh.issues.join(' '));
    if (fresh.signature !== expected)
      fail(409, 'RECONCILIATION_CHANGED', 'Os dados mudaram desde a prévia. Refaça a conferência.');
    if ((await auditRef.get()).val())
      fail(409, 'OPERATION_REUSED', 'Outra sessão já realizou a recuperação.');
    await assertOwnLock(instance, fornCod, owner, now, 'Reserva financeira expirada.');
    const record = fresh.advance;
    if (!record || !Array.isArray(fresh.entries)) fail(409, 'ORPHAN_NOT_SAFE', 'Recuperação bloqueada.');
    const entries = (fresh.entries as (AdvanceRecord | null)[]).filter((row) => String(row?.cod) !== adtCod);
    const receipt = {
      action: 'orphan-delete',
      adtCod,
      fornCod,
      operationId,
      signature: expected,
      previousRecord: record,
      missingMovementId: record.movBancoId,
      bankCode: record.bancoCod || '',
      actor: String(identity.erpUser || identity.uid || ''),
      actorUid: String(identity.uid || ''),
      performedAt: new Date(now()).toISOString(),
      reason,
      attestation: 'no_external_bank_transfer',
      checkedPaths: fresh.checkedPaths,
    };
    await instance.ref('/').update({
      ['erp/adiantamentos/' + fornCod]: entries,
      ['erp/financeAdvanceDeleted/' + fornCod + '/' + adtCod]: {
        removedCode: adtCod,
        removedAt: now(),
        reason: 'audited_orphan_delete',
      },
      ['erp/financeAdvanceRecoveryAudit/' + opKey]: receipt,
      'erp/_ts': now(),
      ['erpFinanceAdvanceLocks/' + fornCod]: null,
    });
    committed = true;
    return { confirmed: true, alreadyCommitted: false, removedCode: adtCod, fornCod, entries };
  } finally {
    if (!committed) await releaseLease(lockRef, owner, { label: 'orphan.recovery.release.failed' });
  }
}

export async function recordVerifiedOrphanTransfer(
  identity: Identity,
  input: OrphanInput | null,
  { db, now = () => Date.now(), uuid = randomUUID }: OrphanDeps = {},
) {
  requireFinancialManager(identity);
  const fornCod = key(input?.fornCod);
  const adtCod = key(input?.adtCod);
  const operationId = key(input?.operationId);
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    fail(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  if (input?.confirmedRealTransfer !== true || input.confirmedBankAmount !== true) {
    fail(422, 'BANK_CONFIRMATION_REQUIRED', 'Confira o extrato bancário e confirme o pagamento e seu valor.');
  }
  const statementReference = String(input.statementReference || '').trim();
  const reason = String(input.reason || '').trim();
  if (statementReference.length < 6 || statementReference.length > 120) {
    fail(422, 'STATEMENT_REQUIRED', 'Informe a referência do comprovante ou identificador da transferência.');
  }
  if (reason.length < 25 || reason.length > 500)
    fail(422, 'REASON_REQUIRED', 'Registre uma observação sobre a conferência financeira.');
  const expected = previewSignature(input);
  const instance = await resolve(db);
  const opKey = auditKey(identity, operationId);
  const auditRef = instance.ref('erp/financeAdvanceRecoveryAudit/' + opKey);
  const existing = (await auditRef.get()).val() as {
    adtCod?: string;
    fornCod?: string;
    signature?: string;
    action?: string;
  } | null;
  if (existing) {
    if (
      existing.adtCod !== adtCod ||
      existing.fornCod !== fornCod ||
      existing.signature !== expected ||
      existing.action !== 'restore-missing-bank-movement'
    ) {
      fail(409, 'OPERATION_REUSED', 'Conferência já registrada com outros dados.');
    }
    return {
      confirmed: true,
      alreadyCommitted: true,
      action: 'restore-missing-bank-movement',
      adtCod,
      fornCod,
    };
  }
  const lockRef = instance.ref('erpFinanceAdvanceLocks/' + fornCod);
  const owner = uuid();
  const acquired = await acquireLease(lockRef, owner, {
    now,
    ttlMs: 120000,
    meta: { kind: 'bank-reconciliation', fornCod, operationKey: opKey },
  });
  if (!acquired) {
    fail(
      409,
      'ADVANCE_IN_PROGRESS',
      'Outra operação deste fornecedor está em andamento. Aguarde alguns segundos e tente novamente.',
    );
  }
  let committed = false;
  try {
    const fresh = await inspect(instance, fornCod, adtCod);
    if (fresh.issues.length || !fresh.canRecordTransfer) {
      fail(
        409,
        'RECONCILIATION_NOT_SAFE',
        'Existem informações que exigem conferência antes de registrar a movimentação.',
      );
    }
    if (fresh.signature !== expected)
      fail(409, 'RECONCILIATION_CHANGED', 'Os dados mudaram desde a conferência. Revise novamente.');
    if ((await auditRef.get()).val())
      fail(409, 'OPERATION_REUSED', 'Outra sessão já concluiu esta conferência.');
    await assertOwnLock(instance, fornCod, owner, now, 'A reserva financeira não está mais válida.');
    const advance = fresh.advance;
    if (!advance)
      fail(
        409,
        'RECONCILIATION_NOT_SAFE',
        'Existem informações que exigem conferência antes de registrar a movimentação.',
      );
    const movementId = key(advance.movBancoId);
    if ((await instance.ref('erp/lancBanco/' + movementId).get()).val()) {
      fail(409, 'BANK_MOVEMENT_EXISTS', 'Já existe lançamento com esse identificador. Confira o extrato.');
    }
    const original = fresh.originalMovement ?? {};
    const description =
      original.descricao && String(original.descricao).startsWith('Adiantamento: ')
        ? original.descricao
        : 'Adiantamento: ' + fresh.supplierName + (advance.ticket ? ' Ticket ' + advance.ticket : '');
    const movement = {
      id: movementId,
      bancoCod: advance.bancoCod,
      data: advance.data,
      descricao: description,
      tipo: 'Saida',
      valor: Number(advance.valor),
      advanceCode: adtCod,
      source: 'advance',
      reconciledFromStatement: true,
      reconciliationReference: statementReference,
      reconciledAt: new Date(now()).toISOString(),
    };
    const receipt = {
      action: 'restore-missing-bank-movement',
      adtCod,
      fornCod,
      operationId,
      signature: expected,
      bankMovement: movement,
      actor: String(identity.erpUser || identity.uid || ''),
      actorUid: String(identity.uid || ''),
      performedAt: new Date(now()).toISOString(),
      statementReference,
      reason,
      attestation: 'external_transfer_verified',
      checkedPaths: fresh.checkedPaths,
    };
    await instance.ref('/').update({
      ['erp/lancBanco/' + movementId]: movement,
      ['erp/financeAdvanceRecoveryAudit/' + opKey]: receipt,
      'erp/_ts': now(),
      ['erpFinanceAdvanceLocks/' + fornCod]: null,
    });
    committed = true;
    return {
      confirmed: true,
      alreadyCommitted: false,
      action: 'restore-missing-bank-movement',
      adtCod,
      fornCod,
    };
  } finally {
    if (!committed)
      await releaseLease(lockRef, owner, { label: 'advance.bank.reconciliation.release.failed' });
  }
}
