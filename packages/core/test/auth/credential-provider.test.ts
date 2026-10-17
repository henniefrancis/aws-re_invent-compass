import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  EVENTS_API_HOST,
  ID_TOKEN_AUDIENCE,
  OAUTH_HOST,
  assertAudience,
  createEventsApiCredential,
  createIdTokenProvider,
  type CredentialKind,
  type CredentialSources,
} from '../../src/auth/credential-provider.js';
import { AudienceError, NotSignedInError } from '../../src/auth/errors.js';
import {
  createHttpTransport,
  type FetchInit,
  type FetchResponseLike,
} from '../../src/api/http-transport.js';
import type { HttpMethod, OperationName } from '../../src/api/transport.js';

// Tests for the credential provider and audience guard (events-client, S1, tasks 9.6
// and 9.7). Property 11 checks that each credential kind is released only to its own
// audience, and that for any Events API request the access token is sent and the ID
// token never is.

const KINDS: readonly CredentialKind[] = ['access-token', 'refresh-token', 'id-token'];
const AUDIENCE: Record<CredentialKind, string> = {
  'access-token': EVENTS_API_HOST,
  'refresh-token': OAUTH_HOST,
  'id-token': ID_TOKEN_AUDIENCE,
};

describe('Feature: events-client, Property 11: Credentials are released only to their own audience', () => {
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.2
  const hostArb = fc.oneof(
    fc.constantFrom(
      EVENTS_API_HOST,
      OAUTH_HOST,
      ID_TOKEN_AUDIENCE,
      'API.AWSEVENTS.COM',
      'api.awsevents.com.example.net',
      'evilapi.awsevents.com',
      '',
      'localhost',
    ),
    fc.domain(),
    fc.string(),
  );

  test('for any kind and host the credential is released if and only if the host is its audience', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), hostArb, (kind, host) => {
        const allowed = host.toLowerCase() === AUDIENCE[kind];
        if (allowed) {
          expect(() => {
            assertAudience(kind, host);
          }).not.toThrow();
        } else {
          expect(() => {
            assertAudience(kind, host);
          }).toThrow(AudienceError);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('every kind is refused at every other kind audience', () => {
    for (const kind of KINDS) {
      for (const other of KINDS.filter((k) => k !== kind)) {
        expect(() => {
          assertAudience(kind, AUDIENCE[other]);
        }).toThrow(AudienceError);
      }
    }
  });

  test('for any operation request the transport sends the access token and never the ID token', async () => {
    const methods: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];
    const operations: readonly OperationName[] = [
      'ListEvents',
      'GetEvent',
      'ListSessions',
      'GetSession',
      'GetSchedule',
      'ReserveSessions',
      'CancelReservation',
      'AssociateFavorites',
      'DisassociateFavorite',
      'CreatePersonalTime',
      'UpdatePersonalTime',
      'DeletePersonalTime',
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...operations),
        fc.constantFrom(...methods),
        fc.stringMatching(/^[A-Za-z0-9]{12,20}$/),
        fc.stringMatching(/^[A-Za-z0-9]{12,20}$/),
        fc.option(fc.record({ sessionIds: fc.array(fc.string(), { maxLength: 3 }) }), {
          nil: undefined,
        }),
        async (operation, method, access, id, body) => {
          fc.pre(access !== id && !access.includes(id) && !id.includes(access));
          const sources: CredentialSources = {
            refreshIfNeeded: () => Promise.resolve(),
            refreshNow: () => Promise.resolve(),
            accessToken: () => access,
            idToken: () => id,
          };
          const calls: { url: string; init: FetchInit }[] = [];
          const reply: FetchResponseLike = {
            status: 204,
            headers: new Headers(),
            text: () => Promise.resolve(''),
          };
          const transport = createHttpTransport({
            credential: createEventsApiCredential(sources),
            fetch: (url, init) => {
              calls.push({ url, init });
              return Promise.resolve(reply);
            },
          });
          await transport.send({ operation, method, path: '/events/e', body });
          const sent = JSON.stringify(calls[0]);
          expect(calls[0]?.init.headers.authorization).toBe(`Bearer ${access}`);
          expect(sent).not.toContain(id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('events-client, task 9.6: credential providers', () => {
  function sources(overrides: Partial<CredentialSources> = {}): {
    sources: CredentialSources;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      sources: {
        refreshIfNeeded: () => {
          calls.push('refreshIfNeeded');
          return Promise.resolve();
        },
        refreshNow: () => {
          calls.push('refreshNow');
          return Promise.resolve();
        },
        accessToken: () => 'access-value',
        idToken: () => 'id-value',
        ...overrides,
      },
    };
  }

  test('the Events API credential refreshes if needed, then returns the access token only', async () => {
    const s = sources();
    const credential = createEventsApiCredential(s.sources);
    await expect(credential.getAccessTokenForEventsApi()).resolves.toBe('access-value');
    expect(s.calls).toEqual(['refreshIfNeeded']);
    expect(Object.keys(credential).sort()).toEqual(['forceRefresh', 'getAccessTokenForEventsApi']);
  });

  test('forceRefresh refreshes now and propagates a failure', async () => {
    const s = sources();
    await createEventsApiCredential(s.sources).forceRefresh();
    expect(s.calls).toEqual(['refreshNow']);
    const failing = sources({ refreshNow: () => Promise.reject(new Error('refresh failed')) });
    await expect(createEventsApiCredential(failing.sources).forceRefresh()).rejects.toThrow(
      'refresh failed',
    );
  });

  test('with no access token the credential reports not signed in', async () => {
    const s = sources({ accessToken: () => undefined });
    await expect(
      createEventsApiCredential(s.sources).getAccessTokenForEventsApi(),
    ).rejects.toBeInstanceOf(NotSignedInError);
  });

  test('the ID token provider refreshes if needed, then returns the ID token', async () => {
    const s = sources();
    await expect(createIdTokenProvider(s.sources).getIdTokenForCompassApi()).resolves.toBe(
      'id-value',
    );
    expect(s.calls).toEqual(['refreshIfNeeded']);
  });

  test('with no ID token the provider reports not signed in', async () => {
    const s = sources({ idToken: () => undefined });
    await expect(createIdTokenProvider(s.sources).getIdTokenForCompassApi()).rejects.toBeInstanceOf(
      NotSignedInError,
    );
  });
});
