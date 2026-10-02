import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from './local-env.mjs';

const target = String(process.argv[2] || '').toLowerCase();
const fileArg = process.argv[3] || (target === 'prod' || target === 'production' ? '.env.production' : '.env.hml');
if (!['hml','homolog','homologacao','staging','prod','production'].includes(target)) {
  console.error('Uso: node scripts/preflight-env.mjs <hml|prod> [arquivo-env]');
  process.exit(2);
}
const file = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(file)) {
  console.error(`[PREFLIGHT] ${fileArg} não encontrado. Copie o .example correspondente e preencha localmente sem commitar.`);
  process.exit(2);
}
const env = parseEnv(fs.readFileSync(file,'utf8'));
const expectedAppEnv = (target === 'prod' || target === 'production') ? 'production' : 'homolog';
const errors=[];
const required=['APP_ENV','USE_FIREBASE_EMULATORS','FIREBASE_PROJECT_ID','FIREBASE_API_KEY','FIREBASE_AUTH_DOMAIN','FIREBASE_DATABASE_URL','FIREBASE_STORAGE_BUCKET','FIREBASE_MESSAGING_SENDER_ID','FIREBASE_APP_ID','FIREBASE_SERVICE_ACCOUNT_B64','LOGIN_RATE_LIMIT_SECRET'];
for(const key of required){ if(!env[key] || /^<.*>$/.test(env[key])) errors.push(`${key} ausente/placeholder`); }
if(String(env.APP_ENV||'').toLowerCase()!==expectedAppEnv) errors.push(`APP_ENV deve ser ${expectedAppEnv}`);
if(String(env.USE_FIREBASE_EMULATORS||'').toLowerCase()!=='false') errors.push('USE_FIREBASE_EMULATORS deve ser false');
if(/^demo-/i.test(env.FIREBASE_PROJECT_ID||'')) errors.push('FIREBASE_PROJECT_ID demo-* não pode ser usado fora do local');
if(String(env.FIREBASE_API_KEY||'')==='demo-api-key') errors.push('FIREBASE_API_KEY demo-api-key não pode ser usada fora do local');
if(String(env.LOGIN_RATE_LIMIT_SECRET||'').length<32) errors.push('LOGIN_RATE_LIMIT_SECRET deve ter 32+ caracteres');
try{
  const account=JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64||'','base64').toString('utf8'));
  if(account.type!=='service_account') errors.push('FIREBASE_SERVICE_ACCOUNT_B64 não contém type=service_account');
  if(!account.private_key || !String(account.private_key).includes('PRIVATE KEY')) errors.push('service account sem private_key válida');
  if(!account.client_email) errors.push('service account sem client_email');
  if(account.project_id!==env.FIREBASE_PROJECT_ID) errors.push('service account pertence a outro project_id');
}catch(e){ errors.push('FIREBASE_SERVICE_ACCOUNT_B64 não é JSON/base64 válido'); }
if(env.FIREBASE_DATABASE_URL && !env.FIREBASE_DATABASE_URL.startsWith('https://')) errors.push('FIREBASE_DATABASE_URL deve usar https://');
if(env.FIREBASE_DATABASE_URL && !env.FIREBASE_DATABASE_URL.includes(env.FIREBASE_PROJECT_ID||'')) errors.push('FIREBASE_DATABASE_URL não parece pertencer ao FIREBASE_PROJECT_ID');
if(env.FIREBASE_STORAGE_BUCKET && /:\/\//.test(env.FIREBASE_STORAGE_BUCKET)) errors.push('FIREBASE_STORAGE_BUCKET deve ser somente o nome do bucket, sem gs:// ou https://');
if(env.FIREBASE_STORAGE_BUCKET && !env.FIREBASE_STORAGE_BUCKET.includes(env.FIREBASE_PROJECT_ID||'')) errors.push('FIREBASE_STORAGE_BUCKET não parece pertencer ao FIREBASE_PROJECT_ID');

if(errors.length){
  console.error(`[PREFLIGHT] ${target.toUpperCase()} REPROVADO:`);
  errors.forEach(e=>console.error(` - ${e}`));
  process.exit(1);
}
console.log(`[PREFLIGHT] ${target.toUpperCase()} OK — projeto ${env.FIREBASE_PROJECT_ID}`);
console.log('[PREFLIGHT] Nenhum deploy foi executado.');
