import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APP_LOCAL_ENV_FILE, ensureAppLocalEnv } from './local-env.mjs';

const source = ensureAppLocalEnv({ quiet: true });
const target = resolve(process.cwd(), '.vercel', '.env.development.local');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[ENV] ${APP_LOCAL_ENV_FILE} sincronizado para .vercel/.env.development.local`);
