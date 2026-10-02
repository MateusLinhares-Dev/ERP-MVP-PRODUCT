import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const APP_LOCAL_ENV_FILE = '.env.erp.local';
export const APP_LOCAL_ENV_EXAMPLE = '.env.erp.local.example';
export const VERCEL_LOCAL_ENV_FILE = '.env.local';

export function parseEnv(content) {
  const env = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const idx = normalized.indexOf('=');
    if (idx <= 0) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}

function hasAppConfig(path) {
  if (!existsSync(path)) return false;
  const env = parseEnv(readFileSync(path, 'utf8'));
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_DATABASE_URL);
}

export function ensureAppLocalEnv({ cwd = process.cwd(), quiet = false } = {}) {
  const appPath = resolve(cwd, APP_LOCAL_ENV_FILE);
  const examplePath = resolve(cwd, APP_LOCAL_ENV_EXAMPLE);
  const vercelPath = resolve(cwd, VERCEL_LOCAL_ENV_FILE);

  if (existsSync(appPath)) {
    if (!hasAppConfig(appPath)) {
      throw new Error(`[ENV] ${APP_LOCAL_ENV_FILE} existe, mas não contém FIREBASE_PROJECT_ID/FIREBASE_DATABASE_URL válidos. Corrija o arquivo; ele não será sobrescrito automaticamente.`);
    }
    if (!quiet) console.log(`[ENV] Configuração local do ERP: ${APP_LOCAL_ENV_FILE}`);
    return appPath;
  }

  if (hasAppConfig(vercelPath)) {
    copyFileSync(vercelPath, appPath);
    if (!quiet) {
      console.log(`[ENV] Migração automática: ${VERCEL_LOCAL_ENV_FILE} -> ${APP_LOCAL_ENV_FILE}`);
      console.log(`[ENV] A partir de agora, ${VERCEL_LOCAL_ENV_FILE} pode ser gerenciado pela Vercel CLI.`);
    }
    return appPath;
  }

  if (!existsSync(examplePath)) {
    throw new Error(`[ENV] ${APP_LOCAL_ENV_EXAMPLE} não encontrado na raiz do projeto.`);
  }

  copyFileSync(examplePath, appPath);
  if (!quiet) {
    const vercelManaged = existsSync(vercelPath) && !hasAppConfig(vercelPath);
    if (vercelManaged) {
      console.log(`[ENV] ${VERCEL_LOCAL_ENV_FILE} parece ser gerenciado pela Vercel; ele foi preservado.`);
    }
    console.log(`[ENV] Criado ${APP_LOCAL_ENV_FILE} a partir de ${APP_LOCAL_ENV_EXAMPLE}.`);
    console.log('[ENV] Esse arquivo é exclusivo do ambiente local do ERP e nunca é sobrescrito pela Vercel CLI.');
  }
  return appPath;
}

export function readAppLocalEnv({ cwd = process.cwd() } = {}) {
  const path = ensureAppLocalEnv({ cwd, quiet: true });
  return parseEnv(readFileSync(path, 'utf8'));
}
