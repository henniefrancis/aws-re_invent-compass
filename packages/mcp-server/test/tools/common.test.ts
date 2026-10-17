import { describe, expect, test } from 'vitest';
import type { NormalisedSession } from '@compass/contracts';
import {
  commitmentFor,
  confirmedCommitments,
  ensureSignedIn,
  readFreshSchedule,
} from '../../src/tools/common.js';
import { buildCatalogView, normaliseWire, wireSession } from '../support/fake-catalog.js';
import { contextFor } from '../support/context.js';
import { createFakeRuntime } from '../support/fake-runtime.js';

describe('commitments', () => {
  test('commitmentFor carries the venue only when the session has one', () => {
    const withVenue = normaliseWire(wireSession('a'));
    const without: NormalisedSession = { ...withVenue };
    delete without.venue;
    expect(commitmentFor(withVenue)).toMatchObject({ venue: 'Encore' });
    expect('venue' in commitmentFor(without)).toBe(false);
  });

  test('confirmedCommitments skips unknown reserved ids and carries personal time', () => {
    const catalog = buildCatalogView([wireSession('a')]);
    const commitments = confirmedCommitments(
      {
        reserved: ['a', 'ghost'],
        favorites: [],
        personalTime: [
          {
            personalTimeId: 'p1',
            startDateTime: '2026-12-01T12:00:00-08:00',
            endDateTime: '2026-12-01T12:30:00-08:00',
            title: 'Lunch',
            description: '',
            location: 'Cafe',
          },
          {
            personalTimeId: 'p2',
            startDateTime: '2026-12-01T13:00:00-08:00',
            endDateTime: '2026-12-01T13:30:00-08:00',
            title: 'Rest',
            description: '',
          },
        ],
      },
      catalog,
    );
    expect(commitments.map((c) => c.kind)).toEqual([
      'reservedSession',
      'personalTime',
      'personalTime',
    ]);
    expect(commitments[1]).toMatchObject({ personalTimeId: 'p1', location: 'Cafe' });
    expect('location' in (commitments[2] ?? {})).toBe(false);
  });
});

describe('readFreshSchedule and ensureSignedIn', () => {
  test('reads the schedule and window from S1 and writes the snapshot', async () => {
    const fake = createFakeRuntime({ mode: 'live' });
    fake.events.schedule.reserved.push('a');
    const fresh = await readFreshSchedule(contextFor(fake));
    expect(fresh.schedule.reserved).toEqual(['a']);
    expect(fake.snapshot.writes[0]).toMatchObject({
      version: 1,
      mode: 'live',
      fetchedAt: fake.clock.now().toISOString(),
      eventWindow: fake.events.window,
      schedule: { reserved: ['a'] },
    });
  });

  test('ensureSignedIn throws only when signed out', async () => {
    const fake = createFakeRuntime();
    await expect(ensureSignedIn(contextFor(fake))).resolves.toBeUndefined();
    fake.events.signedIn = false;
    await expect(ensureSignedIn(contextFor(fake))).rejects.toMatchObject({ code: 'NotSignedIn' });
  });
});
