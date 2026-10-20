// The GitHub listing client (compass-power task 45.1, Requirement P2.8).
//
// Lists the repositories the GitHub App may read for the signed-in attendee: GET
// /user/installations, then GET /user/installations/{id}/repositories for each installation,
// both paged at 100 per page (GitHub "REST API endpoints for GitHub App installations", checked
// 20 October 2026). Paging stops at `total_count`, an empty page, 2,000 repositories or 50 pages
// in all, whichever comes first. Repositories are de-duplicated by id and validated with zod,
// keeping only the fields Compass needs; an entry that does not validate is left out.
//
// Every request goes through `sendGitHubRequest`, so only the fixed GitHub hosts are reached and
// the token goes only to api.github.com. A 401 throws GitHubNotConnectedError, a rate-limited
// 403 or 429 GitHubRateLimitedError, anything else GitHubRequestError with the status only.

import { z } from 'zod';
import { MAX_API_BODY_BYTES } from '../api/capped-body.js';
import { GitHubRequestError } from './errors.js';
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  apiHeaders,
  failureFor,
  readJsonBody,
  sendGitHubRequest,
  type GitHubFetch,
} from './http.js';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
/** Repositories and installations asked for per page (the API maximum). */
export const GITHUB_PAGE_SIZE = 100;
/** The most repositories one listing returns. */
export const MAX_LISTED_REPOSITORIES = 2000;
/** The most pages one listing requests, installations and repositories together. */
export const MAX_LISTING_PAGES = 50;

/** The account type of a repository owner: `User` or `Organization` (or a future GitHub type). */
export type GitHubOwnerType = 'User' | 'Organization' | (string & Record<never, never>);

/** One repository the GitHub App may read. */
export interface GitHubRepository {
  id: number;
  /** `owner/name`. */
  fullName: string;
  owner: string;
  ownerType: GitHubOwnerType;
  private: boolean;
  fork: boolean;
  archived: boolean;
  /** The size GitHub reports, in kilobytes. */
  sizeKb: number;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** True when `fullName` is a well-formed `owner/name` that is safe to put in an API path. */
export function isRepositoryFullName(fullName: string): boolean {
  const [owner = '', name = '', ...rest] = fullName.split('/');
  return (
    rest.length === 0 &&
    OWNER_PATTERN.test(owner) &&
    NAME_PATTERN.test(name) &&
    name !== '.' &&
    name !== '..'
  );
}

const InstallationsPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(z.unknown()),
});
const InstallationSchema = z.object({ id: z.number().int().positive() });

const RepositoriesPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(z.unknown()),
});
const RepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().refine(isRepositoryFullName),
  owner: z.object({
    login: z.string().regex(OWNER_PATTERN),
    type: z.string().min(1).max(40),
  }),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean(),
  size: z.number().int().nonnegative(),
});

/** What `createGitHubClient` needs. */
export interface GitHubClientOptions {
  fetch: GitHubFetch;
  /** The access token to use for each request (for example `getAccessToken` bound to a store). */
  accessToken: () => Promise<string>;
  /** The clock for a rate-limit reset given as Retry-After (default `Date.now`). */
  now?: () => number;
}

/** The GitHub listing client. */
export interface GitHubClient {
  /** Every repository the GitHub App may read for the attendee, de-duplicated, capped at 2,000. */
  listRepositories(): Promise<GitHubRepository[]>;
}

/** Create the listing client. */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const now = options.now ?? Date.now;

  /** GET one API page and parse it with `schema`; a body that does not fit is a GitHubRequestError. */
  async function getPage<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const token = await options.accessToken();
    const response = await sendGitHubRequest(options.fetch, `${GITHUB_API_ORIGIN}${path}`, {
      method: 'GET',
      headers: apiHeaders(token),
      redirect: 'error',
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      throw failureFor(response, now);
    }
    const parsed = schema.safeParse(await readJsonBody(response, MAX_API_BODY_BYTES));
    if (!parsed.success) {
      throw new GitHubRequestError(response.status);
    }
    return parsed.data;
  }

  return {
    async listRepositories() {
      let pages = 0;
      const installationIds = new Set<number>();
      for (let page = 1, seen = 0; pages < MAX_LISTING_PAGES; page += 1) {
        pages += 1;
        const body = await getPage(
          `/user/installations?per_page=${String(GITHUB_PAGE_SIZE)}&page=${String(page)}`,
          InstallationsPageSchema,
        );
        for (const item of body.installations) {
          const installation = InstallationSchema.safeParse(item);
          if (installation.success) {
            installationIds.add(installation.data.id);
          }
        }
        seen += body.installations.length;
        if (body.installations.length === 0 || seen >= body.total_count) {
          break;
        }
      }

      const repositories = new Map<number, GitHubRepository>();
      for (const id of installationIds) {
        for (let page = 1, seen = 0; ; page += 1) {
          if (pages >= MAX_LISTING_PAGES || repositories.size >= MAX_LISTED_REPOSITORIES) {
            return [...repositories.values()];
          }
          pages += 1;
          const body = await getPage(
            `/user/installations/${String(id)}/repositories?per_page=${String(GITHUB_PAGE_SIZE)}&page=${String(page)}`,
            RepositoriesPageSchema,
          );
          for (const item of body.repositories) {
            const parsed = RepositorySchema.safeParse(item);
            if (parsed.success && repositories.size < MAX_LISTED_REPOSITORIES) {
              const repo = parsed.data;
              repositories.set(repo.id, {
                id: repo.id,
                fullName: repo.full_name,
                owner: repo.owner.login,
                ownerType: repo.owner.type,
                private: repo.private,
                fork: repo.fork,
                archived: repo.archived,
                sizeKb: repo.size,
              });
            }
          }
          seen += body.repositories.length;
          if (body.repositories.length === 0 || seen >= body.total_count) {
            break;
          }
        }
      }
      return [...repositories.values()];
    },
  };
}
