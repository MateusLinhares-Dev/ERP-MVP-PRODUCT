import { fetchRuntimeConfig, openAuth, waitForUser } from '../../../shared/auth/firebase-session.js';
import type { SessionAuth } from '../../../shared/auth/firebase-session.js';
import type { QuickOptions } from '../domain/contracts.js';
import { createQuickEntryApi } from './quick-entry-api.js';
import type { QuickEntryApi } from './quick-entry-api.js';

export const BLOCKED_MESSAGE =
  'Seu usuário ainda não tem acesso ao Lançamento rápido. Peça para a administradora marcar "Lançamento rápido" no seu cadastro de usuário e entre de novo.';

const ERP_CLAIMS = ['canPurchasing', 'canSales', 'canFinance', 'canPayables', 'canAdvances'];

export interface ReadySession {
  auth: SessionAuth;
  api: QuickEntryApi;
  options: QuickOptions;
  displayName: string;
  usesErp: boolean;
}

export type SessionStart =
  | { status: 'signed-out' }
  | { status: 'blocked'; auth: SessionAuth }
  | { status: 'ready'; session: ReadySession };

export interface SessionProgress {
  onSignedIn(auth: SessionAuth): void;
  onLoadingCatalog(): void;
}

function capitalize(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

export async function startSession(progress: SessionProgress): Promise<SessionStart> {
  const config = await fetchRuntimeConfig();
  const auth = await openAuth(config);
  const user = await waitForUser(auth);
  if (!user) return { status: 'signed-out' };
  progress.onSignedIn(auth);
  const { claims } = await user.getIdTokenResult();
  const admin = claims.admin === true;
  if (claims.canQuickEntry !== true && !admin) return { status: 'blocked', auth };
  progress.onLoadingCatalog();
  const api = createQuickEntryApi(auth);
  const options = await api.options();
  const login =
    typeof claims.erpUser === 'string' && claims.erpUser ? claims.erpUser : options.user?.login || '';
  return {
    status: 'ready',
    session: {
      auth,
      api,
      options,
      displayName: capitalize(login),
      usesErp: admin || ERP_CLAIMS.some((claim) => claims[claim] === true),
    },
  };
}
