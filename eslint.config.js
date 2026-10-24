// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Determinism enforcement for Temporal workflow code.
 *
 * A workflow that reads the clock, sleeps on a real timer, does I/O or touches
 * the environment is non-deterministic on replay. In this system a bad replay
 * can mean a second booking and a second card payment, so the rules are
 * enforced by the build rather than by code review.
 */
const workflowDeterminismRules = {
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'Use workflow.now() — wall-clock time breaks replay.' },
    { name: 'setTimeout', message: 'Use workflow.sleep().' },
    { name: 'setInterval', message: 'Use workflow.sleep() in a loop.' },
    { name: 'fetch', message: 'No I/O in workflow code. Use an activity.' },
    { name: 'crypto', message: 'No crypto in workflow code. Poll jitter uses the workflow-seeded Math.random, which replays safely.' },
    { name: 'process', message: 'No environment access in workflow code.' },
  ],
  'no-restricted-properties': [
    'error',
    
    { object: 'Date', property: 'now', message: 'Use workflow.now().' },
    { object: 'crypto', property: 'randomUUID', message: 'Use workflow.uuid4().' },
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'node:crypto', message: 'No crypto in workflow code.' },
        { name: 'crypto', message: 'No crypto in workflow code.' },
        { name: 'node:fs', message: 'No I/O in workflow code.' },
        { name: 'node:https', message: 'No I/O in workflow code.' },
        { name: 'node:os', message: 'No host access in workflow code.' },
        { name: 'playwright', message: 'Browser automation is I/O. Call it from an activity.' },
      ],
      patterns: [
        { group: ['@whataracket/clubspark', '@whataracket/clubspark/*'], message: 'The ClubSpark client is I/O. Call it from activities.' },
        {
          group: ['@whataracket/activities', '@whataracket/activities/*'],
          importNames: ['default'],
          message: 'Import activity TYPES only (import type { ... }), never implementations — that would bundle I/O into the workflow sandbox.',
        },
      ],
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    // A dedicated config that INCLUDES test files. The per-package tsconfigs
    // exclude them so they are not emitted to dist.
    languageOptions: { parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/workflows/src/**/*.ts'],
    rules: workflowDeterminismRules,
  },
  {
    // packages/domain is pure by contract — it is imported BY workflow code,
    // so it inherits the same determinism constraints.
    files: ['packages/domain/src/**/*.ts'],
    rules: workflowDeterminismRules,
  },
  {
    files: ['**/*.test.ts', 'tools/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off', 'no-restricted-imports': 'off' },
  },
);
