import { firebaseProjectId } from './firebase-admin.js';
function b64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function createEmulatorCustomToken(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const pid = firebaseProjectId();
  const serviceAccount = `firebase-adminsdk-local@${pid}.iam.gserviceaccount.com`;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, iss: serviceAccount, sub: serviceAccount,
    uid, claims,
  };
  return `${b64url(header)}.${b64url(payload)}.local-emulator-signature`;
}
