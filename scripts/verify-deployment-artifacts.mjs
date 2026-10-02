import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const mustExist = [
  'dist/index.html',
  'dist/app/bootstrap.js',
  'dist/app/firebase-loader.js',
  'dist/legacy/app-core.js',
  'api/config.js',
  'api/auth/login.js',
  'vercel.json',
];
for (const rel of mustExist) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`Arquivo obrigatório ausente: ${rel}`);
}

let vercel = {};
try { vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); }
catch { errors.push('vercel.json inválido.'); }
if (vercel.buildCommand !== 'npm run build') errors.push('vercel.json deve usar buildCommand = npm run build');
if (vercel.outputDirectory !== 'dist') errors.push('vercel.json deve usar outputDirectory = dist');
if (vercel.framework !== null) errors.push('vercel.json deve manter framework=null (Other/static + Functions).');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const publicFiles = walk(path.join(root, 'dist'));
const sensitivePatterns = [
  /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  /"private_key"\s*:/,
  /FIREBASE_SERVICE_ACCOUNT_B64\s*=/,
  /LOGIN_RATE_LIMIT_SECRET\s*=/,
  /LOCAL_DEV_PASSWORD_BASE\s*=/,
];
for (const file of publicFiles) {
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) errors.push(`Possível segredo no bundle público: ${path.relative(root, file)} (${pattern})`);
  }
}

const forbiddenAtRoot = fs.readdirSync(root).filter((name) =>
  /^service-account.*\.json$/i.test(name) ||
  ['.env.hml', '.env.production', '.env.erp.local'].includes(name)
);
if (forbiddenAtRoot.length) {
  warnings.push(`Arquivos locais sensíveis presentes no workspace (não devem ser enviados ao Git/Vercel): ${forbiddenAtRoot.join(', ')}`);
}

const ignore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
for (const expected of ['.env*', 'service-account*.json', '.emulator-data', 'scripts/dev-users.json', 'scripts/dev-materials.json', 'scripts/dev-business-data.json']) {
  if (!ignore.includes(expected)) errors.push(`.vercelignore não protege: ${expected}`);
}

if (errors.length) {
  console.error('[DEPLOY VERIFY] REPROVADO');
  errors.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}
console.log(`[DEPLOY VERIFY] OK — ${publicFiles.length} arquivo(s) em dist verificados.`);
warnings.forEach((w) => console.warn(`[DEPLOY VERIFY] AVISO — ${w}`));
console.log('[DEPLOY VERIFY] dist é o frontend estático; /api continua sendo empacotado pela Vercel como Functions separadas.');
