/**
 * @author Codex
 * @description Lints the independently built MV3 connection worker without Executor imports.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
export default [
  { ignores: ['.output/**', '.wxt/**'] },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  ...tseslint.configs.recommended,
  { rules: { curly: ['error', 'all'], eqeqeq: ['error', 'always'] } },
];
