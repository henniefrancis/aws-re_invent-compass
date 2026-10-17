// Site ESLint configuration (showcase-site, S7).
//
// ESLint 10 looks up the configuration from the folder of each linted file, so this file
// applies to everything under site/. It restates the root rules for the site, because the
// root configuration lints .html files with type-aware rules that the Angular template
// parser cannot satisfy. It takes the typescript-eslint configs from the plugin package
// directly: reading them through the typescript-eslint helper records this folder as a
// second project root, and two recorded roots make every untyped file of the root
// configuration fail to parse.
//
//   - typescript-eslint recommended type-checked rules on all TypeScript;
//   - the cross-package deep relative import ban of the root configuration;
//   - the angular-eslint selector rules for components and directives;
//   - Angular templates (.html) parsed with the Angular template parser, with no
//     type-aware rules;
//   - plain Node scripts (.mjs) without type-aware rules.
//
// Integrator note: when the root eslint.config.js gives .html files the same treatment, this
// file can be deleted (see the Notes in .kiro/specs/showcase-site/tasks.md).

import tsPlugin from '@typescript-eslint/eslint-plugin';
import angular from '@angular-eslint/eslint-plugin';
import angularTemplateParser from '@angular-eslint/template-parser';

const crossPackageMessage =
  'Import across packages through the declared package subpath export (for example @compass/core/rules), never a deep relative path into another package.';

const noTypes = tsPlugin.configs['flat/disable-type-checked'];

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.angular/**'],
  },
  ...tsPlugin.configs['flat/recommended-type-checked'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // tsconfigRootDir is deliberately not set here. typescript-eslint keeps one set of
        // candidate root folders for the whole run, and a second candidate makes every
        // untyped file of the root configuration fail to parse. The project service finds
        // site/tsconfig.json for each site file on its own.
        projectService: true,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/*/src/**', '**/packages/*/dist/**'],
              message: crossPackageMessage,
            },
            {
              group: [
                '../../*/src/**',
                '../../*/dist/**',
                '../../../*/src/**',
                '../../../*/dist/**',
              ],
              message: crossPackageMessage,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
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
    ...noTypes,
    files: ['**/*.html'],
    languageOptions: { ...noTypes.languageOptions, parser: angularTemplateParser },
  },
  {
    ...noTypes,
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  },
];
