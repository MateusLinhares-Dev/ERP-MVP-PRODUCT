const FIREBASE_VERSION = '9.23.0';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-runtime-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.runtimeSrc = src;
    script.onload = () => { script.dataset.loaded = '1'; resolve(); };
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadFirebaseCompat(runtimeConfig) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  await loadScript(`${base}/firebase-app-compat.js`);
  await loadScript(`${base}/firebase-auth-compat.js`);
  await loadScript(`${base}/firebase-database-compat.js`);
  await loadScript(`${base}/firebase-storage-compat.js`);

  if (!window.firebase.apps.length) {
    window.firebase.initializeApp(runtimeConfig.firebase);
  }

  try {
    if (window.firebase.database?.INTERNAL?.forceWebSockets) {
      window.firebase.database.INTERNAL.forceWebSockets();
    }
  } catch (error) {
    console.warn('[Firebase] Não foi possível forçar WebSocket; usando fallback do SDK.', error);
  }

  const auth = window.firebase.auth();

  if (runtimeConfig.emulators?.enabled) {
    const host = runtimeConfig.emulators.host || '127.0.0.1';
    auth.useEmulator(`http://${host}:${runtimeConfig.emulators.authPort || 9099}`, { disableWarnings: true });
  }

  const db = window.firebase.database();
  const storage = window.firebase.storage();

  if (runtimeConfig.emulators?.enabled) {
    const host = runtimeConfig.emulators.host || '127.0.0.1';
    db.useEmulator(host, runtimeConfig.emulators.databasePort || 9000);
    storage.useEmulator(host, runtimeConfig.emulators.storagePort || 9199);
  }

  try { await auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION); } catch (error) {
    console.warn('[Firebase] Não foi possível configurar persistência de sessão.', error);
  }

  return { auth, db, storage };
}
