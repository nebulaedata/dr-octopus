/**
 * @author Codex
 * @description Defines linting boundaries and TypeScript parser context for the web application.
 */
import js from '@eslint/js';
import globals from 'globals';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
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
          selector: "Property[key.name='refetchInterval'], Property[key.value='refetchInterval']",
          message: '业务状态禁止定时轮询；请在统一 SSE/WS 事件同步入口失效对应 Query。',
        },
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
      'no-nested-ternary': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-i18next',
              importNames: ['useTranslation'],
              message:
                '业务代码必须使用 @/i18n/use-i18n 的 useI18n()；react-i18next 仅限 src/i18n/ 内部使用。',
            },
          ],
          patterns: [
            {
              group: ['../../*'],
              message: '超过一层的相对路径导入必须使用 @ 别名，例如 @/components/Example。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^React$' }],
    },
  },
  {
    // src/i18n 是 react-i18next 的唯一允许入口，其余限制（如深层相对路径）继续保持。
    files: ['src/i18n/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message: '超过一层的相对路径导入必须使用 @ 别名，例如 @/components/Example。',
            },
          ],
        },
      ],
    },
  },
  {
    // 国际化 Phase 2：JSX 硬编码文案先以 warn 盘点存量，迁移收敛后升级为 error。
    files: ['src/**/*.{ts,tsx}'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': 'warn',
    },
  },
  {
    files: ['test/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
