import { fail } from '../../../shared/errors/app-error.js';

const FIREBASE_KEY_PREFIX = '~u~';
const FIREBASE_FORBIDDEN_KEY_CHARS = /[.#$/[\]]/;

export interface UserProfile {
  name: string;
  role: string;
  descricao: string;
  tabs: string[];
  tabsCustom: boolean;
  admin: boolean;
  cpApenasFornecedor?: true;
}

export interface RawProfile {
  name?: unknown;
  role?: unknown;
  descricao?: unknown;
  tabs?: unknown;
  tabsCustom?: unknown;
  admin?: unknown;
  cpApenasFornecedor?: unknown;
  login?: unknown;
}

export function normalizeLogin(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function loginStorageKey(value: unknown): string {
  const login = normalizeLogin(value);
  if (!login) return '';
  if (!FIREBASE_FORBIDDEN_KEY_CHARS.test(login) && !login.startsWith(FIREBASE_KEY_PREFIX)) return login;
  return FIREBASE_KEY_PREFIX + Buffer.from(login, 'utf8').toString('base64url');
}

export function loginFromStorageKey(value: unknown): string {
  const key = String(value || '');
  if (!key.startsWith(FIREBASE_KEY_PREFIX)) return key;
  try {
    return Buffer.from(key.slice(FIREBASE_KEY_PREFIX.length), 'base64url').toString('utf8');
  } catch {
    return key;
  }
}

export function sanitizeProfile(profile: RawProfile | null | undefined = {}): UserProfile {
  const source = profile ?? {};
  return {
    name: String(source.name || '').trim(),
    role: String(source.role || 'Usuário').trim(),
    descricao: String(source.descricao || '').trim(),
    tabs: Array.isArray(source.tabs) ? [...new Set(source.tabs.map(String))] : [],
    tabsCustom: Boolean(source.tabsCustom),
    admin: Boolean(source.admin),
    ...(source.cpApenasFornecedor ? { cpApenasFornecedor: true as const } : {}),
  };
}

export function assertStrongEnoughPassword(password: unknown): string {
  const value = String(password || '');
  if (value.length < 8) fail(400, 'WEAK_PASSWORD', 'A senha precisa ter pelo menos 8 caracteres.');
  if (value.length > 128) fail(400, 'WEAK_PASSWORD', 'Senha longa demais.');
  return value;
}
