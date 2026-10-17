import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  createFsFixtureLoader,
  defaultFixturesRoot,
  operationFolder,
} from '../../src/simulated/fixtures.js';
import { createInMemorySchedule } from '../../src/simulated/in-memory-schedule.js';

// Tests for fixture loading and the in-memory schedule (events-client, S1, task 14).

describe('events-client, task 14.1: fixture loading', () => {
  test('operation folders are kebab-case operation names', () => {
    expect(operationFolder('ReserveSessions')).toBe('reserve-sessions');
    expect(operationFolder('AssociateFavorites')).toBe('associate-favorites');
    expect(operationFolder('GetSchedule')).toBe('get-schedule');
    expect(operationFolder('ListEvents')).toBe('list-events');
  });

  test('the default root holds the read-only synthetic catalog of 120 sessions', () => {
    const loader = createFsFixtureLoader(defaultFixturesRoot());
    expect(loader.catalog()).toHaveLength(120);
    expect(loader.catalog()).toBe(loader.catalog());
  });

  test('canned responses are read from fixtures/api/<operation>/<scenario>.json, once, and validated', () => {
    const root = mkdtempSync(join(tmpdir(), 'compass-fixtures-'));
    try {
      mkdirSync(join(root, 'api', 'get-schedule'), { recursive: true });
      writeFileSync(
        join(root, 'api', 'get-schedule', 'error-429.json'),
        JSON.stringify({ status: 429, headers: { 'retry-after': '3' }, body: { message: 'x' } }),
      );
      writeFileSync(
        join(root, 'api', 'get-schedule', 'broken.json'),
        JSON.stringify({ status: 'no' }),
      );
      const reads: string[] = [];
      const loader = createFsFixtureLoader(root, (path) => {
        reads.push(path);
        return JSON.parse(JSON.stringify({})) === undefined
          ? ''
          : JSON.stringify(
              path.endsWith('error-429.json')
                ? { status: 429, headers: { 'retry-after': '3' }, body: { message: 'x' } }
                : { status: 'no' },
            );
      });
      const first = loader.fixture('GetSchedule', 'error-429');
      expect(first).toEqual({
        status: 429,
        headers: { 'retry-after': '3' },
        body: { message: 'x' },
      });
      expect(loader.fixture('GetSchedule', 'error-429')).toBe(first);
      expect(reads).toHaveLength(1);
      expect(() => loader.fixture('GetSchedule', 'broken')).toThrow();
      // The real directory loader reads the same shape from disk.
      expect(createFsFixtureLoader(root).fixture('GetSchedule', 'error-429').status).toBe(429);
      expect(() => createFsFixtureLoader(root).fixture('GetSchedule', 'broken')).toThrow();
      expect(() => createFsFixtureLoader(root).fixture('GetSchedule', 'missing')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a scenario name that is not a plain kebab-case name is refused', () => {
    const loader = createFsFixtureLoader(defaultFixturesRoot(), vi.fn());
    for (const bad of ['', '../x', 'a/b', 'A', 'a b', '..']) {
      expect(() => loader.fixture('GetSchedule', bad)).toThrow('Invalid fixture scenario name');
    }
  });
});

describe('events-client, task 14.1: in-memory personal time', () => {
  const world = { sessions: [], fullSessionIds: new Set<string>(), eventTimezone: 'UTC' };
  const input = { startDateTime: 'a', endDateTime: 'b', title: 't', description: 'd' };

  test('create assigns ids, update and delete report unknown ids, and entries are copied out', () => {
    const schedule = createInMemorySchedule(world);
    const a = schedule.createPersonalTime(input);
    const b = schedule.createPersonalTime({ ...input, title: 'u' });
    expect([a.personalTimeId, b.personalTimeId]).toEqual(['pt-1', 'pt-2']);
    expect(schedule.updatePersonalTime('pt-1', { ...input, title: 'new' })).toBe(true);
    expect(schedule.updatePersonalTime('pt-9', input)).toBe(false);
    const snap = schedule.snapshot();
    snap.personalTime[0] = { ...input, personalTimeId: 'tampered' };
    expect(schedule.snapshot().personalTime.map((p) => [p.personalTimeId, p.title])).toEqual([
      ['pt-1', 'new'],
      ['pt-2', 'u'],
    ]);
    expect(schedule.deletePersonalTime('pt-1')).toBe(true);
    expect(schedule.deletePersonalTime('pt-1')).toBe(false);
    expect(schedule.snapshot().personalTime).toHaveLength(1);
  });
});
