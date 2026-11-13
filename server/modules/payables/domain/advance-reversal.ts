export interface AdvanceEntry {
  cod?: string;
  valor?: number;
  valorOriginal?: number;
  valorCompensado?: number;
  valorDisponivel?: number;
  status?: string;
  ticket?: string;
  ticketOrigem?: string;
  obs?: string;
  origem?: string;
  adiantamentoOrigem?: string;
  data?: string;
  [field: string]: unknown;
}

export interface AdvanceUse {
  cod: string;
  valor: number;
  parcial?: string;
}

export interface ReversalPayment {
  data?: unknown;
  adt?: unknown;
  adtUsos?: unknown;
}

const cents = (value: unknown): number => Math.round((Number(value) || 0) * 100);
const money = (value: number): number => Math.round(value) / 100;
const text = (value: unknown): string => String(value ?? '').trim();
const PAID = 'Quitado';
const SPLIT = 'compensacao_cp';

function recordedUses(payment: ReversalPayment): AdvanceUse[] | null {
  if (!Array.isArray(payment.adtUsos)) return null;
  return payment.adtUsos
    .filter((use): use is Record<string, unknown> => Boolean(use) && typeof use === 'object')
    .map((use) => {
      const parsed: AdvanceUse = { cod: text(use.cod), valor: Number(use.valor) || 0 };
      if (text(use.parcial)) parsed.parcial = text(use.parcial);
      return parsed;
    });
}

function inferredUses(list: readonly AdvanceEntry[], payment: ReversalPayment, ticket: string): AdvanceUse[] {
  const date = text(payment.data);
  const mark = 'Compensado em CP ' + date;
  const uses: AdvanceUse[] = [];
  for (const row of list) {
    if (text(row.status) !== PAID || text(row.ticket) !== ticket) continue;
    if (row.origem === SPLIT) {
      if (text(row.data) === date && text(row.adiantamentoOrigem))
        uses.push({
          cod: text(row.adiantamentoOrigem),
          valor: Number(row.valor) || 0,
          parcial: text(row.cod),
        });
    } else if (text(row.obs).includes(mark)) uses.push({ cod: text(row.cod), valor: Number(row.valor) || 0 });
  }
  return uses;
}

function withoutMark(obs: unknown, date: string): string {
  const value = text(obs);
  const mark = 'Compensado em CP ' + date;
  const at = value.lastIndexOf(mark);
  if (at < 0) return value;
  const before = value.slice(0, at).replace(/\s*\|\s*$/, '');
  return (before + value.slice(at + mark.length)).trim();
}

function unlink(row: AdvanceEntry, ticket: string): void {
  if (text(row.ticket) === ticket) row.ticket = '';
  if (text(row.ticketOrigem) === ticket) delete row.ticketOrigem;
}

export function restoreAdvances(
  ledger: readonly AdvanceEntry[],
  payment: ReversalPayment,
  ticket: string,
): { entries: AdvanceEntry[] } | { problem: string } {
  const target = cents(payment.adt);
  if (target <= 0) return { entries: ledger.map((row) => ({ ...row })) };
  const ambiguous = {
    problem:
      'Não foi possível identificar com segurança quais adiantamentos este pagamento usou. Nada foi alterado; peça ajuda ao suporte.',
  };
  const uses = recordedUses(payment) ?? inferredUses(ledger, payment, text(ticket));
  if (!uses.length || uses.reduce((sum, use) => sum + cents(use.valor), 0) !== target) return ambiguous;
  let entries = ledger.map((row) => ({ ...row }));
  const date = text(payment.data);
  for (const use of uses) {
    const amount = cents(use.valor);
    const origin = entries.find((row) => text(row.cod) === use.cod);
    if (!origin || amount <= 0) return ambiguous;
    if (use.parcial) {
      const split = entries.find((row) => text(row.cod) === use.parcial);
      if (!split || cents(split.valor) !== amount || text(split.status) !== PAID) return ambiguous;
      if (text(origin.status) !== 'Pendente')
        return {
          problem:
            'O adiantamento usado neste pagamento foi usado de novo depois. Exclua primeiro o pagamento mais recente.',
        };
      origin.valor = money(cents(origin.valor) + amount);
      if (origin.valorDisponivel != null)
        origin.valorDisponivel = money(cents(origin.valorDisponivel) + amount);
      entries = entries.filter((row) => row !== split);
    } else {
      if (text(origin.status) !== PAID || cents(origin.valor) !== amount) return ambiguous;
      origin.status = 'Pendente';
      if (origin.valorDisponivel != null) origin.valorDisponivel = money(amount);
      origin.obs = withoutMark(origin.obs, date);
    }
    origin.valorCompensado = money(Math.max(0, cents(origin.valorCompensado) - amount));
    unlink(origin, text(ticket));
  }
  return { entries };
}
