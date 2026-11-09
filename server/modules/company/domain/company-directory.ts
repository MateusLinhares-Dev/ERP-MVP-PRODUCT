import type { Database, Reference } from 'firebase-admin/database';
import { runTransaction, type TransactionOutcome } from '../../../shared/firebase/rtdb-transaction.js';

export interface CompanyDirectory {
  schemaVersion: 3;
  revision: number;
  primaryCompanyKey: string;
  companies: string[];
  inactiveCompanies: string[];
  deletedCompanies: string[];
  [field: string]: unknown;
}

export interface CompanyDirectoryResponse {
  ok: true;
  apiVersion: 3;
  revision: number;
  companies: string[];
  inactiveCompanies: string[];
  deletedCompanies: string[];
}

export type CompanyDirectoryAction = 'create' | 'delete';

interface LegacyConfig {
  deletedCompanies?: unknown;
  inactiveCompanies?: unknown;
  employeeCompanies?: unknown;
  expenseGroups?: unknown;
  financeCompanies?: unknown;
  transferCompanies?: unknown;
  chequeCompanies?: unknown;
  companies?: unknown;
  primaryCompanyKey?: unknown;
  companyDirectoryRevision?: unknown;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function companyKey(value: unknown): string {
  const key = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
  return key === 'gratus metais' ? 'gratus' : key === 'manuela metais' ? 'manuela' : key;
}

export function companyNames(values: unknown): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of list(values)) {
    const name = String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
    const key = companyKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

export function initializeCompanyDirectory(config: LegacyConfig = {}): CompanyDirectory {
  const deletedCompanies = companyNames(config.deletedCompanies);
  const inactiveCompanies = companyNames(config.inactiveCompanies);
  const excluded = new Set(deletedCompanies.map(companyKey));
  const registered =
    config.companies && typeof config.companies === 'object' ? Object.keys(config.companies) : [];
  const source = [
    ...list(config.employeeCompanies),
    ...list(config.expenseGroups),
    ...list(config.financeCompanies),
    ...list(config.transferCompanies),
    ...list(config.chequeCompanies),
    ...registered,
    config.primaryCompanyKey,
  ];
  const companies = companyNames(source).filter((name) => !excluded.has(companyKey(name)));
  const primaryCompanyKey = String(config.primaryCompanyKey || 'Manuela Metais').trim();
  if (
    !excluded.has(companyKey(primaryCompanyKey)) &&
    !companies.some((name) => companyKey(name) === companyKey(primaryCompanyKey))
  ) {
    companies.unshift(primaryCompanyKey);
  }
  const revision = Number(config.companyDirectoryRevision);
  return {
    schemaVersion: 3,
    revision: Math.max(0, Number.isSafeInteger(revision) ? revision : 0),
    primaryCompanyKey,
    companies,
    inactiveCompanies: inactiveCompanies.filter((name) => !excluded.has(companyKey(name))),
    deletedCompanies,
  };
}

export function isValidCompanyDirectory(value: unknown): value is CompanyDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const directory = value as Partial<CompanyDirectory>;
  const optionalList = (field: unknown): boolean => field == null || Array.isArray(field);
  return (
    directory.schemaVersion === 3 &&
    Number.isSafeInteger(directory.revision) &&
    Number(directory.revision) >= 0 &&
    typeof directory.primaryCompanyKey === 'string' &&
    Boolean(directory.primaryCompanyKey.trim()) &&
    Array.isArray(directory.companies) &&
    optionalList(directory.inactiveCompanies) &&
    optionalList(directory.deletedCompanies)
  );
}

function normalizeCompanyDirectory(value: unknown): CompanyDirectory {
  if (!isValidCompanyDirectory(value)) throw new Error('Cadastro central de empresas inválido no Firebase.');
  return {
    ...value,
    companies: companyNames(value.companies),
    inactiveCompanies: companyNames(value.inactiveCompanies),
    deletedCompanies: companyNames(value.deletedCompanies),
  };
}

export async function getCompanyDirectory(db: Database): Promise<CompanyDirectory> {
  const directoryRef = db.ref('erp/companyDirectory');
  const existing: unknown = (await directoryRef.get()).val();
  if (existing != null) return normalizeCompanyDirectory(existing);
  const legacy = ((await db.ref('erp/config').get()).val() ?? {}) as LegacyConfig;
  const seed = initializeCompanyDirectory(legacy);
  const initialized = await runTransaction(directoryRef, (current) => (current == null ? seed : undefined));
  return normalizeCompanyDirectory(initialized.snapshot?.val());
}

export function changeCompanyDirectory(
  current: unknown,
  action: string,
  name: string,
  expectedRevision: number,
): CompanyDirectory | undefined {
  if (!isValidCompanyDirectory(current) || current.revision !== expectedRevision) return undefined;
  const key = companyKey(name);
  const companies = companyNames(current.companies);
  const deletedCompanies = companyNames(current.deletedCompanies);
  const inactiveCompanies = companyNames(current.inactiveCompanies);
  if (!key || key === companyKey(current.primaryCompanyKey)) return undefined;
  const hasName = companies.some((value) => companyKey(value) === key);
  const wasDeleted = deletedCompanies.some((value) => companyKey(value) === key);
  if (action === 'create') {
    if (hasName || companies.length >= 100) return undefined;
    companies.push(name);
    const deletedIndex = deletedCompanies.findIndex((value) => companyKey(value) === key);
    if (deletedIndex >= 0) deletedCompanies.splice(deletedIndex, 1);
  } else if (action === 'delete') {
    if (!hasName || wasDeleted) return undefined;
    companies.splice(
      companies.findIndex((value) => companyKey(value) === key),
      1,
    );
    deletedCompanies.push(name);
  } else {
    return undefined;
  }
  return {
    ...current,
    companies,
    deletedCompanies,
    inactiveCompanies: inactiveCompanies.filter((value) => companyKey(value) !== key),
    revision: current.revision + 1,
  };
}

export async function transactCompanyDirectory(
  db: Database,
  ref: Reference,
  action: string,
  name: string,
  expectedRevision: number,
): Promise<TransactionOutcome> {
  const known = await getCompanyDirectory(db);
  return runTransaction(ref, (current) =>
    changeCompanyDirectory(current == null ? known : current, action, name, expectedRevision),
  );
}

export function companyDirectoryResponse(state: unknown): CompanyDirectoryResponse {
  const directory = normalizeCompanyDirectory(state);
  return {
    ok: true,
    apiVersion: 3,
    revision: directory.revision,
    companies: directory.companies,
    inactiveCompanies: directory.inactiveCompanies,
    deletedCompanies: directory.deletedCompanies,
  };
}
