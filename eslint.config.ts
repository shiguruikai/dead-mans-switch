import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // グローバル無視ルール
  globalIgnores(['.wrangler/', 'dist/', 'docs/', '**/worker-configuration.d.ts']),

  // 基本構成
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  stylistic.configs.customize({
    arrowParens: true,
    braceStyle: '1tbs',
    quotes: 'single',
    semi: true,
    severity: 'warn',
  }),

  // メイン構成
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: {
      'unused-imports': unusedImports,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // 可能な限りシングルクォーテーションを使用
      '@stylistic/quotes': [
        'warn',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: 'avoidEscape',
        },
      ],

      // 不要なセミコロンを禁止
      '@stylistic/no-extra-semi': 'warn',

      // セミコロンは文末に付ける
      '@stylistic/semi-style': ['warn', 'last'],

      // import type を強制する
      '@typescript-eslint/consistent-type-imports': ['warn'],

      // 未使用のインポートおよび変数を unused-imports で一元管理
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // import, export の自動ソート
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          tsconfigRootDir: import.meta.dirname,
        },
      },
    },
  },

  // ServiceWorker 用
  {
    files: ['public/sw.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // テストコード用の型ルール緩和
  {
    files: ['test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
]);
