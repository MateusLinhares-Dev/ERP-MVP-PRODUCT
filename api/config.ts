import { assertRuntimeSecurity } from '../server/shared/config/runtime-security.js';
import { defineApi, RAW_RESPONSE } from '../server/shared/http/api-handler.js';

const env = (name: string): string => process.env[name] ?? '';

function clientConfig() {
  const emulators = env('USE_FIREBASE_EMULATORS').toLowerCase() === 'true';
  const projectId = env('FIREBASE_PROJECT_ID');
  return {
    environment: env('APP_ENV') || (emulators ? 'local' : 'production'),
    firebase: {
      apiKey: env('FIREBASE_API_KEY') || (emulators ? 'demo-api-key' : ''),
      authDomain: env('FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
      databaseURL: env('FIREBASE_DATABASE_URL') || `https://${projectId}-default-rtdb.firebaseio.com`,
      projectId,
      storageBucket: env('FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: env('FIREBASE_MESSAGING_SENDER_ID') || '000000000000',
      appId: env('FIREBASE_APP_ID') || '1:000000000000:web:local',
    },
    emulators: emulators
      ? {
          enabled: true,
          host: env('FIREBASE_EMULATOR_HOST') || '127.0.0.1',
          authPort: Number(env('FIREBASE_AUTH_EMULATOR_PORT') || 9099),
          databasePort: Number(env('FIREBASE_DATABASE_EMULATOR_PORT') || 9000),
          storagePort: Number(env('FIREBASE_STORAGE_EMULATOR_PORT') || 9199),
        }
      : { enabled: false },
  };
}

export default defineApi({
  GET: {
    access: 'public',
    handle: ({ res }) => {
      try {
        assertRuntimeSecurity({ requireServerSecrets: false });
      } catch {
        res.status(500).json({ message: 'Ambiente Firebase inválido.' });
        return RAW_RESPONSE;
      }
      const config = clientConfig();
      if (!config.firebase.projectId) {
        res.status(500).json({ message: 'Firebase não configurado.' });
        return RAW_RESPONSE;
      }
      return config;
    },
  },
});
