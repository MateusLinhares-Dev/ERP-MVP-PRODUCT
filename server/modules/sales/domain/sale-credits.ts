import { fromCents, toCents } from '../../../shared/domain/money.js';
import { amount, isRaw, text } from './sales.js';
import type { Raw } from './sales.js';

export interface CreditUseInput {
  kind: 'advance' | 'cheque';
  ref: string;
  amount: number;
}

export interface CreditProblem {
  code: string;
  message: string;
}

const CLOSED_CHEQUE = new Set(['Compensado', 'Devolvido', 'Quitado']);
const round = (value: unknown): number => fromCents(toCents(value));

export const listOf = (value: unknown): Raw[] =>
  (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []).filter(
    isRaw,
  );

export function applyCredits(
  advances: readonly Raw[],
  cheques: readonly Raw[],
  uses: readonly CreditUseInput[],
  saleRef: string,
): { advances: Raw[]; cheques: Raw[]; problem?: CreditProblem } {
  const nextAdvances = advances.map((item) => ({ ...item }));
  const nextCheques = cheques.map((item) => ({ ...item }));
  for (const use of uses) {
    const value = round(use.amount);
    if (use.kind === 'cheque') {
      const cheque = nextCheques.find((item) => text(item.num) === use.ref);
      if (!cheque || CLOSED_CHEQUE.has(text(cheque.status) || 'Pendente'))
        return {
          advances: nextAdvances,
          cheques: nextCheques,
          problem: {
            code: 'CREDIT_CHANGED',
            message: `O cheque nº ${use.ref} não está mais disponível. Atualize a tela.`,
          },
        };
      cheque.vinculo = text(cheque.vinculo) || saleRef;
      cheque.status = 'Quitado';
      continue;
    }
    const advance = nextAdvances.find((item) => text(item.cod) === use.ref);
    const available = round(advance?.valor);
    if (
      !advance ||
      (text(advance.status) || 'Pendente') !== 'Pendente' ||
      toCents(available) < toCents(value)
    )
      return {
        advances: nextAdvances,
        cheques: nextCheques,
        problem: {
          code: 'CREDIT_CHANGED',
          message: `O adiantamento ${use.ref} mudou ou já foi usado. Atualize a tela.`,
        },
      };
    advance.vinculo = text(advance.vinculo) || saleRef;
    if (advance.valorOriginal == null) advance.valorOriginal = available;
    advance.usos = [...listOf(advance.usos), { venda: saleRef, valor: value }];
    if (toCents(value) >= toCents(available) - 1) {
      advance.status = 'Quitado';
      advance.ticket = text(advance.ticket) || saleRef;
    } else advance.valor = round(available - value);
  }
  return { advances: nextAdvances, cheques: nextCheques };
}

export function usedCredits(
  sale: Raw,
  receivables: readonly Raw[],
): Array<{ tipo: string; cod?: string; num?: string; valor: number }> {
  const recorded = listOf(sale.abatimentos);
  if (recorded.length)
    return recorded.map((item) => ({
      tipo: text(item.tipo),
      cod: text(item.cod),
      num: text(item.num),
      valor: amount(item.valor),
    }));
  const derived: Array<{ tipo: string; cod?: string; num?: string; valor: number }> = [];
  for (const row of receivables) {
    const notes = text(row.obs);
    const advance = /(ADTC\d+)/.exec(notes);
    if (text(row.forma) === 'Adiantamento' && advance?.[1])
      derived.push({ tipo: 'adiantamento', cod: advance[1], valor: amount(row.valor) });
    const cheque = /cheque (?:nº )?([^\s—|]+)/i.exec(notes);
    if (text(row.forma) === 'Cheque' && cheque?.[1])
      derived.push({ tipo: 'cheque', num: cheque[1], valor: amount(row.valor) });
  }
  return derived;
}

export function restoreCredits(
  advances: readonly Raw[],
  cheques: readonly Raw[],
  sale: Raw,
  receivables: readonly Raw[],
): { advances: Raw[]; cheques: Raw[]; restored: number } {
  const ref = text(sale.nf) || text(sale.id);
  const nextAdvances = advances.map((item) => ({ ...item }));
  const nextCheques = cheques.map((item) => ({ ...item }));
  let restored = 0;
  for (const used of usedCredits(sale, receivables)) {
    if (used.tipo === 'adiantamento') {
      const advance = nextAdvances.find((item) => text(item.cod) === used.cod);
      if (!advance) continue;
      if (text(advance.status) === 'Quitado') {
        advance.status = 'Pendente';
        advance.valor = round(used.valor || advance.valor);
      } else advance.valor = round(amount(advance.valor) + used.valor);
      if (Array.isArray(advance.usos) || isRaw(advance.usos))
        advance.usos = listOf(advance.usos).filter((item) => text(item.venda) !== ref);
      if (text(advance.vinculo) === ref) advance.vinculo = '';
      restored++;
    } else {
      const cheque = nextCheques.find((item) => text(item.num) === used.num);
      if (!cheque || text(cheque.status) !== 'Quitado') continue;
      cheque.status = 'Pendente';
      if (text(cheque.vinculo) === ref) cheque.vinculo = '';
      restored++;
    }
  }
  return { advances: nextAdvances, cheques: nextCheques, restored };
}
