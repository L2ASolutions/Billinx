// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Allow `any` types — project uses Prisma/NestJS patterns with dynamic typing
      '@typescript-eslint/no-explicit-any': 'off',
      // Suppress all no-unsafe-* rules: consistent with no-explicit-any being off;
      // flagging uses of any values is noise when any is intentionally allowed.
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // NestJS guard/interceptor pattern — async interface methods that don't always await
      '@typescript-eslint/require-await': 'off',
      // Downgrade from error to warn; keep catching real issues without blocking CI
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/restrict-plus-operands': 'warn',
      // Unused vars: error but ignore underscore-prefixed params
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
