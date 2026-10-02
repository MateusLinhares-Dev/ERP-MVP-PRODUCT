const LOCAL_ENVS = new Set(['local', 'development', 'dev', 'test']);
const HML_ENVS = new Set(['homolog', 'homologacao', 'hml', 'staging', 'preview']);

function bool(value) { return String(value || '').toLowerCase() === 'true'; }
function appEnv() { return String(process.env.APP_ENV || '').trim().toLowerCase(); }
function isDemoProject(projectId) { return /^demo-/i.test(String(projectId || '')); }

export function runtimeEnvironment() {
  const env = appEnv() || (bool(process.env.USE_FIREBASE_EMULATORS) ? 'local' : 'production');
  if (LOCAL_ENVS.has(env)) return 'local';
  if (HML_ENVS.has(env)) return 'homolog';
  if (env === 'production' || env === 'prod') return 'production';
  return env;
}

export function assertRuntimeSecurity({ requireServerSecrets = false } = {}) {
  const env = runtimeEnvironment();
  const emulators = bool(process.env.USE_FIREBASE_EMULATORS);
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const vercelEnv = String(process.env.VERCEL_ENV || '').trim().toLowerCase();

  if (!projectId) throw new Error('FIREBASE_PROJECT_ID não configurado.');

  if (env !== 'local') {
    if (emulators) throw new Error('USE_FIREBASE_EMULATORS=true é proibido fora do ambiente local.');
    if (isDemoProject(projectId)) throw new Error('Projeto Firebase demo-* é proibido em homologação/produção.');
    if (!process.env.FIREBASE_DATABASE_URL) throw new Error('FIREBASE_DATABASE_URL obrigatório fora do ambiente local.');
    if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET obrigatório fora do ambiente local.');
    const rateSecret = String(process.env.LOGIN_RATE_LIMIT_SECRET || '');
    if (rateSecret.length < 32) throw new Error('LOGIN_RATE_LIMIT_SECRET precisa ter pelo menos 32 caracteres fora do ambiente local.');
  }

  if (vercelEnv === 'production' && env !== 'production') {
    throw new Error('Vercel Production deve usar APP_ENV=production.');
  }
  if (vercelEnv === 'preview' && env === 'production') {
    throw new Error('Vercel Preview não pode apontar para APP_ENV=production. Use homologação.');
  }

  if (requireServerSecrets && env !== 'local' && !process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 obrigatório no servidor em homologação/produção.');
  }

  return { env, emulators, projectId, vercelEnv };
}

export function assertServiceAccountMatchesProject(account, projectId = process.env.FIREBASE_PROJECT_ID) {
  if (!account || typeof account !== 'object') throw new Error('Service account inválida.');
  const accountProject = String(account.project_id || '').trim();
  const expected = String(projectId || '').trim();
  if (!accountProject || !expected || accountProject !== expected) {
    throw new Error('A service account não pertence ao FIREBASE_PROJECT_ID configurado.');
  }
  return true;
}
