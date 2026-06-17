import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  // Pass an inline (empty) tsconfig so esbuild's dependency scan doesn't walk
  // up the filesystem looking for one — this project has no tsconfig.json,
  // and a parent folder outside the repo has an unrelated, broken one.
  // optimizeDeps.esbuildOptions controls the dependency *scanner* specifically
  // (top-level `esbuild` only affects the transform step).
  esbuild: {
    tsconfigRaw: '{}',
  },
  optimizeDeps: {
    esbuildOptions: {
      tsconfigRaw: '{}',
    },
  },
});
