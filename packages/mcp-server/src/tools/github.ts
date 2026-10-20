// connect_github, scan_github and disconnect_github (compass-power task 45, Requirements P2.8 to
// P2.10). Compass reads GitHub only through a GitHub App that has Contents: read and Metadata: read
// and nothing else, so its token can never change a repository. The attendee picks which accounts,
// organisations and repositories the app may read when they install it on GitHub, and scan_github
// reads nothing until they confirm the list it is about to read. Each repository becomes a `github`
// project in the Tech_Profile; no repository name, path or content is kept. Simulated mode has no
// GitHub port, so these tools say so and make no request.

import type { McpToolInput, McpToolOutput } from '@compass/contracts';
import { CompassError } from '../ports/errors.js';
import type { GitHubConnection, GitHubPort, GitHubRepositoryRef } from '../ports/github-port.js';
import { mergeProfile, sourceFromScan } from '../state/tech-profile.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import { serviceName, techName } from './show-my-tech.js';

/** The default and the largest number of repositories one scan reads. */
export const DEFAULT_MAX_REPOSITORIES = 50;
export const MAX_REPOSITORIES = 200;

/** The most owners a scan can be narrowed to, and the longest owner name. */
export const MAX_OWNERS = 20;
export const MAX_OWNER_LENGTH = 100;

/** How many repositories the confirmation message names. */
export const NAMED_IN_CONFIRMATION = 20;

/** No new repository is started after this many milliseconds. */
export const GITHUB_BUDGET_MS = 300_000;

/** Where the attendee removes the app and its authorisation on GitHub. */
export const REVOKE_NOTE =
  'To remove the app from GitHub as well, uninstall it at https://github.com/settings/installations and revoke it at https://github.com/settings/apps/authorizations.';

const SIMULATED_NOTE = 'GitHub is not used in simulated mode, so nothing was sent.';
const NOT_SET_UP_NOTE =
  'GitHub scanning is not set up in this build of Compass, so nothing was sent. You can still scan local folders with scan_repo.';

function installLine(github: GitHubPort): string {
  return github.installUrl === undefined
    ? ''
    : ` If you have not installed the Compass GitHub App yet, install it on the accounts and organisations Compass may read: ${github.installUrl}`;
}

function connectionText(github: GitHubPort, connection: GitHubConnection): string {
  switch (connection.state) {
    case 'notConfigured':
      return NOT_SET_UP_NOTE;
    case 'connected':
      return `Connected to GitHub, read-only. Run scan_github to add your repositories to your tech list.${installLine(github)}`;
    case 'waiting':
      return `Open ${connection.verificationUri} and enter the code ${connection.userCode} (Compass tried to open the page for you). The code works until ${connection.expiresAt}. Then run scan_github.${installLine(github)}`;
    case 'disconnected':
      return 'Compass is not connected to GitHub. Run connect_github to connect.';
    case 'failed':
      return connection.reason === 'denied'
        ? 'GitHub says the sign-in was cancelled, so Compass is not connected. Run connect_github to try again.'
        : connection.reason === 'expired'
          ? 'The GitHub code expired before it was entered. Run connect_github for a new one.'
          : 'Compass could not finish connecting to GitHub. Run connect_github to try again.';
  }
}

function structuredConnection(connection: GitHubConnection): McpToolOutput<'connect_github'> {
  switch (connection.state) {
    case 'waiting':
      return {
        state: 'waiting',
        userCode: connection.userCode,
        verificationUri: connection.verificationUri,
      };
    case 'connected':
      return { state: 'connected' };
    case 'notConfigured':
      return { state: 'notConfigured' };
    case 'disconnected':
    case 'failed':
      return { state: 'failed' };
  }
}

/** connect_github. */
export async function connectGithub(
  _input: McpToolInput<'connect_github'>,
  ctx: ToolContext,
): Promise<ToolOutcome<'connect_github'>> {
  const { github } = ctx.runtime;
  if (github === undefined) {
    return { ok: true, structured: { state: 'notConfigured' }, text: SIMULATED_NOTE };
  }
  const current = github.status();
  const connection =
    current.state === 'disconnected' || current.state === 'failed'
      ? await github.connect()
      : current;
  return {
    ok: true,
    structured: structuredConnection(connection),
    text: connectionText(github, connection),
  };
}

/** disconnect_github. */
export function disconnectGithub(
  _input: McpToolInput<'disconnect_github'>,
  ctx: ToolContext,
): Promise<ToolOutcome<'disconnect_github'>> {
  const { github } = ctx.runtime;
  if (github === undefined) {
    return Promise.resolve({ ok: true, structured: { disconnected: false }, text: SIMULATED_NOTE });
  }
  github.disconnect();
  return Promise.resolve({
    ok: true,
    structured: { disconnected: true },
    text: `Compass deleted its GitHub sign-in on this machine. Your tech list keeps what was already scanned; forget_me deletes it. ${REVOKE_NOTE}`,
  });
}

/** scan_github input. */
export interface ScanGithubInput {
  owners?: string[] | undefined;
  includeForks?: boolean | undefined;
  maxRepositories?: number | undefined;
}

function validate(input: ScanGithubInput): number {
  const max = input.maxRepositories ?? DEFAULT_MAX_REPOSITORIES;
  if (!Number.isInteger(max) || max < 1 || max > MAX_REPOSITORIES) {
    throw new CompassError('LimitInvalid');
  }
  const owners = input.owners ?? [];
  if (owners.length > MAX_OWNERS || owners.some((owner) => owner.length > MAX_OWNER_LENGTH)) {
    throw new CompassError('InputTooLarge');
  }
  return max;
}

/** The repositories to read: forks only when asked, only the named owners, in name order. */
export function chooseRepositories(
  repositories: readonly GitHubRepositoryRef[],
  input: ScanGithubInput,
  max: number,
): { chosen: GitHubRepositoryRef[]; overLimit: number } {
  const owners = new Set((input.owners ?? []).map((owner) => owner.toLowerCase()));
  const wanted = repositories
    .filter((repo) => input.includeForks === true || !repo.fork)
    .filter((repo) => owners.size === 0 || owners.has(repo.owner.toLowerCase()))
    .sort((a, b) => (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1));
  return { chosen: wanted.slice(0, max), overLimit: Math.max(0, wanted.length - max) };
}

/** The confirmation message: the accounts and up to NAMED_IN_CONFIRMATION repositories. */
export function confirmationMessage(chosen: readonly GitHubRepositoryRef[]): string {
  const owners = [...new Set(chosen.map((repo) => repo.owner))].sort();
  const named = chosen.slice(0, NAMED_IN_CONFIRMATION).map((repo) => repo.fullName);
  const more = chosen.length - named.length;
  return [
    `Compass will read ${String(chosen.length)} GitHub repositories from ${owners.join(', ')}, read-only, to list the AWS services and other technology in them.`,
    `Repositories: ${named.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}.`,
    'Each one is read in memory on this machine and never saved; only technology names and counts are kept. Go ahead?',
  ].join('\n');
}

/** scan_github. */
export async function scanGithub(
  input: ScanGithubInput,
  ctx: ToolContext,
): Promise<ToolOutcome<'scan_github'>> {
  const max = validate(input);
  const nothing = { scanned: 0, skipped: 0, services: [], technologies: [] };
  const { github, clock, techProfile } = ctx.runtime;
  if (github === undefined) {
    return { ok: true, structured: nothing, text: SIMULATED_NOTE };
  }
  const connection = github.status();
  if (connection.state !== 'connected') {
    return { ok: true, structured: nothing, text: connectionText(github, connection) };
  }
  const { chosen, overLimit } = chooseRepositories(await github.listRepositories(), input, max);
  if (chosen.length === 0) {
    return {
      ok: true,
      structured: nothing,
      text: `The Compass GitHub App cannot read any repository that fits.${installLine(github)}`,
    };
  }
  if (ctx.elicit === undefined) {
    throw new CompassError('GitHubConfirmationNeeded');
  }
  if ((await ctx.elicit({ message: confirmationMessage(chosen) })) !== 'accept') {
    return {
      ok: true,
      structured: nothing,
      text: 'Nothing was read, because you did not confirm the repositories.',
    };
  }

  const started = clock.now().getTime();
  const sources = [];
  let failed = 0;
  let outOfTime = 0;
  for (const repo of chosen) {
    if (clock.now().getTime() - started > GITHUB_BUDGET_MS) {
      outOfTime += 1;
    } else {
      try {
        const result = await github.scanRepository(repo);
        sources.push(sourceFromScan('github', String(repo.id), result, clock.now().toISOString()));
      } catch (error) {
        if (error instanceof CompassError && error.code === 'GitHubNotConnected') {
          throw error;
        }
        failed += 1;
      }
    }
  }
  const scanned = mergeProfile(sources);
  if (sources.length > 0) {
    await techProfile.add(sources);
  }
  const structured = {
    scanned: sources.length,
    skipped: failed + outOfTime + overLimit,
    services: scanned.services.map((s) => serviceName(s.key)),
    technologies: scanned.technologies.map((t) => techName(t.key).name),
  };
  const skippedParts = [
    overLimit > 0 ? `${String(overLimit)} over the limit of ${String(max)}` : '',
    outOfTime > 0 ? `${String(outOfTime)} not started in time` : '',
    failed > 0 ? `${String(failed)} could not be read` : '',
  ].filter((part) => part.length > 0);
  const lines = [
    `Read ${String(sources.length)} GitHub repositories${skippedParts.length > 0 ? ` (skipped: ${skippedParts.join(', ')})` : ''}.`,
    `AWS services: ${structured.services.length > 0 ? structured.services.join(', ') : 'none found'}.`,
    `Other technology: ${structured.technologies.length > 0 ? structured.technologies.join(', ') : 'none found'}.`,
    'Added to your tech list on this machine. Ask show_my_tech for all of it, or find_sessions_by_tech for sessions.',
  ];
  return { ok: true, structured, text: lines.join('\n') };
}
