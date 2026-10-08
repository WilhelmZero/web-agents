import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/web-agents/' : '/',
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: {
    exclude: [...configDefaults.exclude, 'server/**'],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
}));
