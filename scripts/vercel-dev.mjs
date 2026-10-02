import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_LOCAL_ENV_FILE, readAppLocalEnv } from './local-env.mjs';

const localEnv = readAppLocalEnv();
if (!localEnv.FIREBASE_PROJECT_ID) {
  console.error(`[ENV] FIREBASE_PROJECT_ID não encontrado em ${APP_LOCAL_ENV_FILE}.`);
  process.exit(1);
}

const mergedEnv = { ...process.env, ...localEnv };
console.log(`[ENV] Vercel Dev iniciado com FIREBASE_PROJECT_ID=${mergedEnv.FIREBASE_PROJECT_ID}`);
console.log(`[ENV] Firebase Emulator: ${mergedEnv.USE_FIREBASE_EMULATORS}`);
console.log(`[ENV] ${APP_LOCAL_ENV_FILE} é a fonte das variáveis do ERP; .env.local fica reservado à Vercel CLI.`);

const vercelCli = resolve(process.cwd(), 'node_modules', 'vercel', 'dist', 'index.js');
if (!existsSync(vercelCli)) {
  console.error('[ENV] Vercel CLI local não encontrada. Execute npm install.');
  process.exit(1);
}

const listenAddress = String(process.env.DOCKER_DEV || '').toLowerCase() === 'true'
  ? '0.0.0.0:3000'
  : '3000';

const child = spawn(process.execPath, [vercelCli, 'dev', '--listen', listenAddress, '--yes'], {
  cwd: process.cwd(),
  env: mergedEnv,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
