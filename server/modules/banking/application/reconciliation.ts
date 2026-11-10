import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import {
  ABS,
  cents,
  latestDecisions,
  validatePlan,
  type Decision,
  type ImportedMovement,
  type ReconciliationPlan,
  type ReconciliationTarget,
} from '../domain/reconciliation-engine.js';

type Row = Record<string, unknown>;

export interface ReconciliationInput {
  action?: unknown;
  bankCode?: unknown;
  importId?: unknown;
  status?: unknown;
  allocations?: unknown;
  adjustmentCents?: unknown;
  category?: unknown;
  costCenter?: unknown;
  notes?: unknown;
  confirm?: unknown;
  amountCents?: unknown;
  party?: unknown;
  description?: unknown;
  company?: unknown;
  items?: unknown;
}

interface DecisionRecord extends Decision {
  id: string;
  importId: string;
}

interface BankState {
  decisions: Record<string, Decision>;
  audit: Record<string, Decision>;
  revision?: number;
}

const forbidden = (message: string, status = 400, code?: string): AppError =>
  new AppError(
    status,
    code ?? (status === 409 ? 'RECONCILIATION_CONFLICT' : 'RECONCILIATION_ERROR'),
    message,
  );

const validCode = (value: unknown): boolean => /^[A-Za-z0-9_-]{1,40}$/.test(String(value || ''));
const safeText = (value: unknown, max: number): string =>
  String(value || '')
    .trim()
    .slice(0, max);
const ALLOWED_KINDS = new Set(['bankEntry', 'payable', 'receivable']);
const rows = (value: unknown): [string, Row][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, Row] => Boolean(entry[1]) && typeof entry[1] === 'object',
  );

const valueDate = (value: unknown): string => {
  const text = String(value || '');
  return /^\d{2}\/\d{2}\/\d{4}$/.test(text)
    ? text.slice(6) + '-' + text.slice(3, 5) + '-' + text.slice(0, 2)
    : text.slice(0, 10);
};

const canSeePayables = (identity: Identity): boolean => identity.canFinance === true;
const canSeeReceivables = (identity: Identity): boolean =>
  identity.canFinance === true || identity.canReceivables === true;

function profileTargets(
  data: { lancBanco: unknown; contasPagar: unknown; contasReceber: unknown },
  code: string,
  identity: Identity,
) {
  const entries: ReconciliationTarget[] = rows(data.lancBanco)
    .filter(([, row]) => String(row.bancoCod || '') === code)
    .map(([key, row]) => ({
      id: String(row.id || key),
      kind: 'bankEntry',
      bankCode: code,
      date: valueDate(row.data),
      description: String(row.descricao || ''),
      amount: row.valor,
      direction: ['Entrada', 'Crédito'].includes(String(row.tipo)) ? 'income' : 'expense',
    }));
  const payables: ReconciliationTarget[] = canSeePayables(identity)
    ? rows(data.contasPagar).map(([key, row]) => ({
        id: String(row.id || key),
        kind: 'payable',
        date: valueDate(row.venc || row.lancto),
        description: String(row.desc || row.cred || ''),
        amount: row.valor,
        status: row.status,
      }))
    : [];
  const receivables: ReconciliationTarget[] = canSeeReceivables(identity)
    ? rows(data.contasReceber).map(([key, row]) => ({
        id: String(row.id || key),
        kind: 'receivable',
        date: valueDate(row.venc || row.data),
        description: String(row.desc || row.cli || ''),
        amount: row.valor,
        status: row.status,
      }))
    : [];
  return [...entries, ...payables, ...receivables].filter(
    (target) => target.id && target.amount !== undefined && target.amount !== null,
  );
}

function latestLegacy(events: unknown, imports: Record<string, ImportedMovement>): Record<string, Decision> {
  const decisions: Record<string, Decision> = {};
  latestDecisions(events).forEach((event, id) => {
    const imported = imports[id];
    if (!imported) return;
    const allocations =
      event.status === 'reconciled' && event.targetId && ALLOWED_KINDS.has(String(event.targetKind))
        ? [
            {
              kind: String(event.targetKind),
              id: event.targetId,
              amountCents: ABS(cents(imported.amountCents)).toString(),
            },
          ]
        : [];
    decisions[id] = { ...event, importId: id, allocations };
  });
  return decisions;
}

function mergeDecisions(
  current: Record<string, Decision> | undefined,
  legacy: Record<string, Decision>,
): Map<string, Decision> {
  return new Map([...Object.entries(legacy), ...Object.entries(current ?? {})]);
}

export function validateReconciliationAction({
  input,
  imports,
  targets,
  current = {},
  legacy = {},
  identity,
}: {
  input: ReconciliationInput;
  imports: Record<string, ImportedMovement>;
  targets: ReconciliationTarget[];
  current?: Record<string, Decision>;
  legacy?: Record<string, Decision>;
  identity: Identity;
}): ReconciliationPlan {
  const action = String(input.action || '');
  const merged = mergeDecisions(current, legacy);
  const importId = safeText(input.importId, 100);
  const imported = imports[importId];
  if (!imported || String(imported.id) !== importId) throw forbidden('Movimentação OFX não encontrada');
  if (action === 'undo' || action === 'archive') {
    return {
      status: action === 'undo' ? 'reversed' : 'archived',
      allocations: [],
      adjustmentCents: '0',
      remainderCents: ABS(cents(imported.amountCents)).toString(),
    };
  }
  if (action === 'reconcile' || action === 'classify') {
    const status = action === 'classify' ? 'classified' : safeText(input.status, 20) || 'reconciled';
    if (!['reconciled', 'partial', 'classified'].includes(status)) throw forbidden('Situação inválida');
    const allocations = Array.isArray(input.allocations) ? (input.allocations as Row[]) : [];
    const blocked = allocations.some(
      (allocation) =>
        (allocation.kind === 'payable' && !canSeePayables(identity)) ||
        (allocation.kind === 'receivable' && !canSeeReceivables(identity)),
    );
    if (blocked) throw forbidden('Sem permissão para o título selecionado', 403);
    try {
      return validatePlan({
        imported,
        allocations,
        adjustmentCents: input.adjustmentCents || '0',
        category: input.category || '',
        targets,
        decisions: merged,
        status,
      });
    } catch (error) {
      const message = String((error as Error | null)?.message || '');
      const conflict = /saldo disponível|já conciliad|movimentaç[aã]o alterada|em uso/i.test(message);
      throw forbidden(
        message || 'Dados de conciliação inválidos',
        conflict ? 409 : 400,
        conflict ? 'RECONCILIATION_CONFLICT' : 'INVALID_RECONCILIATION',
      );
    }
  }
  throw forbidden('Ação de conciliação não reconhecida');
}

function recordDecision(
  input: ReconciliationInput,
  plan: ReconciliationPlan,
  importId: string,
  identity: Identity,
): DecisionRecord {
  return {
    id: 'R' + randomUUID().replace(/-/g, ''),
    importId,
    status: plan.status,
    allocations: plan.allocations,
    adjustmentCents: plan.adjustmentCents,
    remainderCents: plan.remainderCents,
    category: safeText(input.category, 90),
    costCenter: safeText(input.costCenter, 90),
    notes: safeText(input.notes, 500),
    actor: identity.erpUser,
    uid: identity.uid,
    createdAt: Date.now(),
    source: input.action === 'undo' ? 'manual-reversal' : 'manual-reconciliation',
  };
}

async function fetchAccount(db: Database, code: string): Promise<Row | undefined> {
  return rows((await db.ref('erp/bancos').get()).val())
    .map(([, bank]) => bank)
    .find((bank) => String(bank.cod) === code);
}

const toBrazilianDate = (date: unknown): string => {
  const text = String(date);
  return text.slice(8, 10) + '/' + text.slice(5, 7) + '/' + text.slice(0, 4);
};

async function createTitle(
  db: Database,
  identity: Identity,
  input: ReconciliationInput,
  code: string,
  account: Row,
  imports: Record<string, ImportedMovement>,
) {
  const incoming = String(input.importId || '');
  const imported = imports[incoming];
  if (!imported) throw forbidden('Movimentação importada não encontrada', 404);
  const kind = cents(imported.amountCents) > 0n ? 'receivable' : 'payable';
  if (
    (kind === 'payable' && !canSeePayables(identity)) ||
    (kind === 'receivable' && !canSeeReceivables(identity))
  ) {
    throw forbidden('Sem permissão para cadastrar títulos financeiros', 403);
  }
  if (input.confirm !== true) throw forbidden('Confirme a criação do título financeiro');
  let amount: bigint;
  try {
    amount = cents(input.amountCents || ABS(cents(imported.amountCents)).toString());
  } catch {
    throw forbidden('Valor do título inválido');
  }
  if (amount <= 0n || amount > 1000000000000n || amount > ABS(cents(imported.amountCents))) {
    throw forbidden('Valor do título fora dos limites');
  }
  const party = safeText(input.party, 120);
  const category = safeText(input.category, 90);
  const description = safeText(input.description || imported.description, 240);
  const company = safeText(account.empresa || input.company, 120);
  if (!party || !category || !description)
    throw forbidden('Informe nome, categoria e descrição para cadastrar o título');
  if (kind === 'payable' && !company) throw forbidden('Informe a empresa responsável pela conta a pagar');
  const digest = createHash('sha256')
    .update(code + '|' + incoming + '|title')
    .digest('hex')
    .slice(0, 26);
  const id = (kind === 'payable' ? 'CPR-' : 'CRR-') + digest;
  const due = toBrazilianDate(imported.date);
  const meta = {
    id,
    valor: Number(amount) / 100,
    venc: due,
    status: 'Pendente',
    reconciliationImportId: incoming,
    reconciliationBankCode: code,
    reconciliationBy: identity.erpUser,
    reconciliationAt: new Date().toISOString(),
  };
  const record =
    kind === 'payable'
      ? {
          ...meta,
          lancto: due,
          desc: description,
          cred: party,
          cat: category,
          bancoCod: code,
          bancoNome: String(account.banco || ''),
          tipoForn: 'despesa',
          empresa: company,
          obs: 'Criado via conciliação. Baixa financeira pendente.',
        }
      : {
          ...meta,
          data: due,
          cli: party,
          nf: '',
          desc: description,
          cat: category,
          dataReceb: '',
          obs: 'Criado via conciliação. Recebimento pendente.',
        };
  const ref = db.ref('erp/' + (kind === 'payable' ? 'contasPagar' : 'contasReceber') + '/' + id);
  const result = await runTransaction(ref, (previous) => (previous === null ? record : undefined));
  if (!result.committed) {
    const existing = (await ref.get()).val() as Row | null;
    if (existing?.reconciliationImportId !== incoming)
      throw forbidden('Identificador financeiro em uso', 409);
  }
  return { created: result.committed, id, kind, record: result.committed ? record : (await ref.get()).val() };
}

async function createBankEntry(
  db: Database,
  identity: Identity,
  input: ReconciliationInput,
  code: string,
  imports: Record<string, ImportedMovement>,
) {
  const importId = safeText(input.importId, 100);
  const imported = imports[importId];
  if (!imported) throw forbidden('Movimentação importada não encontrada');
  let raw: bigint;
  try {
    raw = cents(imported.amountCents);
  } catch {
    throw forbidden('Valor da movimentação bancária inválido');
  }
  if (ABS(raw) > 1000000000000n) throw forbidden('Valor incompatível com módulo bancário legado');
  if (input.confirm !== true) throw forbidden('Confirme a criação da movimentação bancária');
  const id =
    'LBR-' +
    createHash('sha256')
      .update(code + '|' + importId)
      .digest('hex')
      .slice(0, 26);
  const entry = {
    id,
    bancoCod: code,
    data: imported.date,
    descricao: safeText(input.description || imported.description, 240),
    tipo: raw > 0n ? 'Entrada' : 'Saída',
    valor: Number(ABS(raw)) / 100,
    reconciliationImportId: importId,
    reconciliationBy: identity.erpUser,
    reconciliationAt: new Date().toISOString(),
  };
  const ref = db.ref('erp/lancBanco/' + id);
  const result = await runTransaction(ref, (previous) => (previous === null ? entry : undefined));
  if (!result.committed) {
    const existing = (await ref.get()).val() as Row | null;
    if (existing?.reconciliationImportId !== importId)
      throw forbidden('Identificador de movimentação já utilizado', 409);
  }
  return { created: result.committed, id, record: entry };
}

const STATUS_LABELS: Record<string, string> = {
  reconciled: 'conciliada',
  classified: 'classificada',
  archived: 'arquivada',
};

export async function executeReconciliation(
  identity: Identity,
  input: ReconciliationInput,
  { db: injected }: { db?: Database } = {},
) {
  if (!identity.erpAccess || !identity.canBanking) throw forbidden('Acesso bancário não autorizado', 403);
  const code = String(input.bankCode || '');
  if (!validCode(code)) throw forbidden('Conta bancária inválida');
  const db = injected ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const account = await fetchAccount(db, code);
  if (!account) throw forbidden('Conta bancária inexistente', 404);
  const [importSnap, legacySnap, bankSnap, payableSnap, receivableSnap] = await Promise.all([
    db.ref('erp/bankReconciliationImports/' + code).get(),
    db.ref('erp/bankReconciliationEvents/' + code).get(),
    db.ref('erp/lancBanco').get(),
    identity.canFinance ? db.ref('erp/contasPagar').get() : Promise.resolve(null),
    identity.canFinance || identity.canReceivables
      ? db.ref('erp/contasReceber').get()
      : Promise.resolve(null),
  ]);
  const imports = (importSnap.val() ?? {}) as Record<string, ImportedMovement>;
  const legacy = latestLegacy(legacySnap.val() ?? {}, imports);
  const targets = profileTargets(
    { lancBanco: bankSnap.val(), contasPagar: payableSnap?.val(), contasReceber: receivableSnap?.val() },
    code,
    identity,
  );
  const action = String(input.action || '');
  if (action === 'snapshot') {
    const state = ((await db.ref('erp/bankReconciliationState/' + code).get()).val() ?? {
      decisions: {},
      audit: {},
    }) as BankState;
    const effectiveDecisions = Object.fromEntries(mergeDecisions(state.decisions ?? {}, legacy));
    return { state, legacyDecisions: legacy, effectiveDecisions, targets };
  }
  if (action === 'create-title') return createTitle(db, identity, input, code, account, imports);
  if (action === 'create-bank-entry') return createBankEntry(db, identity, input, code, imports);
  if (!['reconcile', 'classify', 'archive', 'undo', 'batch'].includes(action))
    throw forbidden('Ação não suportada');
  if (action === 'batch' && (!Array.isArray(input.items) || !input.items.length || input.items.length > 30)) {
    throw forbidden('Lote deve conter entre 1 e 30 movimentações');
  }
  let failure: unknown = null;
  let records: DecisionRecord[] = [];
  const result = await runTransaction(db.ref('erp/bankReconciliationState'), (previous) => {
    failure = null;
    const global: Record<string, BankState> =
      previous && typeof previous === 'object' ? structuredClone(previous as Record<string, BankState>) : {};
    const stored = global[code];
    const state: BankState =
      stored && typeof stored === 'object' ? stored : { decisions: {}, audit: {}, revision: 0 };
    state.decisions ||= {};
    state.audit ||= {};
    const allDecisions: Record<string, Decision> = {};
    for (const bank of Object.values(global)) {
      if (!bank?.decisions) continue;
      Object.assign(allDecisions, bank.decisions);
    }
    const inputs: ReconciliationInput[] =
      action === 'batch'
        ? (input.items as Row[]).map((item) => ({ ...item, bankCode: code, action: 'reconcile' }))
        : [input];
    const next: DecisionRecord[] = [];
    try {
      if (Object.keys(state.audit).length + inputs.length > 10000) {
        throw forbidden(
          'Limite de auditoria da conta atingido; arquive mediante procedimento administrativo',
        );
      }
      for (const item of inputs) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw forbidden('Item de conciliação inválido');
        const importId = safeText(item.importId, 100);
        const plan = validateReconciliationAction({
          input: item,
          imports,
          targets,
          current: allDecisions,
          legacy,
          identity,
        });
        const existing = state.decisions[importId] ?? legacy[importId];
        if (
          item.action !== 'undo' &&
          existing &&
          ['reconciled', 'classified', 'archived'].includes(String(existing.status))
        ) {
          throw forbidden(
            'Movimentação já conciliada; estado atual: ' +
              (STATUS_LABELS[String(existing.status)] || 'processada') +
              '. Utilize Desfazer/Reabrir antes de alterar o estado.',
            409,
          );
        }
        if (item.action === 'undo' && (!existing || existing.status === 'reversed')) {
          throw forbidden('Não há conciliação para desfazer', 409);
        }
        const record = recordDecision(item, plan, importId, identity);
        state.decisions[importId] = record;
        state.audit[record.id] = record;
        allDecisions[importId] = record;
        next.push(record);
      }
      state.revision = (state.revision || 0) + 1;
      global[code] = state;
      records = next;
      return global;
    } catch (error) {
      failure = error;
      return undefined;
    }
  });
  if (!result.committed) {
    throw (
      failure ?? forbidden('Conciliação alterada por outro usuário. Atualize a tela e tente novamente.', 409)
    );
  }
  const saved = result.snapshot?.val() as Record<string, BankState> | null | undefined;
  return { revision: saved?.[code]?.revision || 0, records };
}
