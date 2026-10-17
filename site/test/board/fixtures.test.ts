import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseBoardFragment } from '../../src/lib/board/fragment';
import { fetchHandoff } from '../../src/lib/board/handoff-client';
import { reduceBoard } from '../../src/lib/board/board-state';
import { validateHandoffView } from '../../src/lib/board/handoff-view';
import { SITE_ROOT } from '../support/source-files';
import { FIXED_ID, makeTimers, response } from '../support/handoff-data';

interface Fixture {
  status: number;
  contentType: string;
  body?: unknown;
  rawBody?: string;
}

const DIR = join(SITE_ROOT, 'e2e', 'fixtures', 'handoff');
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture;
const text = (fixture: Fixture): string => fixture.rawBody ?? JSON.stringify(fixture.body);

describe('hand-off fixtures', () => {
  test('the fixture set is the one the design lists', () => {
    expect(readdirSync(DIR).sort()).toEqual([
      'foreign-google-host.json',
      'malformed.json',
      'no-action.json',
      'not-found.json',
      'rate-limited.json',
      'ready-apple-only.json',
      'ready-one-bundle.json',
      'ready-three-bundles.json',
      'server-error.json',
      'wrong-bundle-path.json',
      'wrong-content-type.json',
    ]);
  });

  test('the fixture id is a canonical hand-off id', () => {
    expect(parseBoardFragment(`#h=${FIXED_ID}`)).toEqual({ ok: true, id: FIXED_ID });
  });

  test('every ready fixture is accepted', () => {
    for (const name of ['ready-one-bundle', 'ready-three-bundles', 'ready-apple-only']) {
      const fixture = load(name);
      expect(fixture.status).toBe(200);
      expect(validateHandoffView(fixture.body, FIXED_ID), name).not.toBeNull();
    }
  });

  test('the shapes cover one bundle, three bundles, Apple only', () => {
    const one = validateHandoffView(load('ready-one-bundle').body, FIXED_ID);
    const three = validateHandoffView(load('ready-three-bundles').body, FIXED_ID);
    const apple = validateHandoffView(load('ready-apple-only').body, FIXED_ID);
    expect(one?.appleBundles).toHaveLength(1);
    expect(one?.googleSaveUrl).not.toBeNull();
    expect(three?.appleBundles).toHaveLength(3);
    expect(three?.sessions).toHaveLength(24);
    expect(three?.calendarPath).not.toBeNull();
    expect(apple?.googleSaveUrl).toBeNull();
    expect(apple?.calendarPath).toBeNull();
  });

  test('every negative 200 fixture is rejected', () => {
    for (const name of ['wrong-bundle-path', 'foreign-google-host', 'no-action']) {
      expect(validateHandoffView(load(name).body, FIXED_ID), name).toBeNull();
    }
    expect(() => {
      JSON.parse(text(load('malformed')));
    }).toThrow();
  });

  test('the status fixtures drive the client and the state machine to the planned states', async () => {
    const expected: Record<string, string> = {
      'not-found': 'expired',
      'rate-limited': 'rateLimited',
      'server-error': 'unavailable',
      malformed: 'unavailable',
      'no-action': 'unavailable',
      'wrong-content-type': 'unavailable',
      'wrong-bundle-path': 'unavailable',
      'foreign-google-host': 'unavailable',
      'ready-one-bundle': 'ready',
    };
    for (const [name, kind] of Object.entries(expected)) {
      const fixture = load(name);
      const timers = makeTimers();
      const outcome = await fetchHandoff(FIXED_ID, {
        fetch: () => Promise.resolve(response(fixture.status, text(fixture), fixture.contentType)),
        timeoutMs: 10_000,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });
      const validated = outcome.kind === 'ok' ? validateHandoffView(outcome.body, FIXED_ID) : null;
      const state = reduceBoard(
        { kind: 'loading' },
        { type: 'outcome', outcome, validated, nowMs: 0 },
      );
      expect(state.kind, name).toBe(kind);
    }
  });
});
