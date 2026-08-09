import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'warn',
      'no-unreachable': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
]
