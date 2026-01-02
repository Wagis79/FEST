import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'test-results/**'],
  },
  {
    rules: {
      // Tillåt unused vars med underscore-prefix
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_' 
      }],
      // Tillåt any men varna (så vi kan fixa gradvis)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Tillåt require för dynamiska imports i HiGHS
      '@typescript-eslint/no-require-imports': 'off',
      // Konsistens för typer
      '@typescript-eslint/consistent-type-imports': ['error', { 
        prefer: 'type-imports' 
      }],
    },
  }
);
