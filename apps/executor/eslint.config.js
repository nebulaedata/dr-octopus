/**
 * @author Codex
 * @description Enforces executor process imports and focused TypeScript/React linting.
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist/**', 'build/**', 'release/**']),
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { curly: ['error', 'all'], eqeqeq: ['error', 'always'] },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.renderer.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/consistent-type-exports': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['electron'],
          patterns: ['node:*', '**/main/*', '**/runtime/*', '**/preload/*'],
        },
      ],
    },
  },
  {
    files: ['test/integration/*.mjs', 'test/packaging/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['test/integration/browser-bridge.test.mjs'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
]);
