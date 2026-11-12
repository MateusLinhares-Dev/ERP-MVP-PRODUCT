const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function foldAccents(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase();
}

export function nameKey(value: unknown): string {
  return foldAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
