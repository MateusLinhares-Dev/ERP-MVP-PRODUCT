import { AppError } from '../errors/app-error.js';
import type { Identity } from '../auth/identity.js';
import { getFirebaseAdmin } from '../firebase/firebase-admin.js';
import { setRequestActor } from '../observability/logger.js';
import { withSpan } from '../observability/tracing.js';
import type { ApiRequest } from './http.js';

export type AccessLevel = 'user' | 'admin' | 'engineer';

export interface IdentityRequirements {
  admin?: boolean;
  engineer?: boolean;
}

const ENGINEER_LOGIN = 'engadministrator';

function bearerToken(req: ApiRequest): string {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function assertEngineerStillActive(): Promise<void> {
  const { FirebaseUserRepository } = await import('../../modules/access/infrastructure/user-repository.js');
  const secure = await new FirebaseUserRepository().getSecureUser(ENGINEER_LOGIN);
  if (!secure || secure.active === false || secure.engineer !== true || secure.admin !== true) {
    throw new AppError(403, 'ENGINEER_REVOKED', 'Perfil de engenharia inativo.');
  }
}

export async function requireIdentity(
  req: ApiRequest,
  { admin = false, engineer = false }: IdentityRequirements = {},
): Promise<Identity> {
  const token = bearerToken(req);
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão não autenticada.');
  const decoded = (await withSpan('firebase.auth.verify_token', { 'auth.provider': 'firebase' }, () =>
    getFirebaseAdmin().auth.verifyIdToken(token),
  )) as Identity;
  if (!decoded.erpAccess || !decoded.erpUser)
    throw new AppError(403, 'FORBIDDEN', 'Sessão inválida para o ERP.');
  setRequestActor(req, decoded);
  if (admin && decoded.admin !== true)
    throw new AppError(403, 'ADMIN_REQUIRED', 'Operação restrita à administradora.');
  if (engineer) {
    const isEngineer =
      decoded.engineer === true &&
      decoded.admin === true &&
      decoded.erpUser === ENGINEER_LOGIN &&
      decoded.uid === `erp:${ENGINEER_LOGIN}`;
    if (!isEngineer) throw new AppError(403, 'ENGINEER_REQUIRED', 'Área restrita ao perfil de engenharia.');
    await assertEngineerStillActive();
  }
  return decoded;
}

export function requirementsFor(level: AccessLevel): IdentityRequirements {
  if (level === 'engineer') return { engineer: true };
  if (level === 'admin') return { admin: true };
  return {};
}
