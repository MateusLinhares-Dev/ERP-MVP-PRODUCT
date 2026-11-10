export interface Allocation {
  kind: string;
  id: string;
  amountCents: string;
}

export interface Decision {
  id?: string;
  importId?: string;
  createdAt?: unknown;
  status?: string;
  targetId?: string;
  targetKind?: string;
  amountCents?: string;
  allocations?: Allocation[];
  [field: string]: unknown;
}

export interface ImportedMovement {
  id?: string;
  date?: string;
  description?: string;
  amountCents?: string | number | bigint;
  [field: string]: unknown;
}

export interface ReconciliationTarget {
  id: string;
  kind: string;
  date: string;
  description: string;
  amount?: unknown;
  amountCents?: string | number | bigint;
  status?: unknown;
  bankCode?: string;
  direction?: string;
}

export interface ReconciliationPlan {
  status: string;
  allocations: Allocation[];
  adjustmentCents: string;
  remainderCents: string;
  allocatedCents?: string;
}

export interface PlanInput {
  imported: ImportedMovement;
  allocations: unknown[];
  adjustmentCents: unknown;
  category: unknown;
  targets: ReconciliationTarget[];
  decisions: Map<string, Decision>;
  status: string;
}

export interface Suggestion extends ReconciliationTarget {
  remainingCents: string;
  score: number;
}

export interface PlannedMatch {
  importId: string | undefined;
  allocations: Allocation[];
}

type Decisions = Map<string, Decision> | Record<string, Decision | null | undefined> | null | undefined;

const KINDS = ['bankEntry', 'payable', 'receivable'];
const STATUSES = ['reconciled', 'partial', 'classified'];
const MAX_ADJUSTMENT = 1000000000n;
const MAX_ALLOCATIONS = 30;
const DAY_MS = 86400000;
const MAX_DAY_PENALTY = 45;

export const MAX_BANK_CENTS = 9007199254740991n;

export function ABS(value: bigint | string | number): bigint {
  const n = BigInt(value);
  return n < 0n ? -n : n;
}

export const targetKey = (kind: string, id: string): string => `${kind}:${id}`;

export function cents(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Centavos fora da faixa segura');
  const raw = String(value ?? '');
  if (!/^-?\d{1,30}$/.test(raw)) throw new Error('Valor em centavos inválido');
  return BigInt(raw);
}

export function decimalCents(value: unknown): bigint {
  const raw = String(value ?? '')
    .trim()
    .replace(/\s|R\$/gi, '');
  const canonical = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const match = /^(-?)(\d{1,20})(?:\.(\d{1,2}))?$/.exec(canonical);
  if (!match) throw new Error('Valor monetário inválido');
  const amount = BigInt(match[2] ?? '0') * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -amount : amount;
}

export function signedAmount(raw: unknown): bigint {
  const amount = cents(raw);
  if (amount === 0n) throw new Error('Movimentação com valor zero');
  return amount;
}

export function targetAmount(target: ReconciliationTarget): bigint {
  if (target.amountCents !== undefined) return ABS(cents(target.amountCents));
  return ABS(decimalCents(target.amount));
}

export function targetDirection(imported: ImportedMovement): 'income' | 'expense' {
  return signedAmount(imported.amountCents) > 0n ? 'income' : 'expense';
}

export function compatible(imported: ImportedMovement, target: ReconciliationTarget): boolean {
  const direction = targetDirection(imported);
  if (target.kind === 'bankEntry') return target.direction === direction;
  return direction === 'income' ? target.kind === 'receivable' : target.kind === 'payable';
}

export function latestDecisions(events: unknown): Map<string, Decision> {
  const latest = new Map<string, Decision>();
  const source = events && typeof events === 'object' ? Object.values(events as Record<string, unknown>) : [];
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Decision;
    if (!event.importId) continue;
    const previous = latest.get(event.importId);
    const newer =
      !previous ||
      Number(event.createdAt) > Number(previous.createdAt) ||
      (Number(event.createdAt) === Number(previous.createdAt) && String(event.id) > String(previous.id));
    if (newer) latest.set(event.importId, event);
  }
  return latest;
}

export function currentAllocations(decision: Decision | null | undefined): Allocation[] {
  if (!decision || decision.status === 'reversed') return [];
  if (Array.isArray(decision.allocations)) return decision.allocations;
  if (
    decision.status === 'reconciled' &&
    decision.targetId &&
    decision.targetKind !== 'manual' &&
    decision.targetKind !== 'none'
  ) {
    return [
      { kind: String(decision.targetKind), id: decision.targetId, amountCents: decision.amountCents || '0' },
    ];
  }
  return [];
}

function decisionList(decisions: Decisions): (Decision | null | undefined)[] {
  if (decisions instanceof Map) return [...decisions.values()];
  return Object.values(decisions ?? {});
}

export function consumedByTarget(decisions: Decisions, excludeImportId = ''): Map<string, bigint> {
  const amounts = new Map<string, bigint>();
  for (const decision of decisionList(decisions)) {
    if (!decision || decision.importId === excludeImportId || decision.status === 'reversed') continue;
    for (const allocation of currentAllocations(decision)) {
      const key = targetKey(allocation.kind, allocation.id);
      amounts.set(key, (amounts.get(key) ?? 0n) + ABS(cents(allocation.amountCents)));
    }
  }
  return amounts;
}

export function remainingForTarget(
  target: ReconciliationTarget,
  decisions: Decisions,
  excludeImport = '',
): bigint {
  const used = consumedByTarget(decisions, excludeImport).get(targetKey(target.kind, target.id)) ?? 0n;
  const remaining = targetAmount(target) - used;
  return remaining > 0n ? remaining : 0n;
}

export function validatePlan({
  imported,
  allocations = [],
  adjustmentCents = '0',
  category = '',
  targets = [],
  decisions = new Map(),
  status = 'reconciled',
}: Partial<PlanInput> = {}): ReconciliationPlan {
  if (!imported?.id) throw new Error('Movimentação bancária não encontrada');
  if (!STATUSES.includes(status)) throw new Error('Situação inválida');
  if (!Array.isArray(allocations) || allocations.length > MAX_ALLOCATIONS) {
    throw new Error('Máximo de 30 títulos por movimentação');
  }
  const known = new Map(targets.map((target) => [targetKey(target.kind, target.id), target]));
  const seen = new Set<string>();
  let allocated = 0n;
  const safe = allocations.map((raw): Allocation => {
    const row = (raw && typeof raw === 'object' ? raw : {}) as {
      kind?: unknown;
      id?: unknown;
      amountCents?: unknown;
    };
    const kind = String(row.kind);
    const id = String(row.id);
    if (!KINDS.includes(kind) || !id || id.length > 120) throw new Error('Referência financeira inválida');
    const key = targetKey(kind, id);
    const target = known.get(key);
    if (!target || !compatible(imported, target))
      throw new Error('Título incompatível ou sem permissão: ' + key);
    if (seen.has(key)) throw new Error('Título duplicado na seleção');
    seen.add(key);
    const part = cents(row.amountCents);
    if (part <= 0n) throw new Error('Valor da parcela precisa ser positivo');
    if (part > remainingForTarget(target, decisions, imported.id)) {
      throw new Error('Valor excede o saldo disponível do título ' + id);
    }
    if (kind === 'bankEntry' && part !== targetAmount(target)) {
      throw new Error('Movimento do ERP exige conciliação integral');
    }
    allocated += part;
    return { kind, id, amountCents: part.toString() };
  });
  const adjustment = cents(adjustmentCents);
  if (ABS(adjustment) > MAX_ADJUSTMENT) throw new Error('Ajuste excede o limite permitido');
  const hasCategory = Boolean(String(category).trim());
  if (adjustment !== 0n && !hasCategory) throw new Error('Informe a categoria do ajuste/tarifa');
  const importedAbs = ABS(signedAmount(imported.amountCents));
  const remainder = importedAbs - allocated - adjustment;
  if (remainder < 0n) throw new Error('Valores selecionados superam o extrato');
  if (status === 'reconciled' && (remainder !== 0n || !safe.length)) {
    throw new Error('Conciliação exige valor conferido e vínculo financeiro');
  }
  if (status === 'partial' && (remainder === 0n || !safe.length)) {
    throw new Error('Conciliação parcial precisa de vínculo e saldo pendente');
  }
  if (status === 'classified' && (safe.length || !hasCategory || adjustment !== 0n)) {
    throw new Error('Classificação sem vínculo exige categoria');
  }
  return {
    status,
    allocations: safe,
    adjustmentCents: adjustment.toString(),
    remainderCents: remainder.toString(),
    allocatedCents: allocated.toString(),
  };
}

function dayDistance(a: string | undefined, b: string | undefined): number {
  const diff = Math.floor(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(diff) ? Math.min(MAX_DAY_PENALTY, diff) : MAX_DAY_PENALTY;
}

const words = (text: unknown): string[] =>
  String(text || '')
    .toLowerCase()
    .split(/\W+/);

export function scoreMatch(entry: ImportedMovement, target: ReconciliationTarget, remaining: bigint): number {
  if (!compatible(entry, target) || remaining <= 0n) return -1000;
  const imported = ABS(cents(entry.amountCents));
  const exact = remaining === imported ? 80 : remaining < imported ? 45 : 20;
  const overlap = new Set(words(entry.description).filter((word) => word.length > 3));
  const relevant = words(target.description).filter((word) => overlap.has(word));
  return (
    exact -
    dayDistance(entry.date, target.date) +
    Math.min(20, relevant.length * 5) +
    (target.kind === 'bankEntry' ? 25 : 0)
  );
}

export function suggestions(
  entry: ImportedMovement,
  targets: readonly ReconciliationTarget[],
  decisions: Decisions,
  { limit = 30 }: { limit?: number } = {},
): Suggestion[] {
  return targets
    .map((target) => {
      const remaining = remainingForTarget(target, decisions, entry.id);
      return { ...target, remainingCents: remaining.toString(), score: scoreMatch(entry, target, remaining) };
    })
    .filter((target) => target.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function suggestCombinations(
  entry: ImportedMovement,
  targets: readonly ReconciliationTarget[],
  decisions: Decisions,
  { limit = 8, maxItems = 4 }: { limit?: number; maxItems?: number } = {},
): Allocation[][] {
  const required = ABS(cents(entry.amountCents));
  const candidates = suggestions(entry, targets, decisions, { limit: 18 }).filter(
    (candidate) => candidate.kind !== 'bankEntry' && cents(candidate.remainingCents) <= required,
  );
  const found: Allocation[][] = [];
  function visit(index: number, selected: Suggestion[], sum: bigint): void {
    if (found.length >= limit) return;
    if (sum === required) {
      found.push(
        selected.map((item) => ({ kind: item.kind, id: item.id, amountCents: item.remainingCents })),
      );
      return;
    }
    if (selected.length >= maxItems || sum > required) return;
    for (let i = index; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!candidate) continue;
      const amount = cents(candidate.remainingCents);
      if (amount > 0n && sum + amount <= required) visit(i + 1, [...selected, candidate], sum + amount);
      if (found.length >= limit) return;
    }
  }
  visit(0, [], 0n);
  return found;
}

export function batchSuggestions(
  imports: readonly ImportedMovement[],
  targets: readonly ReconciliationTarget[],
  decisions: Map<string, Decision>,
  { limit = 30 }: { limit?: number } = {},
): PlannedMatch[] {
  const used = new Set<string>();
  const planned: PlannedMatch[] = [];
  for (const item of imports.slice(0, limit)) {
    const status = item.id ? decisions.get(item.id)?.status : undefined;
    if (status === 'reconciled' || status === 'classified') continue;
    const exact = ABS(cents(item.amountCents)).toString();
    const found = suggestions(item, targets, decisions).find(
      (target) =>
        target.score >= 75 && target.remainingCents === exact && !used.has(targetKey(target.kind, target.id)),
    );
    if (found) {
      used.add(targetKey(found.kind, found.id));
      planned.push({
        importId: item.id,
        allocations: [{ kind: found.kind, id: found.id, amountCents: found.remainingCents }],
      });
    }
  }
  return planned;
}
