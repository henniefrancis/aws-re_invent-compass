import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createHarness, response } from './operation-harness.js';
import { createHttpTransport, type FetchResponseLike } from '../../src/api/http-transport.js';
import { ValidationError } from '../../src/api/errors.js';
import { assertBulkInput } from '../../src/api/bulk-input.js';
import { eventPath, segment, MAX_SEGMENT_LENGTH } from '../../src/api/event-path.js';
import { getEvent } from '../../src/api/get-event.js';
import { getSession } from '../../src/api/get-session.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { associateFavorites } from '../../src/api/associate-favorites.js';
import { disassociateFavorite } from '../../src/api/disassociate-favorite.js';
import { updatePersonalTime } from '../../src/api/update-personal-time.js';
import { deletePersonalTime } from '../../src/api/delete-personal-time.js';
import type { EventsApiCredential } from '../../src/api/transport.js';

// Security regression tests for path safety (events-client, S1, finding H1).
// encodeURIComponent leaves "." and ".." alone and URL parsing collapses them, so an
// id of ".." could walk a request out of its path. Every dynamic segment is checked
// before use, and the transport re-checks the final path before anything is sent.

const BAD_IDS = [
  '',
  '.',
  '..',
  'a/b',
  'a\\b',
  '/',
  '\\',
  'a\u0000b',
  'a\nb',
  'a\u007fb',
  'x'.repeat(257),
];
const realistic = [
  'syn-001',
  'DAT302-R2',
  '7a1b9c2e-1f00-4c1c-9d3e-aaaaaaaaaaaa',
  'a b',
  'é',
  '...',
  'a.b',
  '..a',
  'a..',
  '%2e%2e',
  'x'.repeat(256),
];

describe('events-client, H1: dot segments and separators never reach a path', () => {
  test('segment and eventPath reject every unsafe value with a ValidationError that never echoes it', () => {
    for (const bad of BAD_IDS) {
      const failure = (() => {
        try {
          segment('GetSession', bad);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(failure).toBeInstanceOf(ValidationError);
      if (bad.length > 3) {
        expect((failure as Error).message).not.toContain(bad);
      }
    }
  });

  test('real-looking ids, including look-alikes of dot segments, are encoded and accepted', () => {
    for (const id of realistic) {
      expect(segment('GetSession', id)).toBe(encodeURIComponent(id));
    }
    expect(MAX_SEGMENT_LENGTH).toBe(256);
  });

  test('every operation function rejects an unsafe id before sending anything', async () => {
    for (const bad of BAD_IDS) {
      const h = createHarness({ responses: [response(204, undefined)] });
      const calls: (() => Promise<unknown>)[] = [
        () => getEvent(h.ctx, bad),
        () => getSession(h.ctx, bad),
        () => cancelReservation(h.ctx, bad),
        () => disassociateFavorite(h.ctx, bad),
        () =>
          updatePersonalTime(h.ctx, bad, {
            startDateTime: 'a',
            endDateTime: 'b',
            title: 't',
            description: 'd',
          }),
        () => deletePersonalTime(h.ctx, bad),
        () => Promise.resolve().then(() => reserveSessions(h.ctx, [bad])),
        () => Promise.resolve().then(() => associateFavorites(h.ctx, ['ok', bad])),
      ];
      for (const call of calls) {
        await expect((async () => call())()).rejects.toBeInstanceOf(ValidationError);
      }
      expect(h.sent).toHaveLength(0);
    }
  });

  test('an unsafe eventId on the context is rejected by every event-scoped operation', async () => {
    for (const bad of BAD_IDS) {
      const h = createHarness({ responses: [response(204, undefined)], eventId: bad });
      await expect((async () => getSchedule(h.ctx))()).rejects.toBeInstanceOf(ValidationError);
      await expect((async () => cancelReservation(h.ctx, 'S1'))()).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(() => reserveSessions(h.ctx, ['S1'])).toThrow(ValidationError);
      expect(h.sent).toHaveLength(0);
    }
  });

  test('the bulk guard rejects an unsafe id even when the count and distinctness are fine', () => {
    for (const bad of BAD_IDS) {
      expect(() => {
        assertBulkInput('ReserveSessions', ['fine', bad]);
      }).toThrow(ValidationError);
    }
    expect(() => {
      assertBulkInput('ReserveSessions', realistic.slice(0, 10));
    }).not.toThrow();
  });

  test('for any string a path is built if and only if the value passes the rules, and never alters the path shape', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (id) => {
        const h = createHarness({ responses: [] });
        const unsafe =
          id.length === 0 ||
          id === '.' ||
          id === '..' ||
          id.length > 256 ||
          /[/\\\u0000-\u001f\u007f]/.test(id);
        if (unsafe) {
          expect(() =>
            eventPath(h.ctx, 'GetSession', `/sessions/${segment('GetSession', id)}`),
          ).toThrow(ValidationError);
        } else {
          const path = eventPath(h.ctx, 'GetSession', `/sessions/${segment('GetSession', id)}`);
          expect(path.split('/')).toHaveLength(5);
          expect(new URL(`https://api.awsevents.com/v1${path}`).pathname).toBe(`/v1${path}`);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('events-client, H1: the transport re-checks the final path before sending', () => {
  const credential: EventsApiCredential = {
    getAccessTokenForEventsApi: () => Promise.resolve('tok'),
    forceRefresh: () => Promise.resolve(),
  };
  const ok: FetchResponseLike = {
    status: 204,
    headers: new Headers(),
    text: () => Promise.resolve(''),
  };

  function transportWith(captured: string[]): ReturnType<typeof createHttpTransport> {
    return createHttpTransport({
      credential,
      fetch: (url: string) => {
        captured.push(url);
        return Promise.resolve(ok);
      },
    });
  }

  test('paths that would be collapsed, escape the events tree or change segment count are refused unsent', async () => {
    const bad = [
      '/events/E1/reservations/..',
      '/events/E1/reservations/.',
      '/events/../reservations',
      '/reservations',
      '/schedule',
      '/events/E1/../../x',
      '/events/E1//reservations',
      '/events/E1/reservations/a%2Fb/../c',
      'events/E1',
      '/events/E1/reservations/a?b',
      '/events/E1/reservations/a#b',
    ];
    for (const path of bad) {
      const captured: string[] = [];
      await expect(
        transportWith(captured).send({ operation: 'CancelReservation', method: 'DELETE', path }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(captured).toHaveLength(0);
    }
  });

  test('well-formed event paths are sent unchanged under the v1 base', async () => {
    const captured: string[] = [];
    const t = transportWith(captured);
    await t.send({ operation: 'ListEvents', method: 'GET', path: '/events' });
    await t.send({
      operation: 'CancelReservation',
      method: 'DELETE',
      path: '/events/E1/reservations/S%2F1',
    });
    expect(captured).toEqual([
      'https://api.awsevents.com/v1/events',
      'https://api.awsevents.com/v1/events/E1/reservations/S%2F1',
    ]);
  });
});
