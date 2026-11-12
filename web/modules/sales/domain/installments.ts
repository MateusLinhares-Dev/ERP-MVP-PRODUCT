import { addDays } from '../../../shared/domain/dates.js';

export const MAX_INSTALLMENTS = 36;

export type PaymentPlan = { kind: 'count'; count: number } | { kind: 'days'; days: number[] };

export function parseCondition(text: unknown): PaymentPlan | null {
  const raw = String(text ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR');
  if (!raw) return null;
  if (/^(a|à)\s*vista$|^avista$/.test(raw)) return { kind: 'days', days: [0] };
  const times = /^(\d{1,2})\s*(x|vezes|parcelas?)$/.exec(raw);
  if (times) {
    const count = Number(times[1]);
    return count >= 1 && count <= MAX_INSTALLMENTS ? { kind: 'count', count } : null;
  }
  const parts = raw
    .replace(/\s*dias?$/, '')
    .split(/[\s,;/+]+/)
    .filter(Boolean);
  if (!parts.length || parts.length > MAX_INSTALLMENTS || parts.some((part) => !/^\d{1,4}$/.test(part)))
    return null;
  return { kind: 'days', days: parts.map(Number) };
}

export function planSize(plan: PaymentPlan): number {
  return plan.kind === 'count' ? plan.count : plan.days.length;
}

export function splitPlan(
  plan: PaymentPlan,
  balanceCents: number,
  saleDate: string,
  firstDueDate: string,
): Array<{ dueDate: string; cents: number }> {
  const dates =
    plan.kind === 'count'
      ? Array.from({ length: plan.count }, () => firstDueDate || saleDate)
      : plan.days.map((day) => addDays(saleDate, day));
  const total = Math.max(0, Math.round(balanceCents));
  const share = Math.floor(total / dates.length);
  return dates.map((dueDate, index) => ({
    dueDate,
    cents: index === dates.length - 1 ? total - share * (dates.length - 1) : share,
  }));
}
