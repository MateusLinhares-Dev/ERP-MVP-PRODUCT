const FIREBASE_VERSION = '9.23.0';
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const USER_WAIT_MS = 6000;
const SESSION_KEY = 'mm_sessao';
const FULL_ERP_KEY = 'erp_modo_completo';

export interface RuntimeConfig {
  firebase: Record<string, unknown>;
  emulators?: { enabled?: boolean; host?: string; authPort?: number };
}

export interface SessionUser {
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getIdTokenResult(): Promise<{ claims: Record<string, unknown> }>;
}

export interface SessionAuth {
  readonly currentUser: SessionUser | null;
  onAuthStateChanged(listener: (user: SessionUser | null) => void): () => void;
  signOut(): Promise<void>;
}

interface CompatAuth extends SessionAuth {
  useEmulator(url: string, options: { disableWarnings: boolean }): void;
  setPersistence(persistence: unknown): Promise<void>;
}

interface FirebaseCompat {
  apps: unknown[];
  initializeApp(config: Record<string, unknown>): unknown;
  auth: { (): CompatAuth; Auth: { Persistence: { SESSION: unknown } } };
}

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-runtime-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.runtimeSrc = src;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/api/config', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Configuração indisponível.');
  return (await response.json()) as RuntimeConfig;
}

export async function openAuth(config: RuntimeConfig): Promise<SessionAuth> {
  await loadScript(`${SDK_BASE}/firebase-app-compat.js`);
  await loadScript(`${SDK_BASE}/firebase-auth-compat.js`);
  const firebase = window.firebase;
  if (!firebase) throw new Error('Não foi possível carregar o login.');
  if (!firebase.apps.length) firebase.initializeApp(config.firebase);
  const auth = firebase.auth();
  const emulators = config.emulators;
  if (emulators?.enabled) {
    const host = emulators.host || '127.0.0.1';
    auth.useEmulator(`http://${host}:${emulators.authPort || 9099}`, { disableWarnings: true });
  }
  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  } catch (error) {
    console.warn('[Firebase] Não foi possível configurar persistência de sessão.', error);
  }
  return auth;
}

export function waitForUser(auth: SessionAuth, timeoutMs = USER_WAIT_MS): Promise<SessionUser | null> {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      resolve(auth.currentUser);
      return;
    }
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const finish = (user: SessionUser | null) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve(user);
    };
    unsubscribe = auth.onAuthStateChanged((user) => finish(user ?? null));
    if (settled) unsubscribe();
    window.setTimeout(() => finish(auth.currentUser ?? null), timeoutMs);
  });
}

function forget(...keys: string[]): void {
  try {
    for (const key of keys) sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('[sessão] Não foi possível limpar a sessão local.', error);
  }
}

export function goToLogin(): void {
  forget(SESSION_KEY);
  location.replace('/?destino=rapido');
}

export async function signOutAndLeave(auth: SessionAuth | null): Promise<void> {
  try {
    await auth?.signOut();
  } catch (error) {
    console.warn('[sessão] Falha ao sair.', error);
  }
  forget(SESSION_KEY, FULL_ERP_KEY);
  location.replace('/');
}
