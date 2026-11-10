import * as engine from '../../../../public/modules/banking/reconciliation-engine.mjs';

export interface Allocation {
  kind: string;
  id: string;
  amountCents: string;
}

export interface Decision {
  status?: string;
  targetId?: string;
  targetKind?: string;
  allocations?: Allocation[];
  [field: string]: unknown;
}

export interface ImportedMovement {
  id?: string;
  date?: string;
  description?: string;
  amountCents?: string | number;
  [field: string]: unknown;
}

export interface ReconciliationTarget {
  id: string;
  kind: string;
  date: string;
  description: string;
  amount: unknown;
  status?: unknown;
  bankCode?: string;
  direction?: string;
}

export interface ReconciliationPlan {
  status: string;
  allocations: Allocation[];
  adjustmentCents: string;
  remainderCents: string;
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

export const ABS = engine.ABS as unknown as (value: bigint | string | number) => bigint;
export const cents = engine.cents as unknown as (value: unknown) => bigint;
export const latestDecisions = engine.latestDecisions as unknown as (
  events: unknown,
) => Map<string, Decision>;
export const validatePlan = engine.validatePlan as unknown as (input: PlanInput) => ReconciliationPlan;
