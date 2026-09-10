import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    css: false,
    // Agent worktrees under .claude/ are full checkouts of this repo, so their
    // copies of every *.test.* file get collected too — the suite silently ran
    // 11 duplicates against a checkout that was days behind. Passing duplicates
    // are only the harmless case; once the branches diverge you get failures
    // pointing at code you are not editing.
    exclude: [...configDefaults.exclude, '**/.claude/**', 'build/**'],
  },
  resolve: {
    alias: {
      // Ensure src-relative imports work
    },
  },
});
