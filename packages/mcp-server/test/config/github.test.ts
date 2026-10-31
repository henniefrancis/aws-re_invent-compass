import { describe, expect, test } from 'vitest';
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_SLUG,
  readGitHubAppConfig,
} from '../../src/config/github.js';

describe('the GitHub App settings', () => {
  test('the build ships no secret: only the public client ID and slug of the registered app', () => {
    expect(GITHUB_APP_CLIENT_ID).toBe('Iv23liKdFb0y0U0QXj6N');
    expect(GITHUB_APP_SLUG).toBe('re-invent-compass-unofficial');
  });

  test('with no environment the build app is used, with its install page', () => {
    expect(readGitHubAppConfig({})).toEqual({
      clientId: 'Iv23liKdFb0y0U0QXj6N',
      installUrl: 'https://github.com/apps/re-invent-compass-unofficial/installations/new',
    });
  });

  test('with an empty or invalid client ID GitHub is not set up', () => {
    expect(readGitHubAppConfig({ COMPASS_GITHUB_CLIENT_ID: '' })).toBeUndefined();
    expect(readGitHubAppConfig({ COMPASS_GITHUB_CLIENT_ID: 'bad id!' })).toBeUndefined();
  });

  test('the environment can name a self-hosted app and its install page', () => {
    expect(
      readGitHubAppConfig({
        COMPASS_GITHUB_CLIENT_ID: 'Iv23liAbc.123',
        COMPASS_GITHUB_APP_SLUG: 'my-compass',
      }),
    ).toEqual({
      clientId: 'Iv23liAbc.123',
      installUrl: 'https://github.com/apps/my-compass/installations/new',
    });
  });

  test('a client ID with the built-in slug', () => {
    expect(readGitHubAppConfig({ COMPASS_GITHUB_CLIENT_ID: 'Iv23liAbc' })).toEqual({
      clientId: 'Iv23liAbc',
      installUrl: 'https://github.com/apps/re-invent-compass-unofficial/installations/new',
    });
  });

  test('a slug that is not a plain GitHub slug gives no install link', () => {
    expect(
      readGitHubAppConfig({
        COMPASS_GITHUB_CLIENT_ID: 'Iv23liAbc',
        COMPASS_GITHUB_APP_SLUG: '../evil',
      }),
    ).toEqual({ clientId: 'Iv23liAbc', installUrl: undefined });
  });
});
