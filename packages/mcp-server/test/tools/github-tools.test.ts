import { describe, expect, test } from 'vitest';
import { mcpTools } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import {
  chooseRepositories,
  confirmationMessage,
  connectGithub,
  DEFAULT_MAX_REPOSITORIES,
  disconnectGithub,
  GITHUB_BUDGET_MS,
  MAX_OWNER_LENGTH,
  MAX_OWNERS,
  MAX_REPOSITORIES,
  NAMED_IN_CONFIRMATION,
  REVOKE_NOTE,
  scanGithub,
} from '../../src/tools/github.js';
import { sourceId } from '../../src/state/tech-profile.js';
import { contextFor } from '../support/context.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { FakeGitHub, repo, repoScan } from '../support/fake-github.js';

function arrange(options: { elicit?: 'accept' | 'decline' | 'none'; simulated?: boolean } = {}) {
  const fake = createFakeRuntime({ mode: options.simulated === true ? 'simulated' : 'live' });
  const github = new FakeGitHub();
  if (options.simulated !== true) {
    fake.runtime.github = github;
  }
  const questions: string[] = [];
  const answer = options.elicit ?? 'accept';
  const ctx = contextFor(fake, {
    ...(answer === 'none'
      ? {}
      : {
          elicit: (question) => {
            questions.push(question.message);
            return Promise.resolve(answer);
          },
        }),
  });
  return { fake, github, ctx, questions };
}

describe('connect_github', () => {
  test('simulated mode makes no request and says so', async () => {
    const { ctx } = arrange({ simulated: true });
    const outcome = await connectGithub({}, ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { state: 'notConfigured' } });
    expect(outcome.ok && outcome.text).toContain('not used in simulated mode');
  });

  test('starts the device sign-in and shows the code, the page and the install link', async () => {
    const { github, ctx } = arrange();
    const outcome = await connectGithub({}, ctx);
    expect(github.connects).toBe(1);
    expect(outcome.ok && mcpTools.connect_github.output.parse(outcome.structured)).toEqual({
      state: 'waiting',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
    });
    expect(outcome.ok && outcome.text).toContain(
      'Open https://github.com/login/device and enter the code WDJB-MJHT',
    );
    expect(outcome.ok && outcome.text).toContain(
      'https://github.com/apps/compass-test/installations/new',
    );
  });

  test('a waiting or connected sign-in is reported, not restarted', async () => {
    const { github, ctx } = arrange();
    github.connection = { state: 'connected' };
    let outcome = await connectGithub({}, ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { state: 'connected' } });
    expect(outcome.ok && outcome.text).toContain('Connected to GitHub, read-only.');
    github.installUrl = undefined;
    outcome = await connectGithub({}, ctx);
    expect(outcome.ok && outcome.text).not.toContain('install it');
    github.connection = github.afterConnect;
    outcome = await connectGithub({}, ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { state: 'waiting' } });
    expect(github.connects).toBe(0);
  });

  test('a build without the app says it is not set up', async () => {
    const { github, ctx } = arrange();
    github.connection = { state: 'notConfigured' };
    const outcome = await connectGithub({}, ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { state: 'notConfigured' } });
    expect(outcome.ok && outcome.text).toContain('not set up in this build');
  });

  test.each([
    ['denied', 'cancelled'],
    ['expired', 'expired'],
    ['error', 'could not finish'],
  ] as const)(
    'a %s sign-in starts again on the next call and reports what happened',
    async (reason, words) => {
      const { github, ctx } = arrange();
      github.connection = { state: 'failed', reason };
      github.afterConnect = { state: 'failed', reason };
      const outcome = await connectGithub({}, ctx);
      expect(github.connects).toBe(1);
      expect(outcome).toMatchObject({ ok: true, structured: { state: 'failed' } });
      expect(outcome.ok && outcome.text).toContain(words);
    },
  );

  test('a sign-in that ends disconnected is reported as failed', async () => {
    const { github, ctx } = arrange();
    github.afterConnect = { state: 'disconnected' };
    const outcome = await connectGithub({}, ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { state: 'failed' } });
    expect(outcome.ok && outcome.text).toContain('Run connect_github to connect.');
  });
});

describe('disconnect_github', () => {
  test('deletes the sign-in and says where to remove the app on GitHub', async () => {
    const { github, ctx } = arrange();
    const outcome = await disconnectGithub({}, ctx);
    expect(github.disconnects).toBe(1);
    expect(outcome).toMatchObject({ ok: true, structured: { disconnected: true } });
    expect(outcome.ok && outcome.text).toContain(REVOKE_NOTE);
  });

  test('simulated mode has nothing to delete', async () => {
    const { ctx } = arrange({ simulated: true });
    expect(await disconnectGithub({}, ctx)).toMatchObject({
      ok: true,
      structured: { disconnected: false },
    });
  });
});

describe('choosing repositories', () => {
  const repos = [
    repo('work/api'),
    repo('me/zeta'),
    repo('me/Alpha'),
    repo('me/fork', { fork: true }),
    repo('other/x'),
  ];

  test('forks are left out, owners narrow the list, names are sorted and the limit applies', () => {
    expect(chooseRepositories(repos, {}, 10).chosen.map((r) => r.fullName)).toEqual([
      'me/Alpha',
      'me/zeta',
      'other/x',
      'work/api',
    ]);
    expect(
      chooseRepositories(repos, { owners: ['ME'], includeForks: true }, 10).chosen.map(
        (r) => r.fullName,
      ),
    ).toEqual(['me/Alpha', 'me/fork', 'me/zeta']);
    expect(chooseRepositories(repos, {}, 2)).toMatchObject({ overLimit: 2 });
  });

  test('the confirmation names the accounts and at most NAMED_IN_CONFIRMATION repositories', () => {
    const many = Array.from({ length: NAMED_IN_CONFIRMATION + 3 }, (_, i) =>
      repo(`me/r${String(i).padStart(2, '0')}`),
    );
    const message = confirmationMessage([...many, repo('work/api')]);
    expect(message).toContain(
      `read ${String(NAMED_IN_CONFIRMATION + 4)} GitHub repositories from me, work, read-only`,
    );
    expect(message).toContain('and 4 more.');
    expect(confirmationMessage([repo('me/a')])).toContain('Repositories: me/a.');
  });
});

describe('scan_github', () => {
  test('refuses a bad limit or too many owners before anything else', async () => {
    const { ctx, github } = arrange();
    github.connection = { state: 'connected' };
    for (const maxRepositories of [0, MAX_REPOSITORIES + 1, 1.5]) {
      await expect(scanGithub({ maxRepositories }, ctx)).rejects.toMatchObject({
        code: 'LimitInvalid',
      });
    }
    await expect(
      scanGithub({ owners: Array.from({ length: MAX_OWNERS + 1 }, () => 'me') }, ctx),
    ).rejects.toMatchObject({ code: 'InputTooLarge' });
    await expect(
      scanGithub({ owners: ['x'.repeat(MAX_OWNER_LENGTH + 1)] }, ctx),
    ).rejects.toMatchObject({ code: 'InputTooLarge' });
    expect(github.scanned).toEqual([]);
  });

  test('simulated mode and a missing connection read nothing', async () => {
    let outcome = await scanGithub({}, arrange({ simulated: true }).ctx);
    expect(outcome).toMatchObject({ ok: true, structured: { scanned: 0 } });
    const { ctx, github } = arrange();
    outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.text).toContain('Run connect_github to connect.');
    github.connection = github.afterConnect;
    outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.text).toContain('enter the code WDJB-MJHT');
    expect(github.scanned).toEqual([]);
  });

  test('no readable repository points to the install page', async () => {
    const { ctx, github } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [repo('me/fork', { fork: true })];
    const outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.text).toContain('cannot read any repository');
    expect(outcome.ok && outcome.text).toContain('installations/new');
  });

  test('a client that cannot ask is refused, and a decline reads nothing', async () => {
    const refused = arrange({ elicit: 'none' });
    refused.github.connection = { state: 'connected' };
    refused.github.repositories = [repo('me/a')];
    await expect(scanGithub({}, refused.ctx)).rejects.toEqual(
      new CompassError('GitHubConfirmationNeeded'),
    );
    const declined = arrange({ elicit: 'decline' });
    declined.github.connection = { state: 'connected' };
    declined.github.repositories = [repo('me/a')];
    const outcome = await scanGithub({}, declined.ctx);
    expect(outcome.ok && outcome.text).toContain('Nothing was read');
    expect(declined.github.scanned).toEqual([]);
    expect(declined.fake.techProfile.sources).toEqual([]);
  });

  test('after the human confirms, each repository is read and added to the profile by a hashed id', async () => {
    const { ctx, github, fake, questions } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [
      repo('me/b'),
      repo('me/a'),
      repo('me/c'),
      repo('me/fork', { fork: true }),
    ];
    github.scans.set('me/b', repoScan('python', 'lambda'));
    github.scans.set('me/c', new Error('archive too big'));
    const outcome = await scanGithub({}, ctx);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('me/a, me/b, me/c');
    expect(github.scanned).toEqual(['me/a', 'me/b', 'me/c']);
    const parsed = outcome.ok ? mcpTools.scan_github.output.parse(outcome.structured) : undefined;
    expect(parsed).toMatchObject({ scanned: 2, skipped: 1, services: ['AWS Lambda', 'Amazon S3'] });
    expect([...(parsed?.technologies ?? [])].sort()).toEqual(['.NET', 'Python']);
    expect(outcome.ok && outcome.text).toContain(
      'Read 2 GitHub repositories (skipped: 1 could not be read).',
    );
    expect(fake.techProfile.sources.map((s) => s.id)).toEqual([
      sourceId('github', String(repo('me/a').id)),
      sourceId('github', String(repo('me/b').id)),
    ]);
    expect(JSON.stringify(fake.techProfile.sources)).not.toContain('me/');
    expect(outcome.ok && outcome.text).not.toContain('me/');
  });

  test('the limit and the time budget skip repositories, and nothing found says so', async () => {
    const { ctx, github, fake } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [repo('me/a'), repo('me/b'), repo('me/c'), repo('me/d')];
    github.scans.set('me/a', { ...repoScan(), services: [], technologies: [] });
    github.onScan = () => {
      fake.clock.set(new Date(fake.clock.now().getTime() + GITHUB_BUDGET_MS + 1).toISOString());
    };
    const outcome = await scanGithub({ maxRepositories: 3 }, ctx);
    expect(github.scanned).toEqual(['me/a']);
    expect(outcome.ok && outcome.structured).toMatchObject({ scanned: 1, skipped: 3 });
    expect(outcome.ok && outcome.text).toContain(
      'skipped: 1 over the limit of 3, 2 not started in time',
    );
    expect(outcome.ok && outcome.text).toContain('AWS services: none found.');
    expect(outcome.ok && outcome.text).toContain('Other technology: none found.');
  });

  test('when every repository is read the reply lists no skips', async () => {
    const { ctx, github } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [repo('me/a')];
    const outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.text).toContain('Read 1 GitHub repositories.');
  });

  test('a repository list with nothing readable writes no profile entry', async () => {
    const { ctx, github, fake } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [repo('me/a')];
    github.scans.set('me/a', new Error('gone'));
    const outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ scanned: 0, skipped: 1 });
    expect(fake.techProfile.sources).toEqual([]);
  });

  test('a lost connection stops the scan with its fixed message', async () => {
    const { ctx, github } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = [repo('me/a'), repo('me/b')];
    github.scans.set('me/a', new CompassError('GitHubNotConnected'));
    await expect(scanGithub({}, ctx)).rejects.toMatchObject({ code: 'GitHubNotConnected' });
    expect(github.scanned).toEqual(['me/a']);
  });

  test('the default limit is DEFAULT_MAX_REPOSITORIES', async () => {
    const { ctx, github } = arrange();
    github.connection = { state: 'connected' };
    github.repositories = Array.from({ length: DEFAULT_MAX_REPOSITORIES + 1 }, (_, i) =>
      repo(`me/r${String(i).padStart(3, '0')}`, { id: i + 1 }),
    );
    const outcome = await scanGithub({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({
      scanned: DEFAULT_MAX_REPOSITORIES,
      skipped: 1,
    });
  });
});
