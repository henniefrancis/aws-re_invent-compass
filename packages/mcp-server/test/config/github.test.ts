import { describe, expect, test } from 'vitest';
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_SLUG,
  readGitHubAppConfig,
} from '../../src/config/github.js';

describe('the GitHub App settings', () => {
  test('the build ships no secret: only a public client ID and slug, empty until the owner registers the app', () => {
    expect(GITHUB_APP_CLIENT_ID).toMatch(/^[A-Za-z0-9.]{0,64}$/);
    expect(GITHUB_APP_SLUG).toMatch(/^[a-z0-9-]{0,63}$/);
  });

  test('with no client ID GitHub is not set up', () => {
    expect(readGitHubAppConfig({})).toEqual(
      GITHUB_APP_CLIENT_ID === ''
        ? undefined
        : expect.objectContaining({ clientId: GITHUB_APP_CLIENT_ID }),
    );
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
    expect(readGitHubAppConfig({ COMPASS_GITHUB_CLIENT_ID: 'Iv23liAbc' })?.clientId).toBe(
      'Iv23liAbc',
    );
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
