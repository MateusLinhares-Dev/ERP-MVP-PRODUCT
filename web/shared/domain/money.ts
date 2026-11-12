export function toCents(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function roundMoney(value: unknown): number {
  return fromCents(toCents(value));
}

export function formatAmount(value: unknown): string {
  const amount = Number(value ?? 0);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBRL(value: unknown): string {
  const amount = Number(value ?? 0);
  return (amount < 0 ? '- R$ ' : 'R$ ') + formatAmount(Math.abs(amount));
}

export function formatQuantity(value: unknown): string {
  const amount = Number(value ?? 0);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
  });
}
