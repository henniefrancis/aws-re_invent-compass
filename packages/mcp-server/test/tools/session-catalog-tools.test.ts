import { describe, expect, test } from 'vitest';
import { mcpTools } from '@compass/contracts';
import { DATA_PREAMBLE } from '../../src/safety/labelled-data.js';
import { connect, textOf } from '../support/connect.js';
import { buildCatalogView, wireSession } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

function catalogOf(count: number) {
  return buildCatalogView(
    Array.from({ length: count }, (_, i) =>
      wireSession(`s${String(i).padStart(3, '0')}`, {
        title: `Session ${i}`,
        abstract: 'SECRET ABSTRACT TEXT',
        services: i % 2 === 0 ? ['compute'] : ['storage'],
        level: i % 3 === 0 ? '200' : '300',
      }),
    ),
  );
}

describe('sign_in and sign_out', () => {
  test('sign_in reports the result and the memory-only notice, never a token', async () => {
    const fake = createFakeRuntime();
    fake.events.signInResult = {
      signedIn: true,
      expiresAt: '2026-12-01T00:00:00.000Z',
      memoryOnlyNotice: 'Your sign-in is held in memory only.',
    };
    const connection = await connect(fake.runtime);
    const result = await connection.call('sign_in', { force: true });
    expect(result.structuredContent).toEqual({
      signedIn: true,
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
    expect(textOf(result)).toContain('This sign-in lasts until 2026-12-01T00:00:00.000Z.');
    expect(textOf(result)).toContain('held in memory only');
    expect(fake.events.callsTo('signIn')[0]?.args).toEqual([true]);
    await connection.close();
  });

  test('sign_in without force passes false and handles an unfinished sign-in', async () => {
    const fake = createFakeRuntime();
    fake.events.signInResult = { signedIn: false };
    const connection = await connect(fake.runtime);
    const result = await connection.call('sign_in');
    expect(result.structuredContent).toEqual({ signedIn: false });
    expect(textOf(result)).toContain('did not finish');
    expect(fake.events.callsTo('signIn')[0]?.args).toEqual([false]);
    await connection.close();
  });

  test('a signed-in result without an expiry has no expiry sentence', async () => {
    const fake = createFakeRuntime();
    fake.events.signInResult = { signedIn: true };
    const connection = await connect(fake.runtime);
    const result = await connection.call('sign_in');
    expect(textOf(result)).not.toContain('lasts until');
    expect(mcpTools.sign_in.output.parse(result.structuredContent)).toEqual({ signedIn: true });
    await connection.close();
  });

  test('sign_out gives the Builder ID sign-out URL', async () => {
    const fake = createFakeRuntime();
    const connection = await connect(fake.runtime);
    const result = await connection.call('sign_out');
    expect(result.structuredContent).toEqual({ signedOut: true });
    expect(textOf(result)).toContain(fake.events.signOutUrl);
    await connection.close();
  });
});

describe('refresh_catalog', () => {
  test('refreshes and resolves the event window', async () => {
    const fake = createFakeRuntime();
    fake.events.refreshResult = { sessionCount: 120, refreshedAt: '2026-11-30T16:00:00.000Z' };
    const connection = await connect(fake.runtime);
    const result = await connection.call('refresh_catalog', { force: true });
    expect(result.structuredContent).toEqual({
      sessionCount: 120,
      refreshedAt: '2026-11-30T16:00:00.000Z',
    });
    expect(textOf(result)).toContain('120 sessions');
    expect(fake.events.callsTo('eventWindow')).toHaveLength(1);
    await connection.close();
  });

  test('asks the attendee to sign in first and does not refresh', async () => {
    const fake = createFakeRuntime();
    fake.events.signedIn = false;
    const connection = await connect(fake.runtime);
    const result = await connection.call('refresh_catalog');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Run sign_in first.');
    expect(fake.events.callsTo('refreshCatalog')).toEqual([]);
    await connection.close();
  });
});

describe('find_sessions', () => {
  test('defaults to 20, reports the total before the limit and labels the text as data', async () => {
    const fake = createFakeRuntime({ catalog: catalogOf(30) });
    const connection = await connect(fake.runtime);
    const result = await connection.call('find_sessions', {});
    const structured = mcpTools.find_sessions.output.parse(result.structuredContent);
    expect(structured.sessions).toHaveLength(20);
    expect(structured.totalMatched).toBe(30);
    const text = textOf(result);
    expect(text).toContain('Showing 20 of 30 matching sessions.');
    expect(text).toContain(DATA_PREAMBLE);
    expect(text).not.toContain('SECRET ABSTRACT');
    expect(JSON.stringify(result)).not.toContain('SECRET ABSTRACT');
    await connection.close();
  });

  test('clamps a large limit to 50 and says so', async () => {
    const fake = createFakeRuntime({ catalog: catalogOf(60) });
    const connection = await connect(fake.runtime);
    const result = await connection.call('find_sessions', { limit: 500 });
    expect(mcpTools.find_sessions.output.parse(result.structuredContent).sessions).toHaveLength(50);
    expect(textOf(result)).toContain('lowered to 50');
    await connection.close();
  });

  test('a limit of zero returns no sessions but still counts the matches', async () => {
    const fake = createFakeRuntime({ catalog: catalogOf(5) });
    const connection = await connect(fake.runtime);
    const result = await connection.call('find_sessions', { limit: 0 });
    expect(result.structuredContent).toEqual({ sessions: [], totalMatched: 5 });
    await connection.close();
  });

  test('refuses negative and non-integer limits (L2)', async () => {
    const fake = createFakeRuntime({ catalog: catalogOf(5) });
    const connection = await connect(fake.runtime);
    for (const limit of [-1, 1.5, Number.NaN]) {
      const result = await connection.call('find_sessions', { limit });
      expect(result.isError).toBe(true);
    }
    const negative = await connection.call('find_sessions', { limit: -3 });
    expect(textOf(negative)).toBe('limit must be a whole number from 0 to 50.');
    await connection.close();
  });

  test('filters by query and fields locally', async () => {
    const fake = createFakeRuntime({ catalog: catalogOf(10) });
    const connection = await connect(fake.runtime);
    const byText = await connection.call('find_sessions', { query: 'Session 7' });
    expect(mcpTools.find_sessions.output.parse(byText.structuredContent).totalMatched).toBe(1);
    const byService = await connection.call('find_sessions', {
      filters: { services: ['COMPUTE'], level: '200' },
    });
    const sessions = mcpTools.find_sessions.output.parse(byService.structuredContent).sessions;
    expect(sessions.every((s) => s.level === '200')).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    await connection.close();
  });

  test('a missing catalog asks the attendee to refresh', async () => {
    const connection = await connect(createFakeRuntime().runtime);
    const result = await connection.call('find_sessions', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Run refresh_catalog first.');
    await connection.close();
  });
});

describe('input size limits (security L6)', () => {
  const run = async (name: 'find_sessions', args: Record<string, unknown>) => {
    const fake = createFakeRuntime({ catalog: buildCatalogView([wireSession('a')]) });
    const connection = await connect(fake.runtime);
    const result = await connection.call(name, args);
    await connection.close();
    return result;
  };
  const refusal = 'The search text is limited to 200 characters, and plan goals to 20 items.';

  test('a search text of 200 characters is fine and 201 is refused with the fixed message', async () => {
    expect((await run('find_sessions', { query: 'a'.repeat(200) })).isError).not.toBe(true);
    const refused = await run('find_sessions', { query: 'a'.repeat(201) });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe(refusal);
  });
});
