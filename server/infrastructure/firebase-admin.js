import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { assertRuntimeSecurity, assertServiceAccountMatchesProject } from '../config/runtime-security.js';
import { consumeConnectionRecycle, setFirebaseIdleHandler, trackFirebaseRequest } from './firebase-session.js';

function isEmulator() { return String(process.env.USE_FIREBASE_EMULATORS || '').toLowerCase() === 'true'; }
function projectId() { return process.env.FIREBASE_PROJECT_ID || (isEmulator() ? 'demo-manuela-erp' : ''); }

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 não configurado.');
  const account = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  assertServiceAccountMatchesProject(account, projectId());
  return account;
}

// ---------------------------------------------------------------------------
// Ciclo de vida da conexão do Realtime Database em ambiente serverless.
//
// Na Vercel a instância da função é reaproveitada entre requisições e pode ficar
// congelada entre elas. O WebSocket do RTDB aberto na primeira requisição fica
// "meio morto": a próxima transação é enviada por ele, a queda é detectada no
// meio do caminho e o SDK rejeita com Error('disconnect') -> HTTP 500, deixando
// a trava financeira presa. Por isso:
//   - a primeira requisição de cada rajada recicla a conexão (goOffline+goOnline);
//   - quando não há mais requisições ativas a conexão é encerrada (goOffline).
// Gravações e leituras pendentes NÃO se perdem: o SDK as reenvia ao reconectar.
// ---------------------------------------------------------------------------
function currentDatabase() {
  const app = getApps()[0];
  if (!app) return null;
  try { return getDatabase(app); } catch { return null; }
}

setFirebaseIdleHandler(() => {
  const db = currentDatabase();
  if (db) db.goOffline();
});

export { trackFirebaseRequest };

export function getFirebaseAdmin() {
  assertRuntimeSecurity({ requireServerSecrets: true });
  let app = getApps()[0];
  if (!app) {
    const pid = projectId();
    if (!pid) throw new Error('FIREBASE_PROJECT_ID não configurado.');
    if (isEmulator()) {
      app = initializeApp({
        projectId: pid,
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${pid}-default-rtdb.firebaseio.com`,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${pid}.appspot.com`,
      });
    } else {
      const account = serviceAccount();
      app = initializeApp({
        credential: cert(account),
        projectId: pid,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }
  }
  const db = getDatabase(app);
  if (consumeConnectionRecycle()) {
    // Garante um WebSocket novo para esta rajada de requisições.
    try { db.goOffline(); } catch { /* sem conexão anterior */ }
    try { db.goOnline(); } catch { /* reconecta sob demanda */ }
  }
  return { app, auth: getAuth(app), db, storage: getStorage(app) };
}

export function usingEmulators() { return isEmulator(); }
export function firebaseProjectId() { return projectId(); }
