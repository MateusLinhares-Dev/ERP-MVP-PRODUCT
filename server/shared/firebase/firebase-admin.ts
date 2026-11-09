import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getStorage, type Storage } from 'firebase-admin/storage';
import { assertRuntimeSecurity, assertServiceAccountMatchesProject } from '../config/runtime-security.js';
import {
  consumeConnectionRecycle,
  setFirebaseIdleHandler,
  trackFirebaseRequest,
} from './firebase-session.js';

export interface FirebaseAdmin {
  app: App;
  auth: Auth;
  db: Database;
  storage: Storage;
}

function isEmulator(): boolean {
  return String(process.env.USE_FIREBASE_EMULATORS ?? '').toLowerCase() === 'true';
}

function projectId(): string {
  return process.env.FIREBASE_PROJECT_ID || (isEmulator() ? 'demo-manuela-erp' : '');
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 não configurado.');
  const account: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  assertServiceAccountMatchesProject(account, projectId());
  return account as ServiceAccount;
}

function currentDatabase(): Database | null {
  const app = getApps()[0];
  if (!app) return null;
  try {
    return getDatabase(app);
  } catch {
    return null;
  }
}

function initializeFirebase(): App {
  const pid = projectId();
  if (!pid) throw new Error('FIREBASE_PROJECT_ID não configurado.');
  if (isEmulator()) {
    return initializeApp({
      projectId: pid,
      databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${pid}-default-rtdb.firebaseio.com`,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${pid}.appspot.com`,
    });
  }
  return initializeApp({
    credential: cert(serviceAccount()),
    projectId: pid,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

setFirebaseIdleHandler(() => {
  currentDatabase()?.goOffline();
});

export { trackFirebaseRequest };

export function getFirebaseAdmin(): FirebaseAdmin {
  assertRuntimeSecurity({ requireServerSecrets: true });
  const app = getApps()[0] ?? initializeFirebase();
  const db = getDatabase(app);
  if (consumeConnectionRecycle()) {
    try {
      db.goOffline();
      db.goOnline();
    } catch {
      db.goOnline();
    }
  }
  return { app, auth: getAuth(app), db, storage: getStorage(app) };
}

export function usingEmulators(): boolean {
  return isEmulator();
}

export function firebaseProjectId(): string {
  return projectId();
}
