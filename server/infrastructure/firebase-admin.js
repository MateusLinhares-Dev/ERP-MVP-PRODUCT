import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { assertRuntimeSecurity, assertServiceAccountMatchesProject } from '../config/runtime-security.js';

function isEmulator() { return String(process.env.USE_FIREBASE_EMULATORS || '').toLowerCase() === 'true'; }
function projectId() { return process.env.FIREBASE_PROJECT_ID || (isEmulator() ? 'demo-manuela-erp' : ''); }

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 não configurado.');
  const account = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  assertServiceAccountMatchesProject(account, projectId());
  return account;
}


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
  return { app, auth: getAuth(app), db: getDatabase(app), storage: getStorage(app) };
}

export function usingEmulators() { return isEmulator(); }
export function firebaseProjectId() { return projectId(); }
