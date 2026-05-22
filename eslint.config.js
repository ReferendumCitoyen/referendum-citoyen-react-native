// ESLint v9+ flat config. Replaces the legacy .eslintrc.js after the
// dependency bumped to eslint@^9.39.2 (which no longer reads .eslintrc.*).
//
// `eslint-config-expo/flat` bundles core + TypeScript + React + Expo
// rules and is the official Expo-recommended preset. `eslint-config-
// prettier` disables stylistic rules that would conflict with our
// Prettier setup (we run `npm run format` separately for formatting).

const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

module.exports = [
  // Global ignores — must be the first entry per the flat-config spec.
  {
    ignores: [
      'node_modules/',
      'ios/',
      'android/',
      '.expo/',
      'dist/',
      'build/',
      '**/build/**',
      '*.config.js',
      'metro.config.js',
      'eslint.config.js',
      // Plugin/build artifacts contain `/* eslint-disable @typescript-eslint/* */`
      // directives that no longer resolve because flat config scopes the TS
      // plugin to .ts/.tsx — the source they're built from is what we lint.
      'plugins/**/build/',
      'modules/**/plugin/build/',
      'modules/witnesscalculator/android/',
      'modules/rapidsnark-wrp/android/',
      // Exported snapshot of an older project. Not in scope for linting here.
      'passport-scan-export/',
    ],
  },
  ...expoConfig,
  // `eslint-config-prettier` exposes an object with rules only — it's
  // safe to apply globally because it just turns off conflicting rules.
  prettierConfig,
  // Project-wide rules (any file).
  {
    rules: {
      'no-console': 'warn',
    },
  },
  // Node scripts (scripts/**) — declare Node globals so Buffer / __dirname /
  // process don't trigger `no-undef`. These files are run via `node`, not
  // bundled into the RN app, so they have access to the standard Node API.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // TS/TSX-only rules. Must re-declare the @typescript-eslint plugin
  // inside the same config object that uses its rules — flat-config
  // scopes plugin registrations to the object they're declared in.
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
