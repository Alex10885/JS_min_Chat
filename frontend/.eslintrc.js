module.exports = {
  env: {
    browser: true,
    es6: true,
    jest: true,
    node: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  globals: {
    global: 'readonly',
    process: 'readonly'
  },
  rules: {
    'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
    'no-const-assign': 'error',
    'no-class-assign': 'off',
    'no-undef': 'off' // Turn off no-undef for process/global using globals above
  }
};