/**
 * @author Codex
 * @description Shared parser lint rules without Host-specific imports.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node }, rules: { curly: ['error', 'all'] } },
  { files: ['test/**/*.mjs'], ...js.configs.recommended },
];
