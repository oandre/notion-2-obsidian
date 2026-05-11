import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/web/**', 'happy-dom']],
    setupFiles: ['src/web/test-setup.ts'],
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
});
