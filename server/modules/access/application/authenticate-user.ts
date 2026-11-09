import { fail } from '../../../shared/errors/app-error.js';
import { getFirebaseAdmin, usingEmulators } from '../../../shared/firebase/firebase-admin.js';
import { createEmulatorCustomToken } from '../../../shared/firebase/emulator-token.js';
import { recordAuditSafely } from '../../audit/infrastructure/audit-repository.js';
import { buildSecurityClaims } from '../domain/access-claims.js';
import { verifyPassword } from '../infrastructure/password-hasher.js';
import { LoginRateLimitRepository } from '../infrastructure/rate-limit-repository.js';
import { FirebaseUserRepository, type SecureUserRecord } from '../infrastructure/user-repository.js';

export interface LoginInput {
  password: string;
  ip: string;
}

export interface LoginResult {
  customToken: string;
  username: string;
  profile: Record<string, unknown>;
}

const ENGINEER_LOGIN = 'engadministrator';

async function findByPassword(
  users: Record<string, SecureUserRecord>,
  password: string,
): Promise<{ login: string; record: SecureUserRecord } | null> {
  for (const [login, record] of Object.entries(users)) {
    if (record.active === false || !record.passwordHash) continue;
    if (await verifyPassword(password, record.passwordHash)) return { login, record };
  }
  return null;
}

export async function authenticateUser({ password, ip }: LoginInput): Promise<LoginResult> {
  const users = new FirebaseUserRepository();
  const limiter = new LoginRateLimitRepository();
  await limiter.assertAllowed(ip);

  const selected = await findByPassword(await users.listSecureUsers(), password);
  if (!selected) {
    await limiter.registerFailure(ip);
    await recordAuditSafely({
      actorUid: 'anonymous',
      actorLogin: '',
      action: 'login_failed',
      module: 'auth',
      entityType: 'session',
      entityId: '',
      outcome: 'failed',
      ip,
    });
    fail(401, 'INVALID_CREDENTIALS', 'Senha incorreta.');
  }
  await limiter.clear(ip);
  const { login, record } = selected;
  const engineer = login === ENGINEER_LOGIN && record.engineer === true && record.admin === true;
  const admin = Boolean(record.admin) || engineer;
  const claims = {
    erpAccess: true,
    erpUser: login,
    admin,
    engineer,
    ...buildSecurityClaims(record.profile, { admin }),
  };
  const uid = `erp:${login}`;
  const customToken = usingEmulators()
    ? createEmulatorCustomToken(uid, claims)
    : await getFirebaseAdmin().auth.createCustomToken(uid, claims);
  await recordAuditSafely({
    actorUid: uid,
    actorLogin: login,
    action: 'login',
    module: 'auth',
    entityType: 'session',
    entityId: '',
    ip,
  });
  return { customToken, username: login, profile: { ...(record.profile ?? {}), admin, engineer } };
}
