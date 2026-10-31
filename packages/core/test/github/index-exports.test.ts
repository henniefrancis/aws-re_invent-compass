import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import * as github from '../../src/github/index.js';
import { repoRoot } from '../support/repo-root.js';
import { DASH_PATTERN } from '../support/dashes.js';

// Structural export test for the GitHub entry point (compass-power task 45.1). The list is explicit
// so a new export, especially one that could expose a token, is a deliberate change.

const EXPECTED = [
  'ACCESS_TOKEN_URL',
  'ALLOWED_GITHUB_HOSTS',
  'DEFAULT_ARCHIVE_LIMITS',
  'DEFAULT_GITHUB_SCAN_BUDGET_MS',
  'GITHUB_WORKER_HEAP_MB',
  'DEVICE_CODE_URL',
  'DEVICE_GRANT_TYPE',
  'GITHUB_API_ORIGIN',
  'GITHUB_API_VERSION',
  'GITHUB_FAILURE_CODES',
  'GITHUB_KEYCHAIN_ACCOUNTS',
  'GITHUB_KEYCHAIN_SERVICE',
  'GITHUB_REFRESH_WINDOW_SECONDS',
  'GitHubArchiveError',
  'GitHubError',
  'GitHubNetworkError',
  'GitHubNotConnectedError',
  'GitHubRateLimitedError',
  'GitHubRepositoryNotFoundError',
  'GitHubRequestError',
  'GitHubSignInError',
  'GitHubUrlRefusedError',
  'MAX_LISTED_REPOSITORIES',
  'MAX_LISTING_PAGES',
  'SLOW_DOWN_SECONDS',
  'USER_AGENT',
  'assertAllowedUrl',
  'createGitHubClient',
  'createGitHubTokenStore',
  'defaultGitHubFetch',
  'getAccessToken',
  'isRepositoryFullName',
  'pollDeviceToken',
  'readRepositoryArchive',
  'refreshGitHubToken',
  'registerGitHubSecrets',
  'scanGitHubRepoInWorker',
  'startDeviceFlow',
  'waitForDeviceToken',
];

describe('@compass/core/github exports', () => {
  test('exports exactly the expected names', () => {
    expect(Object.keys(github).sort()).toEqual([...EXPECTED].sort());
  });
});

describe('the GitHub module source', () => {
  const dir = join(repoRoot(), 'packages', 'core', 'src', 'github');
  const sources = readdirSync(dir).map((name) => ({
    name,
    text: readFileSync(join(dir, name), 'utf8'),
  }));

  test('never writes to disk and never logs', () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(
        /from 'node:fs|from 'fs|console\.|writeFile|createWriteStream/,
      );
    }
  });

  test('names only the three GitHub hosts', () => {
    for (const { name, text } of sources) {
      const hosts = [...text.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((match) => match[1]);
      for (const host of hosts) {
        expect(
          ['github.com', 'api.github.com', 'codeload.github.com'],
          `${name}: ${String(host)}`,
        ).toContain(host);
      }
    }
  });

  test('holds no en dash or em dash', () => {
    for (const { name, text } of sources) {
      expect(DASH_PATTERN.test(text), name).toBe(false);
    }
  });
});
