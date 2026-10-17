// Flat ESLint config for the re:Invent Compass monorepo (foundation-contracts, S0).
//
// It applies the typescript-eslint recommended type-checked rules to all
// TypeScript, forbids deep relative imports that cross a package boundary (so a
// @compass/core subpath is always reached through its declared subpath export,
// never through a deep relative path), and prepares angular-eslint for the site
// workspace. There is deliberately no eslint-plugin-import dependency: the
// cross-package deep-relative-import ban is enforced by no-restricted-imports
// alone.

import tseslint from 'typescript-eslint';
import angular from '@angular-eslint/eslint-plugin';
import angularTemplateParser from '@angular-eslint/template-parser';

// Patterns that reach from one package into another package's internals through
// a relative path. A legitimate cross-package import always uses the declared
// package specifier (for example '@compass/core/rules'), so any relative path
// that climbs out of the current package and dives into packages/<name>/src or
// a sibling package's src is a boundary violation.
const crossPackageRelativeImportPatterns = [
  {
    group: ['**/packages/*/src/**', '**/packages/*/dist/**'],
    message:
      'Import across packages through the declared package subpath export (for example @compass/core/rules), never a deep relative path into another package.',
  },
  {
    group: ['../../*/src/**', '../../*/dist/**', '../../../*/src/**', '../../../*/dist/**'],
    message:
      'Import across packages through the declared package subpath export (for example @compass/core/rules), never a deep relative path into another package.',
  },
];

export default tseslint.config(
  {
    // Nothing to lint inside build output, dependencies or generated code.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/generated/**',
      '**/*.generated.ts',
      'fixtures/sample-repo/**',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level TypeScript config files (for example vitest.config.ts) are
          // not part of any workspace tsconfig. Allow the project service to type
          // them with the default inferred project so they are still linted with
          // type-aware rules rather than failing to parse.
          allowDefaultProject: ['*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: crossPackageRelativeImportPatterns }],
    },
  },
  {
    // ADR-026: pass-service production code never imports node-forge directly. Its only
    // use stays the transitive signing path inside passkit-generator; tests may use it
    // to generate throwaway certificates.
    files: ['packages/pass-service/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...crossPackageRelativeImportPatterns,
            {
              group: ['node-forge', 'node-forge/*'],
              message: 'node-forge is test-only in pass-service (ADR-026).',
            },
          ],
        },
      ],
    },
  },
  {
    // The angular-eslint block, scoped to the site workspace only.
    files: ['site/**/*.ts'],
    plugins: {
      '@angular-eslint': angular,
    },
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },
  {
    // Angular component templates in the site workspace.
    files: ['site/**/*.html'],
    languageOptions: {
      parser: angularTemplateParser,
    },
  },
  {
    // Config files and plain Node scripts are not part of a tsconfig project, so
    // they must not be linted with type-aware rules.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
