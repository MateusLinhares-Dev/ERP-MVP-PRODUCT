import { FirebaseBusinessConfigRepository } from '../infrastructure/business-config-repository.js';

function text(value) {
  return value == null ? '' : String(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.map(text).map((item) => item.trim()).filter(Boolean) : [];
}

export async function getPublicBranding(repository = new FirebaseBusinessConfigRepository()) {
  const cfg = await repository.getConfig();
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
    employeeCompanies: stringList(cfg.employeeCompanies),
    transferCompanies: stringList(cfg.transferCompanies),
  };
}
