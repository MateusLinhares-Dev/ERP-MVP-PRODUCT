export function parseDecimal(text: unknown): number | null {
  let value = String(text ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');
  if (!value) return null;
  if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toFieldText(value: number | null | undefined): string {
  if (value == null) return '';
  return String(Math.round(Number(value) * 10000) / 10000).replace('.', ',');
}
