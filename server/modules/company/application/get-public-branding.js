import { FirebaseBusinessConfigRepository } from '../infrastructure/business-config-repository.js';
import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { getCompanyDirectory } from '../domain/company-directory.js';

function text(value) {
  return value == null ? '' : String(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.map(text).map((item) => item.trim()).filter(Boolean) : [];
}

export async function getPublicBranding(repository = new FirebaseBusinessConfigRepository()) {
  const cfg = await repository.getConfig();
  let directory;
  try {
    directory = await getCompanyDirectory(getFirebaseAdmin().db);
  } catch (error) {
    console.error('Falha na leitura do cadastro isolado de empresas; mantendo configuração visual:',error?.code || error?.message || 'erro');
    directory = {revision:0,companies:[],inactiveCompanies:[],deletedCompanies:[]};
  }
  const companies = cfg.companies && typeof cfg.companies === 'object' ? cfg.companies : {};
  const primaryKey = text(cfg.primaryCompanyKey) || Object.keys(companies)[0] || '';
  const rawCompany = primaryKey && companies[primaryKey] && typeof companies[primaryKey] === 'object'
    ? companies[primaryKey]
    : {};
  const rawBranding = cfg.branding && typeof cfg.branding === 'object' ? cfg.branding : {};

  return {
    branding: {
      logoPrefix: text(rawBranding.logoPrefix),
      logoAccent: text(rawBranding.logoAccent),
      tagline: text(rawBranding.tagline),
      title: text(rawBranding.title),
    },
    company: {
      key: primaryKey,
      nome: text(rawCompany.nome),
      razaoSocial: text(rawCompany.razaoSocial),
      cnpj: text(rawCompany.cnpj),
      ie: text(rawCompany.ie),
      endereco: text(rawCompany.endereco),
      enderecoCurto: text(rawCompany.enderecoCurto),
      financeiro: text(rawCompany.financeiro),
      escritorio: text(rawCompany.escritorio),
      compras: text(rawCompany.compras),
      email: text(rawCompany.email),
      responsavel: text(rawCompany.responsavel),
    },
    companyKeys: Object.keys(companies),
    financeCompanies: stringList(cfg.financeCompanies),
    employeeCompanies: stringList(directory.companies),
    companyDirectoryRevision: directory.revision,
    inactiveCompanies: stringList(directory.inactiveCompanies),
    deletedCompanies: stringList(directory.deletedCompanies),
    expenseGroups: stringList(cfg.expenseGroups),
    expenseGroupCompanyMap: cfg.expenseGroupCompanyMap && typeof cfg.expenseGroupCompanyMap==='object' ? cfg.expenseGroupCompanyMap : {},
    chequeCompanies: stringList(cfg.chequeCompanies),
    transferCompanies: stringList(cfg.transferCompanies),
  };
}
