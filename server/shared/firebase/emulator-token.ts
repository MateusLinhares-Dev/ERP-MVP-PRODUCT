import { firebaseProjectId } from './firebase-admin.js';

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createEmulatorCustomToken(uid: string, claims: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const serviceAccount = `firebase-adminsdk-local@${firebaseProjectId()}.iam.gserviceaccount.com`;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    iss: serviceAccount,
    sub: serviceAccount,
    uid,
    claims,
  };
  return `${base64Url(header)}.${base64Url(payload)}.local-emulator-signature`;
}
