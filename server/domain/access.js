function normalizedTabs(profile = {}) {
  return new Set(Array.isArray(profile.tabs) ? profile.tabs.map((tab) => String(tab || '').trim()).filter(Boolean) : []);
}

function hasAny(tabs, values) {
  return values.some((value) => tabs.has(value));
}

export function buildSecurityClaims(profile = {}, { admin = false } = {}) {
  const tabs = normalizedTabs(profile);
  return {
    canChat: tabs.has('chat'),
    canEmployeeDocs: tabs.has('funcionarios'),
    canBusinessDocs: hasAny(tabs, ['clientes', 'fornecedores', 'documentos_empresas']),
    canFleetDocs: tabs.has('caminhoes'),
    canPasswords: Boolean(admin && tabs.has('senhas')),
    canSupport: Boolean(admin && tabs.has('suporte_tecnico')),
  };
}

export function canAccessProfileTab(profile = {}, tab) {
  return normalizedTabs(profile).has(String(tab || '').trim());
}
