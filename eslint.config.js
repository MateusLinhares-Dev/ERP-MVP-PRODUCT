import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    files: ['server/**/*.ts', 'api/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: { globals: { ...globals.node } },
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
