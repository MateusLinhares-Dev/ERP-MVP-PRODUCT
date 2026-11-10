import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const noComments = {
  meta: { type: 'suggestion', schema: [], messages: { comment: 'Comentários não são permitidos no código.' } },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== 'Shebang') context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'test/**', 'scripts/**', '**/*.js', '**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['web/**/*.ts', 'web/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules, 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['server/**/*.ts', 'api/**/*.ts', 'web/**/*.ts', 'web/**/*.tsx', 'vite.config.ts'],
    plugins: { erp: { rules: { 'no-comments': noComments } } },
    rules: {
      'erp/no-comments': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
