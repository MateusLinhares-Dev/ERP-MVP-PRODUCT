import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
let loaded = false;

function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (VARIABLE_NAME.test(key)) env[key] = unquote(normalized.slice(separator + 1).trim());
  }
  return env;
}

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;
  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') return;
  const path = resolve(process.cwd(), '.env.erp.local');
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    process.env[key] = value;
  }
}

loadLocalEnv();
