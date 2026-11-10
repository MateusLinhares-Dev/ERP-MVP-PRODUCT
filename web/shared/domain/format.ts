export function formatMoney(value: unknown): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNumber(value: unknown, decimals = 3): string {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: decimals });
}

export function formatDate(iso: unknown): string {
  return iso ? String(iso).split('-').reverse().join('/') : '';
}

export function formatDateTime(epochMs: unknown): string {
  return new Date(Number(epochMs) || 0).toLocaleString('pt-BR');
}
