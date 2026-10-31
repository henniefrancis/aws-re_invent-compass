import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  GitHubNetworkError,
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRequestError,
  GitHubUrlRefusedError,
} from '../../src/github/errors.js';
import {
  ALLOWED_GITHUB_HOSTS,
  GITHUB_API_VERSION,
  apiHeaders,
  assertAllowedUrl,
  defaultGitHubFetch,
  discardBody,
  failureFor,
  readJsonBody,
  sendGitHubRequest,
  type GitHubResponseLike,
} from '../../src/github/http.js';
import { SECRET_ACCESS, errorText, fakeFetch, jsonResponse, streamResponse } from './support.js';

describe('assertAllowedUrl', () => {
  test('accepts https on the three GitHub hosts only', () => {
    expect([...ALLOWED_GITHUB_HOSTS].sort()).toEqual([
      'api.github.com',
      'codeload.github.com',
      'github.com',
    ]);
    for (const url of [
      'https://github.com/login/device/code',
      'https://api.github.com/user/installations',
      'https://codeload.github.com/o/r/legacy.tar.gz/refs/heads/main',
      'https://API.GitHub.com:443/x',
    ]) {
      expect(assertAllowedUrl(url)).toBeInstanceOf(URL);
    }
  });

  test.each([
    'http://api.github.com/user',
    'https://api.github.com.evil.example/user',
    'https://evil.example/https://api.github.com/',
    'https://gist.github.com/x',
    'https://api.github.com:8443/user',
    'https://user:pass@api.github.com/user',
    'https://token@github.com/x',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(GitHubUrlRefusedError);
  });
});

describe('sendGitHubRequest', () => {
  const get = (headers: Record<string, string>) =>
    ({ method: 'GET', headers, redirect: 'error' }) as const;

  test('sends to an allowed host and returns the response', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
    const response = await sendGitHubRequest(
      fetch,
      'https://api.github.com/user',
      get(apiHeaders(SECRET_ACCESS)),
    );
    expect(response.status).toBe(200);
    expect(calls[0].url).toBe('https://api.github.com/user');
  });

  test('never sends a token to github.com or codeload.github.com, in any header case', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
    for (const [url, name] of [
      ['https://codeload.github.com/o/r/tar', 'authorization'],
      ['https://codeload.github.com/o/r/tar', 'Authorization'],
      ['https://github.com/login/oauth/access_token', 'AUTHORIZATION'],
    ] as const) {
      const error = await sendGitHubRequest(
        fetch,
        url,
        get({ [name]: `Bearer ${SECRET_ACCESS}` }),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GitHubUrlRefusedError);
      expect(errorText(error)).not.toContain(SECRET_ACCESS);
    }
    expect(calls).toHaveLength(0);
  });

  test('refuses a disallowed URL before any fetch', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, {}));
    await expect(sendGitHubRequest(fetch, 'https://evil.example/', get({}))).rejects.toBeInstanceOf(
      GitHubUrlRefusedError,
    );
    expect(calls).toHaveLength(0);
  });

  test('a fetch failure is a GitHubNetworkError without the cause', async () => {
    const error = await sendGitHubRequest(
      () => Promise.reject(new Error(`failed with ${SECRET_ACCESS}`)),
      'https://api.github.com/user',
      get(apiHeaders(SECRET_ACCESS)),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubNetworkError);
    expect(errorText(error)).not.toContain(SECRET_ACCESS);
  });
});

describe('defaultGitHubFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('delegates to the global fetch', async () => {
    const global = vi.fn(() => Promise.resolve(jsonResponse(204, '')));
    vi.stubGlobal('fetch', global);
    const response = await defaultGitHubFetch('https://api.github.com/', {
      method: 'GET',
      headers: {},
      redirect: 'error',
    });
    expect(response.status).toBe(204);
    expect(global).toHaveBeenCalledOnce();
  });
});

describe('readJsonBody', () => {
  test('parses JSON and returns undefined for anything else', async () => {
    expect(await readJsonBody(jsonResponse(200, { a: 1 }), 1000)).toEqual({ a: 1 });
    expect(await readJsonBody(jsonResponse(200, '<html>'), 1000)).toBeUndefined();
  });

  test('a body over the limit is a request error with the status only', async () => {
    const error = await readJsonBody(jsonResponse(200, 'x'.repeat(100)), 10).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitHubRequestError);
    expect((error as GitHubRequestError).status).toBe(200);
  });

  test('a body that cannot be read is a network error', async () => {
    const response: GitHubResponseLike = {
      ...jsonResponse(200, ''),
      text: () => Promise.reject(new Error('reset')),
    };
    await expect(readJsonBody(response, 10)).rejects.toBeInstanceOf(GitHubNetworkError);
  });
});

describe('discardBody', () => {
  test('cancels a streamed body, ignores a missing one and swallows a failing cancel', async () => {
    const streamed = streamResponse(200, new Uint8Array(10));
    discardBody(streamed);
    await Promise.resolve();
    expect(streamed.cancelled()).toBe(true);
    expect(() => {
      discardBody(jsonResponse(200, ''));
    }).not.toThrow();
    const failing: GitHubResponseLike = {
      ...jsonResponse(200, ''),
      body: {
        getReader: () => ({
          read: () => Promise.resolve({ done: true }),
          cancel: () => Promise.reject(new Error('already closed')),
        }),
      },
    };
    expect(() => {
      discardBody(failing);
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('failureFor', () => {
  const now = () => 1_000_000;

  test('401 is not connected', () => {
    expect(failureFor(jsonResponse(401, ''), now)).toBeInstanceOf(GitHubNotConnectedError);
  });

  test('429 is always rate limited; Retry-After wins over X-RateLimit-Reset', () => {
    const plain = failureFor(jsonResponse(429, ''), now);
    expect(plain).toBeInstanceOf(GitHubRateLimitedError);
    expect((plain as GitHubRateLimitedError).resetAt).toBeUndefined();
    const retry = failureFor(
      jsonResponse(429, '', { 'retry-after': '60', 'x-ratelimit-reset': '1700000000' }),
      now,
    );
    expect((retry as GitHubRateLimitedError).resetAt).toBe(1_000_000 + 60_000);
  });

  test('403 is rate limited only with the rate-limit headers', () => {
    const reset = failureFor(
      jsonResponse(403, '', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
      now,
    );
    expect(reset).toBeInstanceOf(GitHubRateLimitedError);
    expect((reset as GitHubRateLimitedError).resetAt).toBe(1_700_000_000_000);
    const retry = failureFor(jsonResponse(403, '', { 'retry-after': 'soon' }), now);
    expect(retry).toBeInstanceOf(GitHubRateLimitedError);
    expect((retry as GitHubRateLimitedError).resetAt).toBeUndefined();
    const badReset = failureFor(
      jsonResponse(403, '', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'later' }),
      now,
    );
    expect((badReset as GitHubRateLimitedError).resetAt).toBeUndefined();
    const forbidden = failureFor(jsonResponse(403, '', { 'x-ratelimit-remaining': '12' }), now);
    expect(forbidden).toBeInstanceOf(GitHubRequestError);
    expect((forbidden as GitHubRequestError).status).toBe(403);
  });

  test('anything else carries the status only', () => {
    const error = failureFor(jsonResponse(500, SECRET_ACCESS), now);
    expect(error).toBeInstanceOf(GitHubRequestError);
    expect(error.message).toBe('GitHub answered with status 500');
  });
});

describe('apiHeaders', () => {
  test('pins the media type, the API version, the bearer token and the user agent', () => {
    expect(apiHeaders('t')).toEqual({
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2026-03-10',
      authorization: 'Bearer t',
      'user-agent': 'reinvent-compass',
    });
    expect(GITHUB_API_VERSION).toBe('2026-03-10');
  });
});
