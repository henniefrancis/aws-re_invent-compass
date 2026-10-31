import { describe, expect, test } from 'vitest';
import {
  MAX_LISTED_REPOSITORIES,
  MAX_LISTING_PAGES,
  createGitHubClient,
  isRepositoryFullName,
} from '../../src/github/client.js';
import {
  GitHubNotConnectedError,
  GitHubRateLimitedError,
  GitHubRequestError,
} from '../../src/github/errors.js';
import type { GitHubFetchInit, GitHubResponseLike } from '../../src/github/http.js';
import { SECRET_ACCESS, errorText, fakeFetch, jsonResponse } from './support.js';

function repo(
  id: number,
  fullName = `octo/repo-${String(id)}`,
  extra: Record<string, unknown> = {},
) {
  const [login = ''] = fullName.split('/');
  return {
    id,
    node_id: 'R_x',
    name: fullName.split('/')[1],
    full_name: fullName,
    owner: { login, type: 'User', avatar_url: 'https://x' },
    private: false,
    fork: false,
    archived: false,
    size: 10,
    permissions: { pull: true },
    ...extra,
  };
}

function route(
  handler: (path: string, page: number) => GitHubResponseLike,
): ReturnType<typeof fakeFetch> {
  return fakeFetch((url) => {
    const parsed = new URL(url);
    return handler(parsed.pathname, Number(parsed.searchParams.get('page')));
  });
}

function client(fetch: ReturnType<typeof fakeFetch>['fetch']) {
  return createGitHubClient({ fetch, accessToken: () => Promise.resolve(SECRET_ACCESS) });
}

describe('isRepositoryFullName', () => {
  test.each(['octo/hello', 'a/b', 'Octo-Org/my.repo_name-2', `${'a'.repeat(39)}/x`])(
    'accepts %s',
    (name) => {
      expect(isRepositoryFullName(name)).toBe(true);
    },
  );
  test.each([
    'octo',
    'octo/',
    '/hello',
    'octo/hello/extra',
    'octo/..',
    'octo/.',
    '../hello',
    '-octo/hello',
    `${'a'.repeat(40)}/x`,
    'octo/he llo',
    'octo/he%2Fllo',
    'octo/hello?x=1',
  ])('refuses %s', (name) => {
    expect(isRepositoryFullName(name)).toBe(false);
  });
});

describe('createGitHubClient.listRepositories', () => {
  test('pages installations and their repositories with the pinned headers, de-duplicating by id', async () => {
    const { fetch, calls } = route((path, page) => {
      if (path === '/user/installations') {
        return page === 1
          ? jsonResponse(200, {
              total_count: 3,
              installations: [{ id: 11, account: {} }, { id: 22 }],
            })
          : jsonResponse(200, { total_count: 3, installations: [{ id: 'bad' }, { id: 11 }] });
      }
      if (path === '/user/installations/11/repositories') {
        return page === 1
          ? jsonResponse(200, { total_count: 3, repositories: [repo(1), repo(2)] })
          : jsonResponse(200, { total_count: 3, repositories: [repo(3, 'my-org/svc')] });
      }
      return jsonResponse(200, {
        total_count: 4,
        repositories: [
          repo(2),
          repo(4, '../escape'),
          { id: 5 },
          repo(6, 'my-org/forked', {
            fork: true,
            archived: true,
            private: true,
            size: 2048,
            owner: { login: 'my-org', type: 'Organization' },
          }),
        ],
      });
    });
    const repositories = await client(fetch).listRepositories();
    expect(repositories).toEqual([
      {
        id: 1,
        fullName: 'octo/repo-1',
        owner: 'octo',
        ownerType: 'User',
        private: false,
        fork: false,
        archived: false,
        sizeKb: 10,
      },
      {
        id: 2,
        fullName: 'octo/repo-2',
        owner: 'octo',
        ownerType: 'User',
        private: false,
        fork: false,
        archived: false,
        sizeKb: 10,
      },
      {
        id: 3,
        fullName: 'my-org/svc',
        owner: 'my-org',
        ownerType: 'User',
        private: false,
        fork: false,
        archived: false,
        sizeKb: 10,
      },
      {
        id: 6,
        fullName: 'my-org/forked',
        owner: 'my-org',
        ownerType: 'Organization',
        private: true,
        fork: true,
        archived: true,
        sizeKb: 2048,
      },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/user/installations?per_page=100&page=1',
      'https://api.github.com/user/installations?per_page=100&page=2',
      'https://api.github.com/user/installations/11/repositories?per_page=100&page=1',
      'https://api.github.com/user/installations/11/repositories?per_page=100&page=2',
      'https://api.github.com/user/installations/22/repositories?per_page=100&page=1',
    ]);
    for (const call of calls) {
      expect(call.init).toMatchObject<Partial<GitHubFetchInit>>({
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2026-03-10',
          authorization: `Bearer ${SECRET_ACCESS}`,
          'user-agent': 'reinvent-compass',
        },
      });
      expect(call.url).not.toContain(SECRET_ACCESS);
    }
  });

  test('stops paging on an empty page', async () => {
    const { fetch, calls } = route((path) =>
      path === '/user/installations'
        ? jsonResponse(200, { total_count: 5, installations: [] })
        : jsonResponse(200, { total_count: 5, repositories: [] }),
    );
    expect(await client(fetch).listRepositories()).toEqual([]);
    expect(calls).toHaveLength(1);

    const second = route((path) =>
      path === '/user/installations'
        ? jsonResponse(200, { total_count: 1, installations: [{ id: 1 }] })
        : jsonResponse(200, { total_count: 5, repositories: [] }),
    );
    expect(await client(second.fetch).listRepositories()).toEqual([]);
    expect(second.calls).toHaveLength(2);
  });

  test('stops at 2,000 repositories, even in the middle of a page', async () => {
    const { fetch, calls } = route((path, page) => {
      if (path === '/user/installations') {
        return jsonResponse(200, { total_count: 1, installations: [{ id: 1 }] });
      }
      const start = (page - 1) * 300;
      return jsonResponse(200, {
        total_count: 100_000,
        repositories: Array.from({ length: 300 }, (_, i) => repo(start + i + 1)),
      });
    });
    const repositories = await client(fetch).listRepositories();
    expect(repositories).toHaveLength(MAX_LISTED_REPOSITORIES);
    expect(MAX_LISTED_REPOSITORIES).toBe(2000);
    expect(calls).toHaveLength(1 + 7);
  });

  test('stops at 50 pages in all', async () => {
    const { fetch, calls } = route((path, page) =>
      path === '/user/installations'
        ? jsonResponse(200, { total_count: 1, installations: [{ id: 1 }] })
        : jsonResponse(200, { total_count: 100_000, repositories: [repo(page)] }),
    );
    expect(await client(fetch).listRepositories()).toHaveLength(MAX_LISTING_PAGES - 1);
    expect(calls).toHaveLength(MAX_LISTING_PAGES);

    const many = route((_path, page) =>
      jsonResponse(200, { total_count: 100_000, installations: [{ id: page }] }),
    );
    expect(await client(many.fetch).listRepositories()).toEqual([]);
    expect(many.calls).toHaveLength(MAX_LISTING_PAGES);
  });

  test('a 401 is not connected, a rate limit carries the reset, anything else the status', async () => {
    const failing = async (response: GitHubResponseLike): Promise<unknown> => {
      const { fetch } = fakeFetch(() => response);
      const error = await client(fetch)
        .listRepositories()
        .catch((e: unknown) => e);
      expect(errorText(error)).not.toContain(SECRET_ACCESS);
      return error;
    };
    expect(await failing(jsonResponse(401, { message: 'Bad credentials' }))).toBeInstanceOf(
      GitHubNotConnectedError,
    );
    const limited = await failing(
      jsonResponse(403, '', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
    );
    expect(limited).toBeInstanceOf(GitHubRateLimitedError);
    expect((limited as GitHubRateLimitedError).resetAt).toBe(1_700_000_000_000);
    const retry = await failing(jsonResponse(429, '', { 'retry-after': '1' }));
    expect((retry as GitHubRateLimitedError).resetAt).toBeGreaterThan(Date.now() - 10_000);
    const server = await failing(jsonResponse(500, SECRET_ACCESS));
    expect(server).toBeInstanceOf(GitHubRequestError);
    expect((server as GitHubRequestError).status).toBe(500);
    const shape = await failing(jsonResponse(200, { installations: 'nope' }));
    expect(shape).toBeInstanceOf(GitHubRequestError);
    expect((shape as GitHubRequestError).status).toBe(200);
  });

  test('asks for the token on every request and uses the injected clock', async () => {
    let asked = 0;
    const { fetch } = fakeFetch(() => jsonResponse(429, '', { 'retry-after': '2' }));
    const listing = createGitHubClient({
      fetch,
      accessToken: () => {
        asked += 1;
        return Promise.resolve('t');
      },
      now: () => 10,
    });
    const error = await listing.listRepositories().catch((e: unknown) => e);
    expect((error as GitHubRateLimitedError).resetAt).toBe(2010);
    expect(asked).toBe(1);
  });
});
