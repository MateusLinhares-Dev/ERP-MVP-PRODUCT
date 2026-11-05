function keyOf(value) {
  const key = String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return key === 'gratus metais' ? 'gratus' : key === 'manuela metais' ? 'manuela' : key;
}

export function companyNames(values) {
  const seen = new Set();
  const names = [];
  for (const value of Array.isArray(values) ? values : []) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    const key = keyOf(name);
    if (key && !seen.has(key)) { seen.add(key); names.push(name); }
  }
  return names;
}

export function initializeCompanyDirectory(config = {}) {
  const deletedCompanies = companyNames(config.deletedCompanies);
  const inactiveCompanies = companyNames(config.inactiveCompanies);
  const excluded = new Set(deletedCompanies.map(keyOf));
  const source = [
    ...(Array.isArray(config.employeeCompanies) ? config.employeeCompanies : []),
    ...(Array.isArray(config.expenseGroups) ? config.expenseGroups : []),
    ...(Array.isArray(config.financeCompanies) ? config.financeCompanies : []),
    ...(Array.isArray(config.transferCompanies) ? config.transferCompanies : []),
    ...(Array.isArray(config.chequeCompanies) ? config.chequeCompanies : []),
    ...Object.keys(config.companies && typeof config.companies === 'object' ? config.companies : {}),
    config.primaryCompanyKey
  ];
  const companies = companyNames(source).filter(name => !excluded.has(keyOf(name)));
  const primaryCompanyKey = String(config.primaryCompanyKey || 'Manuela Metais').trim();
  if (!excluded.has(keyOf(primaryCompanyKey)) && !companies.some(name => keyOf(name) === keyOf(primaryCompanyKey))) companies.unshift(primaryCompanyKey);
  return {
    schemaVersion: 3,
    revision: Math.max(0, Number.isSafeInteger(Number(config.companyDirectoryRevision)) ? Number(config.companyDirectoryRevision) : 0),
    primaryCompanyKey,
    companies,
    inactiveCompanies: inactiveCompanies.filter(name => !excluded.has(keyOf(name))),
    deletedCompanies
  };
}

export function isValidCompanyDirectory(value) {
  const optionalList=value=>value==null||Array.isArray(value);
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 3 &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    typeof value.primaryCompanyKey === 'string' && value.primaryCompanyKey.trim() &&
    Array.isArray(value.companies) && optionalList(value.inactiveCompanies) && optionalList(value.deletedCompanies));
}

function normalizeCompanyDirectory(value) {
  if (!isValidCompanyDirectory(value)) throw new Error('Cadastro central de empresas inválido no Firebase.');
  return {
    ...value,
    companies: companyNames(value.companies),
    inactiveCompanies: companyNames(value.inactiveCompanies),
    deletedCompanies: companyNames(value.deletedCompanies)
  };
}

export async function getCompanyDirectory(db) {
  const directoryRef = db.ref('erp/companyDirectory');
  const existing = (await directoryRef.get()).val();
  if (existing != null) return normalizeCompanyDirectory(existing);
  const legacy = (await db.ref('erp/config').get()).val() || {};
  const seed = initializeCompanyDirectory(legacy);
  const initialized = await directoryRef.transaction(current => current == null ? seed : undefined);
  const result = initialized.snapshot.val();
  return normalizeCompanyDirectory(result);
}

export function changeCompanyDirectory(current, action, name, expectedRevision) {
  if (!isValidCompanyDirectory(current) || current.revision !== expectedRevision) return undefined;
  const key = keyOf(name);
  const companies = companyNames(current.companies);
  const deletedCompanies = companyNames(current.deletedCompanies);
  const inactiveCompanies = companyNames(current.inactiveCompanies);
  if (!key || key === keyOf(current.primaryCompanyKey)) return undefined;
  const hasName = companies.some(value => keyOf(value) === key);
  const wasDeleted = deletedCompanies.some(value => keyOf(value) === key);
  if (action === 'create') {
    if (hasName || wasDeleted || companies.length >= 100) return undefined;
    companies.push(name);
  } else if (action === 'delete') {
    if (!hasName || wasDeleted) return undefined;
    companies.splice(companies.findIndex(value => keyOf(value) === key), 1);
    deletedCompanies.push(name);
  } else return undefined;
  return {
    ...current,
    companies,
    deletedCompanies,
    inactiveCompanies: inactiveCompanies.filter(value => keyOf(value) !== key),
    revision: current.revision + 1
  };
}

export function companyDirectoryResponse(state) {
  const directory=normalizeCompanyDirectory(state);
  return {
    ok: true,
    apiVersion: 3,
    revision: directory.revision,
    companies: directory.companies,
    inactiveCompanies: directory.inactiveCompanies,
    deletedCompanies: directory.deletedCompanies
  };
}
