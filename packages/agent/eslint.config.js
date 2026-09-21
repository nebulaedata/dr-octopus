/**
 * @author Codex
 * @description Agent 包的 ESLint 配置
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportSpecifier[importKind='type']",
          message: '类型导入必须使用独立的 import type 声明，禁止与值导入混用。',
        },
        {
          selector: "ExportSpecifier[exportKind='type']",
          message: '类型导出必须使用独立的 export type 声明，禁止与值导出混用。',
        },
        {
          selector: "ImportDeclaration[importKind='type'] ~ ImportDeclaration[importKind='value']",
          message: '所有普通 import 必须位于 import type 之前，并将 import type 集中放置。',
        },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['test/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
