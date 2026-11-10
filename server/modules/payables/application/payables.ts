import { createHash, randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { AppError, fail } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLease } from '../../../shared/firebase/rtdb-transaction.js';

type Row = Record<string, unknown>;

export interface PaymentRecord {
  data?: string;
  valor?: number;
  adt?: number;
  banco?: string;
  obs?: string;
  movBancoId?: string;
  [field: string]: unknown;
}

export interface PayableRecord {
  id?: string;
  ticket?: string;
  fornCod?: string;
  cred?: string;
  desc?: string;
  valor?: number;
  status?: string;
  valorPago?: number;
  adtCompensado?: number;
  pagamentos?: PaymentRecord[];
  parcelas?: number;
  [field: string]: unknown;
}

interface AdvanceRecord {
  cod?: string;
  valor?: number;
  valorOriginal?: number;
  valorCompensado?: number;
  valorDisponivel?: number;
  status?: string;
  ticket?: string;
  ticketOrigem?: string;
  forma?: string;
  bancoCod?: string;
  bancoNome?: string;
  empresa?: string;
  obs?: string;
  [field: string]: unknown;
}

interface TicketRecord {
  totalGeral?: number;
  pedidoCompra?: { totalPedido?: number };
  saldoPagar?: number;
  status?: string;
  fornecedorCod?: string;
  fornecedor?: string;
  fornecedorNome?: string;
  [field: string]: unknown;
}

interface StoredOperation {
  result?: { payable?: PayableRecord };
}

interface LockRecord {
  operationKey?: string;
  expiresAt?: number;
}

export interface PaymentDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface PaymentInput {
  payableId?: unknown;
  operationId?: unknown;
  bankCode?: unknown;
  date?: unknown;
  amount?: unknown;
  advanceAmount?: unknown;
  fornCod?: unknown;
  obs?: unknown;
  expected?: { valor?: unknown; status?: unknown; paymentsCount?: unknown };
}

const LOCK_TTL_MS = 120000;
const BANK_LIST_CLAIMS = [
  'canFinance',
  'canAdvances',
  'canPayables',
  'canReceivables',
  'canBanking',
  'canPurchasing',
  'canSales',
  'canCustomers',
  'canSuppliers',
  'canContracts',
  'canFleet',
  'canPayroll',
  'canExpenses',
] as const;

const clean = (value: unknown, max = 160): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

function key(value: unknown): string {
  const text = clean(value, 120);
  if (!text || /[.#$[\]/]/.test(text) || hasControlChars(text))
    fail(422, 'INVALID_KEY', 'Identificador inválido.');
  return text;
}

function cents(value: unknown, allowZero = false): number {
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    (allowZero || value !== 0) &&
    !(
      Math.round(value * 100) !== value * 100 && Math.abs(Math.round(value * 100) - value * 100) > 0.000001
    ) &&
    value <= 1e9;
  if (!valid) fail(422, 'INVALID_AMOUNT', 'Valor monetário inválido.');
  return Math.round(value * 100);
}

const money = (value: number): number => Math.round(value) / 100;

const entries = <T = Row>(value: unknown): [string, T][] =>
  Object.entries(value && typeof value === 'object' ? (value as Record<string, unknown>) : {}).filter(
    (entry): entry is [string, T] =>
      Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );

function dateISO(value: unknown): string {
  const date = clean(value, 10);
  const parsed = new Date(date + 'T12:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    fail(422, 'INVALID_DATE', 'Data inválida.');
  }
  return date;
}

const displayDate = (value: string): string => value.split('-').reverse().join('/');

const canList = (identity: Identity): boolean =>
  identity.erpAccess === true && BANK_LIST_CLAIMS.some((claim) => identity[claim] === true);

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

const banks = (value: unknown): { cod: string; banco: string }[] =>
  entries(value)
    .map(([id, bank]) => ({
      cod: clean(bank.cod || bank.codigo || bank.id || id),
      banco: clean(bank.banco || bank.nomeBanco || bank.nome),
    }))
    .filter((bank) => bank.cod && bank.banco);

const asCents = (value: unknown): number => cents(Number(value), true);

async function findPayable(db: Database, id: string): Promise<[string, PayableRecord] | null> {
  const direct: unknown = (await db.ref('erp/contasPagar/' + id).get()).val();
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const record = direct as PayableRecord;
    if (record.id == null || String(record.id) === id) return [id, record];
  }
  const raw: unknown = (await db.ref('erp/contasPagar').get()).val();
  return entries<PayableRecord>(raw).find(([path, row]) => path === id || String(row.id) === id) ?? null;
}

async function recoverPaymentResult(
  opRef: Reference,
  originalLock: LockRecord | null,
  operationKey: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Row | null> {
  const waits = originalLock?.operationKey === operationKey ? 6 : 1;
  for (let attempt = 0; attempt < waits; attempt++) {
    const operation = (await opRef.get()).val() as { result?: unknown } | null;
    if (operation?.result) return operation;
    if (attempt + 1 < waits) await sleep(250);
  }
  return null;
}

function inProgress(lock: LockRecord | null, now: () => number): never {
  const seconds = Math.max(1, Math.min(120, Math.ceil((Number(lock?.expiresAt || 0) - now()) / 1000)));
  throw new AppError(
    409,
    'PAYMENT_IN_PROGRESS',
    'Há uma baixa em processamento para este título. Não confirme novamente antes da conclusão ou do prazo informado.',
    { retryAfterSeconds: seconds },
  );
}

export async function listPaymentBanks(identity: Identity, { db }: { db?: Database } = {}) {
  if (!canList(identity))
    fail(403, 'PAYMENT_BANKS_FORBIDDEN', 'Seu perfil não pode consultar as opções de pagamento.');
  const instance = await database(db);
  const items = banks((await instance.ref('erp/bancos').get()).val());
  items.sort((a, b) => a.banco.localeCompare(b.banco, 'pt-BR') || a.cod.localeCompare(b.cod, 'pt-BR'));
  return { banks: items };
}

function applyAdvances(
  advanceList: AdvanceRecord[],
  ticketCode: string,
  amount: number,
  date: string,
  now: () => number,
  uuid: () => string,
): void {
  let remaining = amount;
  const eligible = advanceList.filter(
    (advance) =>
      advance.status === 'Pendente' && (!advance.ticket || String(advance.ticket).trim() === ticketCode),
  );
  eligible.sort(
    (a, b) =>
      Number(String(b.ticket || '').trim() === ticketCode) -
      Number(String(a.ticket || '').trim() === ticketCode),
  );
  for (const advance of eligible) {
    if (!remaining) break;
    const available = cents(Number(advance.valor));
    const used = Math.min(available, remaining);
    const initialCents = cents(Number(advance.valorOriginal ?? advance.valor));
    const alreadyApplied = cents(Number(advance.valorCompensado || 0), true);
    advance.valorOriginal = money(initialCents);
    advance.valorCompensado = money(alreadyApplied + used);
    if (used === available) {
      advance.status = 'Quitado';
      if (advance.valorDisponivel != null) advance.valorDisponivel = 0;
      advance.ticket = advance.ticket || ticketCode;
      advance.obs = (advance.obs ? advance.obs + ' | ' : '') + 'Compensado em CP ' + displayDate(date);
    } else {
      advance.valor = money(available - used);
      if (advance.valorDisponivel != null) advance.valorDisponivel = money(available - used);
      if (advance.ticket && String(advance.ticket).trim() === ticketCode) {
        advance.ticketOrigem = advance.ticket;
        advance.ticket = '';
      }
      advanceList.push({
        cod: 'ADT' + now().toString(36) + uuid().replaceAll('-', '').slice(0, 8),
        data: displayDate(date),
        valor: money(used),
        status: 'Quitado',
        ticket: ticketCode,
        forma: advance.forma,
        bancoCod: advance.bancoCod || '',
        bancoNome: advance.bancoNome || '',
        empresa: advance.empresa || '',
        origem: 'compensacao_cp',
        adiantamentoOrigem: advance.cod,
        obs: 'Compensação parcial – CP ' + displayDate(date),
      });
    }
    remaining -= used;
  }
  if (remaining)
    fail(
      409,
      'ADVANCE_BALANCE_CHANGED',
      'Crédito disponível para este ticket é insuficiente. Atualize os dados.',
    );
}

async function assertPurchaseHistory(
  db: Database,
  id: string,
  original: PayableRecord,
  ticket: TicketRecord | null,
  newCents: number,
): Promise<void> {
  const history = Array.isArray(original.pagamentos) ? original.pagamentos : [];
  const nominal = asCents(ticket?.totalGeral ?? ticket?.pedidoCompra?.totalPedido ?? 0);
  const registered = history.reduce((sum, row) => sum + asCents(row?.valor || 0) + asCents(row?.adt || 0), 0);
  const declared = asCents(original.valorPago || 0) + asCents(original.adtCompensado || 0);
  if (nominal > 0 && (registered > nominal || declared > nominal || registered + newCents > nominal)) {
    fail(
      409,
      'PAYABLE_RECONCILIATION_REQUIRED',
      'O histórico deste título ultrapassa o valor da compra. Nenhuma nova baixa foi registrada.',
    );
  }
  const checks = await Promise.all(
    history
      .filter((row) => Number(row?.valor || 0) > 0)
      .map(async (row) => {
        if (!row?.movBancoId) return false;
        const movement = (await db.ref('erp/lancBanco/' + key(row.movBancoId)).get()).val() as Row | null;
        return (
          Boolean(movement) &&
          String(movement?.payableId || '') === id &&
          asCents(movement?.valor || 0) === asCents(row.valor)
        );
      }),
  );
  if (checks.some((exists) => !exists)) {
    fail(
      409,
      'PAYABLE_RECONCILIATION_REQUIRED',
      'Existem baixas sem lançamento bancário correspondente. Nenhum novo pagamento foi registrado.',
    );
  }
}

export async function payPayable(
  identity: Identity,
  input: PaymentInput,
  {
    db,
    now = () => Date.now(),
    uuid = randomUUID,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }: PaymentDeps = {},
) {
  if (identity.erpAccess !== true || identity.canPayables !== true)
    fail(403, 'PAYABLES_REQUIRED', 'Sem acesso a Contas a Pagar.');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const id = key(input.payableId);
  const operationId = key(input.operationId);
  const bankCode = input.bankCode ? key(input.bankCode) : '';
  const date = dateISO(input.date);
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) fail(422, 'INVALID_OPERATION', 'Operação inválida.');
  const payCents = cents(input.amount, true);
  const advanceCents = cents(input.advanceAmount ?? 0, true);
  if (payCents + advanceCents <= 0)
    fail(422, 'INVALID_AMOUNT', 'Informe o valor do pagamento ou da compensação.');
  if (payCents && !bankCode) fail(422, 'BANK_REQUIRED', 'Selecione a conta bancária.');
  if (!payCents && bankCode) fail(422, 'INVALID_BANK', 'Banco não é necessário para compensação integral.');
  const instance = await database(db);
  const opKey =
    key(String(identity.uid || identity.erpUser || 'user').replace(/[^a-zA-Z0-9_-]/g, '_')) +
    '_' +
    operationId;
  const opRef = instance.ref('erp/financePayableOperations/' + opKey);
  const expected = input.expected ?? {};
  if (typeof expected !== 'object' || Array.isArray(expected))
    fail(422, 'INVALID_EXPECTED', 'Versão esperada inválida.');
  const signature = createHash('sha256')
    .update(
      JSON.stringify({ id, date, bankCode, payCents, advanceCents, fornCod: clean(input.fornCod), expected }),
    )
    .digest('hex');
  const resultIfCommitted = (record: unknown): Row | null => {
    const stored = record as { result?: Row; requestSignature?: string } | null;
    if (!stored?.result) return null;
    if (stored.requestSignature && stored.requestSignature !== signature) {
      fail(
        409,
        'OPERATION_USED',
        'Esta tentativa já foi usada com outros dados. Atualize a conta antes de tentar novamente.',
      );
    }
    return { ...stored.result, alreadyCommitted: true };
  };
  const replay = resultIfCommitted((await opRef.get()).val());
  if (replay) return replay;
  const lockRef = instance.ref('erpFinancePayableLocks/' + id);
  const owner = uuid();
  const claim = () =>
    acquireLease(lockRef, owner, {
      now,
      ttlMs: LOCK_TTL_MS,
      meta: { operationKey: opKey, kind: 'payable-payment' },
    });
  let claimed = await claim();
  if (!claimed) {
    const lock = (await lockRef.get()).val() as LockRecord | null;
    const recovered = resultIfCommitted(await recoverPaymentResult(opRef, lock, opKey, sleep));
    if (recovered) return recovered;
    if (Number(lock?.expiresAt || 0) <= now()) claimed = await claim();
    if (!claimed) inProgress((await lockRef.get()).val() as LockRecord | null, now);
  }
  let supplierLock: Reference | null = null;
  let ticketLock: Reference | null = null;
  let paymentCommitted = false;
  try {
    const committedResult = resultIfCommitted((await opRef.get()).val());
    if (committedResult) return committedResult;
    const found = await findPayable(instance, id);
    if (!found) fail(404, 'PAYABLE_NOT_FOUND', 'Título não encontrado na nuvem.');
    const [path, original] = found;
    const currentCents = cents(Number(original.valor));
    const paidCount = Array.isArray(original.pagamentos) ? original.pagamentos.length : 0;
    if (
      original.status === 'Pago' ||
      (expected.valor != null && cents(Number(expected.valor)) !== currentCents) ||
      (expected.status != null && String(expected.status) !== String(original.status)) ||
      (expected.paymentsCount != null && Number(expected.paymentsCount) !== paidCount)
    ) {
      fail(
        409,
        'PAYABLE_CHANGED',
        'O título foi alterado por outra sessão. Atualize a página antes de pagar.',
      );
    }
    if (payCents + advanceCents > currentCents)
      fail(409, 'OVERPAYMENT', 'O valor informado excede o saldo atual.');
    if (original.ticket) {
      const candidate = instance.ref('erpFinancePayableTicketLocks/' + key(original.ticket));
      if (
        !(await acquireLease(candidate, owner, { now, ttlMs: 120000, meta: { kind: 'payable-payment' } }))
      ) {
        fail(
          409,
          'TICKET_IN_PROGRESS',
          'Outra operação desta compra está em andamento. Aguarde alguns segundos e tente novamente.',
        );
      }
      ticketLock = candidate;
    }
    const supplier = advanceCents ? key(original.fornCod || input.fornCod) : '';
    if (
      advanceCents &&
      original.fornCod &&
      String(input.fornCod || original.fornCod) !== String(original.fornCod)
    ) {
      fail(409, 'SUPPLIER_MISMATCH', 'O fornecedor do adiantamento não corresponde ao título.');
    }
    if (advanceCents) {
      const candidate = instance.ref('erpFinanceAdvanceLocks/' + supplier);
      if (
        !(await acquireLease(candidate, owner, {
          now,
          ttlMs: 120000,
          meta: { kind: 'payable-payment', fornCod: supplier },
        }))
      ) {
        fail(
          409,
          'ADVANCE_IN_PROGRESS',
          'Outra operação de adiantamento deste fornecedor está em andamento. Aguarde alguns segundos e tente novamente.',
        );
      }
      supplierLock = candidate;
    }
    const [bankSnap, advanceSnap, ticketSnap] = await Promise.all([
      payCents ? instance.ref('erp/bancos').get() : Promise.resolve(null),
      advanceCents ? instance.ref('erp/adiantamentos/' + supplier).get() : Promise.resolve(null),
      original.ticket ? instance.ref('erp/tickets/' + key(original.ticket)).get() : Promise.resolve(null),
    ]);
    const ticketRecord = (ticketSnap?.val() ?? null) as TicketRecord | null;
    if (original.ticket && id.startsWith('CPPO_')) {
      await assertPurchaseHistory(instance, id, original, ticketRecord, payCents + advanceCents);
    }
    const bank = payCents ? banks(bankSnap?.val()).find((item) => item.cod === bankCode) : null;
    if (payCents && !bank) fail(422, 'BANK_NOT_FOUND', 'Banco não encontrado. Atualize as opções.');
    const rawAdvances: unknown = advanceSnap?.val();
    const advanceList = advanceCents
      ? (Array.isArray(rawAdvances) ? rawAdvances : Object.values(rawAdvances ?? {}).filter(Boolean)).map(
          (advance) => ({ ...(advance as AdvanceRecord) }),
        )
      : null;
    if (original.ticket && !ticketRecord) {
      fail(409, 'PURCHASE_TICKET_MISSING', 'Compra vinculada não localizada. Nenhuma baixa foi registrada.');
    }
    if (ticketRecord) {
      const ticketBalance = asCents(ticketRecord.saldoPagar || 0);
      if (ticketBalance < payCents + advanceCents) {
        fail(
          409,
          'PURCHASE_BALANCE_CHANGED',
          'O saldo da compra não corresponde ao pagamento. Nenhuma baixa foi registrada.',
        );
      }
      if (ticketBalance === 0)
        fail(409, 'PURCHASE_ALREADY_PAID', 'A compra já está quitada. Confira o Histórico antes de pagar.');
    }
    if (advanceCents && ticketRecord?.fornecedorCod && String(ticketRecord.fornecedorCod) !== supplier) {
      fail(409, 'SUPPLIER_MISMATCH', 'O ticket está associado a outro fornecedor.');
    }
    if (advanceCents && !original.fornCod && !ticketRecord?.fornecedorCod) {
      const rawSuppliers: unknown = (await instance.ref('erp/fornecedores').get()).val();
      const normalize = (value: unknown): string =>
        String(value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLocaleLowerCase('pt-BR');
      const name = normalize(original.cred || ticketRecord?.fornecedor || ticketRecord?.fornecedorNome);
      const matching = entries(rawSuppliers).filter(([, row]) => normalize(row.nome) === name);
      if (!name || matching.length !== 1 || String(matching[0]?.[1].cod || '') !== supplier) {
        fail(
          409,
          'SUPPLIER_NOT_VERIFIED',
          'Não foi possível confirmar o fornecedor deste título legado. Verifique o cadastro.',
        );
      }
    }
    if (advanceList)
      applyAdvances(advanceList, String(original.ticket || '').trim(), advanceCents, date, now, uuid);
    const amountTotal = payCents + advanceCents;
    const rest = currentCents - amountTotal;
    const full = rest === 0;
    const updated: PayableRecord = {
      ...original,
      pagamentos: [
        ...(Array.isArray(original.pagamentos) ? original.pagamentos : []),
        {
          data: displayDate(date),
          valor: money(payCents),
          adt: money(advanceCents),
          banco: bank?.banco || '',
          obs: clean(input.obs, 1000),
        },
      ],
      status: full ? 'Pago' : 'Pendente',
      valor: full ? money(currentCents) : money(rest),
      valorPago: money(asCents(original.valorPago || 0) + payCents),
      _upd: now(),
    };
    if (advanceCents) updated.adtCompensado = money(asCents(original.adtCompensado || 0) + advanceCents);
    if (full) updated.dataPgto = displayDate(date);
    if (bank) {
      updated.bancoNome = bank.banco;
      updated.bancoCod = bank.cod;
    }
    const updates: Row = { ['contasPagar/' + path]: updated };
    let movement: Row | null = null;
    if (payCents && bank) {
      const movementId = 'LB-PG-' + now() + '-' + uuid().replaceAll('-', '').slice(0, 8);
      movement = {
        id: movementId,
        bancoCod: bank.cod,
        data: displayDate(date),
        descricao: 'Pagto: ' + clean(original.desc || original.cred, 240),
        tipo: 'Saida',
        valor: money(payCents),
        payableId: id,
      };
      updated.movBancoIdCP = movementId;
      const lastPayment = updated.pagamentos?.[updated.pagamentos.length - 1];
      if (lastPayment) lastPayment.movBancoId = movementId;
      updates['lancBanco/' + movementId] = movement;
    }
    if (advanceList) updates['adiantamentos/' + supplier] = advanceList;
    let ticket: TicketRecord | null = null;
    if (ticketRecord) {
      const originalTicket = ticketRecord ?? {};
      const nextBalance = money(Math.max(0, asCents(Number(originalTicket.saldoPagar || 0)) - amountTotal));
      ticket = { ...originalTicket, saldoPagar: nextBalance, status: nextBalance === 0 ? 'Pago' : 'Parcial' };
      updates['tickets/' + key(original.ticket)] = ticket;
    }
    const result = {
      payable: updated,
      bankMovement: movement,
      advanceEntries: advanceList,
      fornCod: supplier,
      ticket,
      ticketKey: original.ticket || '',
    };
    updates['financePayableOperations/' + opKey] = {
      result,
      requestSignature: signature,
      createdAt: now(),
      actor: clean(identity.erpUser),
    };
    const atomicUpdates: Row = Object.fromEntries(
      Object.entries(updates).map(([field, value]) => ['erp/' + field, value]),
    );
    atomicUpdates['erpFinancePayableLocks/' + id] = null;
    if (ticketLock) atomicUpdates['erpFinancePayableTicketLocks/' + key(original.ticket)] = null;
    if (supplierLock) atomicUpdates['erpFinanceAdvanceLocks/' + supplier] = null;
    try {
      await instance.ref().update(atomicUpdates);
      paymentCommitted = true;
    } catch (error) {
      const stored = (await opRef.get().catch(() => null))?.val();
      const recovered = resultIfCommitted(stored);
      if (recovered) {
        paymentCommitted = true;
        return recovered;
      }
      throw error;
    }
    return result;
  } finally {
    if (!paymentCommitted) {
      if (supplierLock) await releaseLease(supplierLock, owner, { label: 'payable.supplier.lock.release' });
      if (ticketLock) await releaseLease(ticketLock, owner, { label: 'payable.ticket.lock.release' });
      await releaseLease(lockRef, owner, { label: 'payable.lock.release' });
    }
  }
}

export async function inspectPayablePayment(
  identity: Identity,
  input: { payableId?: unknown; operationId?: unknown } | null | undefined,
  { db, now = () => Date.now() }: { db?: Database; now?: () => number } = {},
) {
  if (identity.erpAccess !== true || identity.canPayables !== true)
    fail(403, 'PAYABLES_REQUIRED', 'Sem acesso a Contas a Pagar.');
  const id = key(input?.payableId);
  const instance = await database(db);
  const found = await findPayable(instance, id);
  if (!found) return { state: 'not_found' };
  const [, payable] = found;
  const ticketId = String(payable.ticket || '').trim();
  const ticketIdKey = ticketId ? key(ticketId) : '';
  const ticket = ticketIdKey
    ? ((await instance.ref('erp/tickets/' + ticketIdKey).get()).val() as TicketRecord | null)
    : null;
  let operation: StoredOperation | null = null;
  if (input?.operationId) {
    const operationId = key(input.operationId);
    if (!/^[a-f0-9-]{36}$/i.test(operationId))
      fail(422, 'INVALID_OPERATION', 'Identificador de operação inválido.');
    const opKey =
      key(String(identity.uid || identity.erpUser || 'user').replace(/[^a-zA-Z0-9_-]/g, '_')) +
      '_' +
      operationId;
    operation = (
      await instance.ref('erp/financePayableOperations/' + opKey).get()
    ).val() as StoredOperation | null;
  }
  const lock = (await instance.ref('erpFinancePayableLocks/' + id).get()).val() as LockRecord | null;
  const remains = Math.max(0, Math.ceil((Number(lock?.expiresAt || 0) - now()) / 1000));
  const paid = String(payable.status || '') === 'Pago';
  const ticketMarkedPaid = Boolean(ticket) && ['Pago', 'Quitado'].includes(String(ticket?.status));
  const ticketZero = Boolean(ticket) && Number(ticket?.saldoPagar || 0) <= 0.005;
  const payments = Array.isArray(payable.pagamentos) ? payable.pagamentos : [];
  const ticketNominal = Number(ticket?.totalGeral ?? ticket?.pedidoCompra?.totalPedido ?? 0);
  const totalInHistory = payments.reduce(
    (sum, row) => sum + Number(row?.valor || 0) + Number(row?.adt || 0),
    0,
  );
  const reported = Number(payable.valorPago || 0) + Number(payable.adtCompensado || 0);
  const historyErrors: string[] = [];
  if (ticketNominal > 0 && (totalInHistory > ticketNominal + 0.005 || reported > ticketNominal + 0.005)) {
    historyErrors.push('PAYMENTS_EXCEED_PURCHASE');
  }
  const bankChecks = await Promise.all(
    payments
      .filter((row) => Number(row?.valor || 0) > 0)
      .map(async (row) => {
        if (!row?.movBancoId) return false;
        const movement = (
          await instance.ref('erp/lancBanco/' + key(row.movBancoId)).get()
        ).val() as Row | null;
        return (
          Boolean(movement) &&
          String(movement?.payableId || '') === id &&
          Math.abs(Number(movement?.valor || 0) - Number(row.valor || 0)) < 0.005
        );
      }),
  );
  if (bankChecks.some((check) => !check)) historyErrors.push('BANK_MOVEMENT_MISSING');
  if (historyErrors.length)
    return { state: 'needs_review', reasons: historyErrors, payable, ticket, ticketKey: ticketIdKey };
  const installment = Number(payable.parcelas || 0) > 1;
  const statusMismatch = installment ? !paid && ticketMarkedPaid : paid !== ticketMarkedPaid;
  const mismatch = Boolean(ticketIdKey) && (!ticket || ticketMarkedPaid !== ticketZero || statusMismatch);
  if (mismatch || (!paid && operation?.result?.payable?.status === 'Pago')) {
    return { state: 'needs_review', payable, ticket, ticketKey: ticketIdKey };
  }
  if (paid)
    return {
      state: 'confirmed',
      payable,
      ticket,
      ticketKey: ticketIdKey,
      receiptFound: Boolean(operation?.result),
    };
  if (remains > 0) return { state: 'processing', retryAfterSeconds: remains };
  return { state: 'pending', payable, ticket, ticketKey: ticketIdKey };
}
