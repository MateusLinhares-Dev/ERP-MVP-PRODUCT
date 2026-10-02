import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function parseEnv(content) {
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

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') return;

  const path = resolve(process.cwd(), '.env.erp.local');
  if (!existsSync(path)) return;

  const local = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(local)) {
    process.env[key] = value;
  }
}

loadLocalEnv();
