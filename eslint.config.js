import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // '**/._*' — AppleDouble sidecars macOS writes on network volumes; binary, not source.
    //
    // Colocated tests are linted. They used to be ignored here while
    // tsconfig.check.json excluded them too, so no test file in the repo was
    // type-checked or linted, and `npm run type-check && npm run lint && npm test`
    // passed on a test file tsc rejects outright for a duplicate import.
    ignores: ['dist/**', 'node_modules/**', '**/._*'],
  }
);
