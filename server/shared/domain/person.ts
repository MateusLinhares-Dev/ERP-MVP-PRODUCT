const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function validCpf(value: unknown): boolean {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  for (let size = 9; size <= 10; size++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(digits[i]) * (size + 1 - i);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(digits[size])) return false;
  }
  return true;
}

export function validCnpj(value: unknown): boolean {
  const raw = String(value ?? '')
    .toUpperCase()
    .replace(/[./\-\s]/g, '');
  if (!/^[0-9A-Z]{12}\d{2}$/.test(raw) || /^(.)\1{13}$/.test(raw)) return false;
  const checksum = (part: string, weights: number[]): number => {
    const sum = weights.reduce((acc, weight, index) => acc + (part.charCodeAt(index) - 48) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const root = raw.slice(0, 12);
  const first = checksum(root, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checksum(root + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return raw.slice(12) === String(first) + String(second);
}

export const documentKey = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');

export const nameKey = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

export function tombstoneIds(raw: unknown): Set<string> {
  if (Array.isArray(raw)) return new Set(raw.filter((value) => value != null && value !== '').map(String));
  if (!raw || typeof raw !== 'object') return new Set();
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    if (value === true || value === 1 || value === 'true') ids.add(key);
    else if (typeof value === 'string' && value) ids.add(value);
  }
  return ids;
}
