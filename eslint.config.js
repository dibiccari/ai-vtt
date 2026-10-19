// ESLint (flat config): it looks for real mistakes (typos in names, unreachable code, duplicate keys, bad regexes), not for style; the code keeps its own dense style.
// Server, library, script and test files are ES modules for Node. The pages' scripts are classic scripts that share one global scope per page, so a name defined in one file and used in another is normal there (no-undef and no-unused-vars are off for them).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'data/**', 'public/vendor/**', 'public/uploads/**', 'public/tokens/**', 'public/audio/**', 'public/scenarios/**', 'public/dev/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'off',          // flags defensive initialisations (let x = ''; then set in a branch): style, not a bug
      'preserve-caught-error': 'off',
      'no-async-promise-executor': 'warn',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off' }
  },
  {
    files: ['public/js/sight.js', 'public/js/token-size.js', 'public/js/map-shared.js', 'public/js/combat-order.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-undef': 'error' }
  }
];
