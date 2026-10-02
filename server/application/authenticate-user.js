import { verifyPassword } from '../infrastructure/password-hasher.js';
import { FirebaseUserRepository } from '../infrastructure/user-repository.js';
import { LoginRateLimitRepository } from '../infrastructure/rate-limit-repository.js';
import { getFirebaseAdmin, usingEmulators } from '../infrastructure/firebase-admin.js';
import { createEmulatorCustomToken } from '../infrastructure/emulator-token.js';
import { buildSecurityClaims } from '../domain/access.js';
import { AuditRepository } from '../infrastructure/audit-repository.js';

export async function authenticateUser({ password, ip }) {
  const users = new FirebaseUserRepository();
  const limiter = new LoginRateLimitRepository();
  await limiter.assertAllowed(ip);

  const all = await users.listSecureUsers();
  let selected = null;
  for (const [login, record] of Object.entries(all)) {
    if (record?.active === false || !record?.passwordHash) continue;
    if (await verifyPassword(password, record.passwordHash)) { selected = { login, record }; break; }
  }
  if (!selected) {
    await limiter.registerFailure(ip);
    const error = new Error('Senha incorreta.'); error.status = 401; error.code = 'INVALID_CREDENTIALS'; throw error;
  }
  await limiter.clear(ip);
  const admin = Boolean(selected.record.admin);
  const securityClaims = buildSecurityClaims(selected.record.profile || {}, { admin });
  const claims = { erpAccess: true, erpUser: selected.login, admin, ...securityClaims };
  const uid = `erp:${selected.login}`;
  const { auth } = getFirebaseAdmin();
  const customToken = usingEmulators()
    ? createEmulatorCustomToken(uid, claims)
    : await auth.createCustomToken(uid, claims);
  try {
    await new AuditRepository().record({ actorUid: uid, actorLogin: selected.login, action: 'login', module: 'auth', entityType: 'session', entityId: '', ip });
  } catch (_) {}
  return { customToken, username: selected.login, profile: { ...(selected.record.profile || {}), admin } };
}
