import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { getCompanyDirectory } from '../domain/company-directory.js';
import {
  FirebaseBusinessConfigRepository,
  type BusinessConfigRepository,
} from '../infrastructure/business-config-repository.js';

interface DirectoryView {
  revision: number;
  companies: unknown;
  inactiveCompanies: unknown;
  deletedCompanies: unknown;
}

const COMPANY_FIELDS = [
  'nome',
  'razaoSocial',
  'cnpj',
  'ie',
  'endereco',
  'enderecoCurto',
  'financeiro',
  'escritorio',
  'compras',
  'email',
  'responsavel',
] as const;

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(text)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function companyDirectory(): Promise<DirectoryView> {
  try {
    return await getCompanyDirectory(getFirebaseAdmin().db);
  } catch (error) {
    const details = error as { code?: unknown; message?: unknown } | null;
    console.error(
      'Falha na leitura do cadastro isolado de empresas; mantendo configuração visual:',
      details?.code || details?.message || 'erro',
    );
    return { revision: 0, companies: [], inactiveCompanies: [], deletedCompanies: [] };
  }
}

export async function getPublicBranding(
  repository: BusinessConfigRepository = new FirebaseBusinessConfigRepository(),
) {
  const cfg = await repository.getConfig();
  const directory = await companyDirectory();
  const companies = record(cfg.companies);
  const primaryKey = text(cfg.primaryCompanyKey) || Object.keys(companies)[0] || '';
  const rawCompany = primaryKey ? record(companies[primaryKey]) : {};
  const rawBranding = record(cfg.branding);
  const company: Record<string, string> = { key: primaryKey };
  for (const field of COMPANY_FIELDS) company[field] = text(rawCompany[field]);

  return {
    branding: {
      logoPrefix: text(rawBranding.logoPrefix),
      logoAccent: text(rawBranding.logoAccent),
      tagline: text(rawBranding.tagline),
      title: text(rawBranding.title),
    },
    company,
    companyKeys: Object.keys(companies),
    financeCompanies: stringList(cfg.financeCompanies),
    employeeCompanies: stringList(directory.companies),
    companyDirectoryRevision: directory.revision,
    inactiveCompanies: stringList(directory.inactiveCompanies),
    deletedCompanies: stringList(directory.deletedCompanies),
    expenseGroups: stringList(cfg.expenseGroups),
    expenseGroupCompanyMap: record(cfg.expenseGroupCompanyMap),
    chequeCompanies: stringList(cfg.chequeCompanies),
    transferCompanies: stringList(cfg.transferCompanies),
  };
}
