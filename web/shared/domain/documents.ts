const digitsOf = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

export function validCpf(value: unknown): boolean {
  const digits = digitsOf(value);
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

export function formatCpf(value: unknown): string {
  const digits = digitsOf(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatCnpj(value: unknown): string {
  const raw = String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14);
  const parts = [raw.slice(0, 2), raw.slice(2, 5), raw.slice(5, 8), raw.slice(8, 12), raw.slice(12, 14)];
  let text = parts[0] ?? '';
  if (parts[1]) text += '.' + parts[1];
  if (parts[2]) text += '.' + parts[2];
  if (parts[3]) text += '/' + parts[3];
  if (parts[4]) text += '-' + parts[4];
  return text;
}

export function formatPhone(value: unknown): string {
  const digits = digitsOf(value).slice(0, 11);
  if (digits.length <= 2) return digits.length ? '(' + digits : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function formatCep(value: unknown): string {
  const digits = digitsOf(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export const searchKey = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
