import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const dataDir = path.join(root, '.emulator-data');
const metadata = path.join(dataDir, 'firebase-export-metadata.json');
fs.mkdirSync(dataDir, { recursive: true });

const firebaseCli = path.join(
  root,
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js',
);

if (!fs.existsSync(firebaseCli)) {
  console.error('[FIREBASE] Firebase CLI local não encontrada. Execute npm install.');
  process.exit(1);
}

const args = [
  firebaseCli,
  'emulators:start',
  '--project',
  'demo-manuela-erp',
  '--export-on-exit',
  dataDir,
];

if (String(process.env.DOCKER_DEV || '').toLowerCase() === 'true') {
  args.push('--config', path.join(root, 'firebase.docker.json'));
  console.log('[FIREBASE] Docker local: emuladores expostos em 0.0.0.0 apenas através dos binds localhost do Compose.');
}

if (fs.existsSync(metadata)) {
  args.push('--import', dataDir);
  console.log(`[FIREBASE] Restaurando dados do Emulator de ${dataDir}`);
} else {
  console.log('[FIREBASE] Primeiro uso: iniciando Emulator sem import anterior.');
}

const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {}
  });
}

child.on('error', (error) => {
  console.error('[FIREBASE] Falha ao iniciar Firebase Emulator:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
    return;
  }
  process.exit(code ?? 0);
});
