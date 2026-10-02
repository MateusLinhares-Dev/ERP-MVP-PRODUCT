import { ensureAppLocalEnv } from './local-env.mjs';

try {
  ensureAppLocalEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
