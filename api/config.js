import { applyApiSecurityHeaders } from '../server/http/http.js';
import { assertRuntimeSecurity } from '../server/config/runtime-security.js';
import '../server/config/load-local-env.js';
export default function handler(req, res) {
  applyApiSecurityHeaders(res);
  try { assertRuntimeSecurity({ requireServerSecrets: false }); } catch (error) { return res.status(500).json({ message: 'Ambiente Firebase inválido.' }); }
  const emulators = String(process.env.USE_FIREBASE_EMULATORS || '').toLowerCase() === 'true';
  const firebase = {
    apiKey: process.env.FIREBASE_API_KEY || (emulators ? 'demo-api-key' : ''),
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '000000000000',
    appId: process.env.FIREBASE_APP_ID || '1:000000000000:web:local',
  };
  if (!firebase.projectId) return res.status(500).json({ message: 'Firebase não configurado.' });
  return res.status(200).json({
    environment: process.env.APP_ENV || (emulators ? 'local' : 'production'),
    firebase,
    emulators: emulators ? {
      enabled: true,
      host: process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1',
      authPort: Number(process.env.FIREBASE_AUTH_EMULATOR_PORT || 9099),
      databasePort: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000),
      storagePort: Number(process.env.FIREBASE_STORAGE_EMULATOR_PORT || 9199),
    } : { enabled: false },
  });
}
