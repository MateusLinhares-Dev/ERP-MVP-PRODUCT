import { documentKey, nameKey, validCnpj, validCpf } from '../../../shared/domain/person.js';
import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export const CUSTOMER_FIELDS = {
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
  status: 20,
} as const;

export type CustomerField = keyof typeof CUSTOMER_FIELDS;

export type CustomerFields = Partial<Record<CustomerField, string>> & { limite?: number };

export interface CustomerProblem {
  code: string;
  message: string;
}

export const FORBIDDEN_NAME_CHARS = /[.#$/[\]]/;

export function cleanCustomer(input: unknown): { fields: CustomerFields; problems: CustomerProblem[] } {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as Row) : {};
  const fields: CustomerFields = {};
  const problems: CustomerProblem[] = [];
  for (const [field, max] of Object.entries(CUSTOMER_FIELDS) as [CustomerField, number][]) {
    if (!(field in source)) continue;
    const value = String(source[field] ?? '').trim();
    if (value.length > max)
      problems.push({ code: 'FIELD_TOO_LONG', message: `O campo ${field} passou do tamanho permitido.` });
    if (hasControlChars(value.replace(/[\r\n\t]/g, ' ')))
      problems.push({ code: 'INVALID_TEXT', message: `O campo ${field} tem caracteres inválidos.` });
    fields[field] = value.slice(0, max);
  }
  if ('limite' in source) {
    const limit = Number(String(source.limite ?? '').replace(',', '.') || 0);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1e12)
      problems.push({ code: 'INVALID_LIMIT', message: 'Limite de crédito inválido.' });
    else fields.limite = Math.round(limit * 100) / 100;
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
      problems.push({ code: 'INVALID_DATE', message: 'Data inválida em "Cliente desde".' });
  }
  return { fields, problems };
}

export function nameProblem(name: string): CustomerProblem | null {
  if (!name) return { code: 'CUSTOMER_NAME_REQUIRED', message: 'Informe o nome do cliente.' };
  if (FORBIDDEN_NAME_CHARS.test(name))
    return {
      code: 'INVALID_CUSTOMER_NAME',
      message: 'O nome do cliente não pode ter . # $ [ ] / (o histórico do cliente é guardado pelo nome).',
    };
  return null;
}

export function nextCustomerCode(existing: Iterable<string>): string {
  const reserved = new Set(existing);
  let next =
    Math.max(0, ...[...reserved].map((code) => (/^C(\d+)$/.test(code) ? Number(code.slice(1)) : 0))) + 1;
  while (reserved.has('C' + String(next).padStart(3, '0'))) next++;
  return 'C' + String(next).padStart(3, '0');
}

export interface StoredCustomer {
  key: string;
  record: Row;
}

export function customerEntries(raw: unknown, deleted: ReadonlySet<string> = new Set()): StoredCustomer[] {
  return Object.entries(raw && typeof raw === 'object' ? (raw as Row) : {})
    .filter(
      (entry): entry is [string, Row] =>
        Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
    )
    .map(([key, record]) => ({ key, record }))
    .filter(({ key, record }) => !deleted.has(key) && !deleted.has(String(record.id ?? '')));
}

export function findCustomer(entries: readonly StoredCustomer[], id: string): StoredCustomer | undefined {
  return (
    entries.find(({ key }) => key === id) ?? entries.find(({ record }) => String(record.id ?? '') === id)
  );
}

export function duplicateDocument(
  entries: readonly StoredCustomer[],
  fields: CustomerFields,
  ignoreKey = '',
): StoredCustomer | undefined {
  const keys = [documentKey(fields.cpf), documentKey(fields.cnpj)].filter(Boolean);
  if (!keys.length) return undefined;
  return entries.find(
    ({ key, record }) =>
      key !== ignoreKey &&
      (keys.includes(documentKey(record.cpf)) || keys.includes(documentKey(record.cnpj))),
  );
}

export function duplicateName(
  entries: readonly StoredCustomer[],
  name: string,
  ignoreKey = '',
): StoredCustomer | undefined {
  const target = nameKey(name);
  return entries.find(({ key, record }) => key !== ignoreKey && nameKey(record.nome) === target);
}

export function describe(entry: StoredCustomer): string {
  const code = String(entry.record.cod ?? entry.key).slice(0, 20);
  return `${code} — ${String(entry.record.nome ?? '').slice(0, 160)}`;
}
