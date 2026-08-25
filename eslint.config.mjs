import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// The repo carried an `eslintConfig: react-app` stanza in package.json and 20+
// `eslint-disable-line react-hooks/exhaustive-deps` comments, but no eslint was
// ever installed — so none of those directives were enforced and nothing checked
// hook dependency arrays. That is the same rule family that would have caught the
// Date.now() realtime-channel bug in useSuperAdminDashboard.
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.claude/**',
      'demo-client-website/**',
      'aws-lambda/**',
      'supabase/functions/**', // Deno + TypeScript; needs its own toolchain.
      'scripts/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // The rules that matter here. rules-of-hooks is never negotiable; the
      // exhaustive-deps warnings are what the inline disables refer to.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // JSX: catch components/vars used only inside JSX being reported unused.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',

      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['**/*.test.{js,jsx}', 'src/test-setup.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },
];
