const FIREBASE_KEY_PREFIX = '~u~';
const FIREBASE_FORBIDDEN_KEY_CHARS = /[.#$\/\[\]]/;

export function normalizeLogin(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function loginStorageKey(value) {
  const login = normalizeLogin(value);
  if (!login) return '';

  if (
    !FIREBASE_FORBIDDEN_KEY_CHARS.test(login) &&
    !login.startsWith(FIREBASE_KEY_PREFIX)
  ) {
    return login;
  }

  return FIREBASE_KEY_PREFIX + Buffer.from(login, 'utf8').toString('base64url');
}

export function loginFromStorageKey(value) {
  const key = String(value || '');

  if (!key.startsWith(FIREBASE_KEY_PREFIX)) {
    return key;
  }

  try {
    return Buffer.from(
      key.slice(FIREBASE_KEY_PREFIX.length),
      'base64url',
    ).toString('utf8');
  } catch (_) {
    return key;
  }
}

export function sanitizeProfile(profile = {}) {
  return {
    name: String(profile.name || '').trim(),
    role: String(profile.role || 'Usuário').trim(),
    descricao: String(profile.descricao || '').trim(),
    tabs: Array.isArray(profile.tabs)
      ? [...new Set(profile.tabs.map(String))]
      : [],
    tabsCustom: Boolean(profile.tabsCustom),
    admin: Boolean(profile.admin),
    ...(profile.cpApenasFornecedor ? { cpApenasFornecedor: true } : {}),
  };
}

export function assertStrongEnoughPassword(password) {
  const value = String(password || '');

  if (value.length < 8) {
    throw Object.assign(
      new Error('A senha precisa ter pelo menos 8 caracteres.'),
      { status: 400, code: 'WEAK_PASSWORD' },
    );
  }

  if (value.length > 128) {
    throw Object.assign(
      new Error('Senha longa demais.'),
      { status: 400, code: 'WEAK_PASSWORD' },
    );
  }

  return value;
}
