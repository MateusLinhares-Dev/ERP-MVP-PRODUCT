import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: fromRoot('./web/pages'),
  publicDir: fromRoot('./public'),
  plugins: [react()],
  build: {
    outDir: fromRoot('./dist'),
    emptyOutDir: false,
    copyPublicDir: false,
    assetsDir: 'web',
    manifest: true,
    target: 'es2020',
    rolldownOptions: {
      input: {
        rapido: fromRoot('./web/pages/rapido/index.html'),
        'erp-islands': fromRoot('./web/erp/islands.tsx'),
      },
    },
  },
});
