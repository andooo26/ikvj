import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      rolldownOptions: { input: resolve(import.meta.dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can't require siblings: each must be one CJS file.
      isolatedEntries: true,
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
          gen: resolve(import.meta.dirname, 'src/preload/gen.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          gen: resolve(import.meta.dirname, 'src/renderer/gen.html'),
          projector: resolve(import.meta.dirname, 'src/renderer/projector.html'),
        },
      },
    },
  },
});
