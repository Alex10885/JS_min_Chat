module.exports = {
  env: {
    node: true,
    es6: true,
    jest: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2020
  },
  rules: {
    'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    'require-atomic-updates': 'off',
    'no-empty-pattern': 'off',
    'no-useless-catch': 'off',
    'no-prototype-builtins': 'off',
    'no-useless-escape': 'off',
    'no-const-assign': 'off',  // For testFixtures.js
    'no-class-assign': 'off'
  }
};