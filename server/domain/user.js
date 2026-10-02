export function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function sanitizeProfile(profile = {}) {
  return {
    name: String(profile.name || '').trim(),
    role: String(profile.role || 'Usuário').trim(),
    descricao: String(profile.descricao || '').trim(),
    tabs: Array.isArray(profile.tabs) ? [...new Set(profile.tabs.map(String))] : [],
    tabsCustom: Boolean(profile.tabsCustom),
    admin: Boolean(profile.admin),
    ...(profile.cpApenasFornecedor ? { cpApenasFornecedor: true } : {}),
  };
}

export function assertStrongEnoughPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw Object.assign(new Error('A senha precisa ter pelo menos 8 caracteres.'), { status: 400, code: 'WEAK_PASSWORD' });
  if (value.length > 128) throw Object.assign(new Error('Senha longa demais.'), { status: 400, code: 'WEAK_PASSWORD' });
  return value;
}
