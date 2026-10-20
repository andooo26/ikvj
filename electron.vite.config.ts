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
      // Sandboxed preloads must be a single CommonJS file.
      rolldownOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rolldownOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
});
