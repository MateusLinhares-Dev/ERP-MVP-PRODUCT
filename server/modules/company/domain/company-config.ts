import { companyKey, companyNames } from './company-directory.js';

export type CompanyConfig = Record<string, unknown>;

const LISTS = [
  'employeeCompanies',
  'expenseGroups',
  'financeCompanies',
  'transferCompanies',
  'chequeCompanies',
];

export const normalizeEmployeeCompanies = companyNames;

function nextRevision(value: unknown): number {
  const revision = Number(value);
  return (Number.isSafeInteger(revision) && revision >= 0 ? revision : 0) + 1;
}

export function changeCompanyConfig(
  current: unknown,
  action: string,
  name: string,
  expectedRevision?: number,
): CompanyConfig | null {
  const cfg: CompanyConfig =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as CompanyConfig) }
      : {};
  const key = companyKey(name);
  const currentRevision = Number(cfg.companyDirectoryRevision) || 0;
  if (expectedRevision !== undefined && currentRevision !== expectedRevision) return null;
  const same = (item: unknown): boolean => companyKey(item) === key;
  const companies = companyNames(cfg.employeeCompanies);
  const inactive = companyNames(cfg.inactiveCompanies);
  const deleted = companyNames(cfg.deletedCompanies);
  const registered = cfg.companies && typeof cfg.companies === 'object' ? Object.keys(cfg.companies) : [];
  const all = [...LISTS.flatMap((field) => companyNames(cfg[field])), ...registered];
  const exists = all.some(same) || inactive.some(same);
  const isPrimary = companyKey(cfg.primaryCompanyKey) === key;

  if (action === 'create') {
    if (deleted.some(same)) return null;
    const alreadyRegistered = companies.some(same);
    if (!alreadyRegistered && companies.length >= 100) return null;
    if (!alreadyRegistered) companies.push(name);
    cfg.employeeCompanies = companies;
    cfg.inactiveCompanies = inactive.filter((item) => !same(item));
  } else if (action === 'archive') {
    if (!exists || isPrimary) return null;
    if (!inactive.some(same)) inactive.push(name);
    cfg.inactiveCompanies = inactive;
  } else if (action === 'restore') {
    if (!exists || deleted.some(same)) return null;
    cfg.inactiveCompanies = inactive.filter((item) => !same(item));
  } else if (action === 'delete') {
    if (!exists || isPrimary || deleted.some(same)) return null;
    for (const field of LISTS) {
      const values = cfg[field];
      if (Array.isArray(values)) cfg[field] = values.filter((item: unknown) => !same(item));
    }
    cfg.inactiveCompanies = inactive.filter((item) => !same(item));
    const map = cfg.expenseGroupCompanyMap;
    if (map && typeof map === 'object') {
      cfg.expenseGroupCompanyMap = Object.fromEntries(
        Object.entries(map).filter(([group, company]) => !same(group) && !same(company)),
      );
    }
    cfg.deletedCompanies = [...deleted, name];
  } else {
    return null;
  }
  cfg.companyDirectoryRevision = nextRevision(cfg.companyDirectoryRevision);
  return cfg;
}
