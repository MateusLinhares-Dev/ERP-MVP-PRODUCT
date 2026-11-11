import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export const SUPPLIER_FIELDS = {
  nome: 160,
  fantasia: 160,
  nomeFantasia: 160,
  personType: 2,
  desde: 10,
  dataCadastro: 10,
  cpf: 20,
  cnpj: 20,
  rg: 30,
  ie: 30,
  orgaoEmissor: 30,
  contribuinte: 40,
  tel: 30,
  wpp: 30,
  email: 120,
  cep: 12,
  uf: 2,
  cidadeNome: 80,
  cidade: 90,
  rua: 160,
  num: 20,
  compl: 80,
  bairro: 80,
  pix: 160,
  banco: 80,
  agencia: 20,
  conta: 30,
  obs: 1000,
  nota: 2000,
} as const;

export type SupplierField = keyof typeof SUPPLIER_FIELDS;

export interface SupplierProblem {
  code: string;
  message: string;
}

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
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

export function cleanSupplier(input: unknown): {
  fields: Partial<Record<SupplierField, string>>;
  problems: SupplierProblem[];
} {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as Row) : {};
  const fields: Partial<Record<SupplierField, string>> = {};
  const problems: SupplierProblem[] = [];
  for (const [field, max] of Object.entries(SUPPLIER_FIELDS) as [SupplierField, number][]) {
    if (!(field in source)) continue;
    const value = String(source[field] ?? '').trim();
    if (value.length > max)
      problems.push({ code: 'FIELD_TOO_LONG', message: `O campo ${field} passou do tamanho permitido.` });
    if (hasControlChars(value.replace(/[\r\n\t]/g, ' ')))
      problems.push({ code: 'INVALID_TEXT', message: `O campo ${field} tem caracteres inválidos.` });
    fields[field] = value.slice(0, max);
  }
  if ('nome' in fields) fields.nome = String(fields.nome).replace(/\s+/g, ' ').toUpperCase();
  if ('uf' in fields) fields.uf = String(fields.uf).toUpperCase();
  if (fields.personType && !['PF', 'PJ'].includes(fields.personType))
    problems.push({ code: 'INVALID_PERSON_TYPE', message: 'Tipo de pessoa inválido.' });
  if (fields.cpf && !validCpf(fields.cpf))
    problems.push({ code: 'INVALID_CPF', message: 'CPF inválido. Confira os dígitos.' });
  if (fields.cnpj && !validCnpj(fields.cnpj))
    problems.push({ code: 'INVALID_CNPJ', message: 'CNPJ inválido. Confira os dígitos.' });
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
    problems.push({ code: 'INVALID_EMAIL', message: 'E-mail inválido.' });
  for (const field of ['desde', 'dataCadastro'] as const) {
    const value = fields[field];
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      problems.push({ code: 'INVALID_DATE', message: 'Data inválida em "Fornecedor desde".' });
  }
  return { fields, problems };
}

export function nextSupplierCode(existing: Iterable<string>): string {
  const reserved = new Set(existing);
  let next =
    Math.max(0, ...[...reserved].map((code) => (/^F(\d+)$/.test(code) ? Number(code.slice(1)) : 0))) + 1;
  while (reserved.has('F' + String(next).padStart(3, '0'))) next++;
  return 'F' + String(next).padStart(3, '0');
}

export interface StoredSupplier {
  key: string;
  record: Row;
}

export function supplierEntries(raw: unknown): StoredSupplier[] {
  return Object.entries(raw && typeof raw === 'object' ? (raw as Row) : {})
    .filter(
      (entry): entry is [string, Row] =>
        Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
    )
    .map(([key, record]) => ({ key, record }));
}

export function duplicateDocument(
  entries: readonly StoredSupplier[],
  deleted: ReadonlySet<string>,
  fields: Partial<Record<SupplierField, string>>,
  ignoreCode = '',
): StoredSupplier | undefined {
  const keys = [documentKey(fields.cpf), documentKey(fields.cnpj)].filter(Boolean);
  if (!keys.length) return undefined;
  return entries.find(({ record }) => {
    const code = String(record.cod ?? '');
    if (!code || code === ignoreCode || deleted.has(code)) return false;
    return keys.includes(documentKey(record.cpf)) || keys.includes(documentKey(record.cnpj));
  });
}
