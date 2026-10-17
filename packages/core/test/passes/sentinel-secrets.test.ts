import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createAppDataResolver, RECORD_FILE_NAME } from '../../src/passes/app-data.js';
import { createCompassClient } from '../../src/passes/compass-client.js';
import { forgetMe } from '../../src/passes/forget-me.js';
import { createHandoffBuilder } from '../../src/passes/handoff-builder.js';
import { createIcsExporter } from '../../src/passes/ics-exporter.js';
import { createItineraryPage } from '../../src/passes/itinerary-page.js';
import type { Itinerary } from '../../src/passes/models.js';
import { buildPass } from '../../src/passes/pass-builder.js';
import { createPassStore } from '../../src/passes/pass-store.js';
import { syncPasses } from '../../src/passes/pass-sync.js';
import { memoryFs } from './memory-fs.js';
import { createContractMock, jsonResponse, problem } from './openapi-mock.js';
import {
  WINDOW,
  fakeClock,
  fakeConnections,
  fakeIdToken,
  makeSession,
  TEST_HOSTS,
} from './support.js';

// Property 26: no secret reaches logs or errors on the named failure paths (Requirements 8.1,
// 8.2, 8.3 and 9.5). The harness injects a known ID token, attendee email, Board_URL and
// hand-off id, plus a marker for request input, drives every component down its named failure
// paths (problem bodies, response validation failures, transport failures, store write
// failures, builder text fallbacks and the rest), and asserts that nothing the components
// throw, return or log contains any of them.

interface Sentinels {
  token: string;
  email: string;
  handoffId: string;
  boardUrl: string;
}

/** Request input that must never be echoed back by an error. */
const REQUEST_MARKER = 'ConfidentialRequestMarker';

const sentinelsArb: fc.Arbitrary<Sentinels> = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9_-]{16,30}$/).map((label) => fakeIdToken(label)),
    fc.stringMatching(/^[a-z]{4,10}\.[a-z]{4,10}@[a-z]{4,10}\.com$/),
    fc.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    fc.stringMatching(/^[a-z0-9]{8,14}$/),
  )
  .map(([token, email, handoffId, host]) => ({
    token,
    email,
    handoffId,
    boardUrl: `https://${host}.cloudfront.net/board#h=${handoffId}`,
  }));

const appData = createAppDataResolver({
  platform: 'linux',
  env: { XDG_DATA_HOME: '/home/ada/.local/share' },
  homeDir: '/home/ada',
});
const SERIAL = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';

/** Everything an error exposes that a caller could log or show. */
function exposed(error: unknown): string {
  const err = error as Error & { summary?: string };
  return [
    String(error),
    err.message,
    err.summary ?? '',
    err.stack ?? '',
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
  ].join('\n');
}

/** Run an operation that must fail and return what it exposes. */
async function failing(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return exposed(error);
  }
  throw new Error('the named failure path did not fail');
}

function clientFor(s: Sentinels, mock = createContractMock()) {
  const client = createCompassClient({
    baseUrl: 'https://d111111abcdef8.cloudfront.net',
    allowedHosts: TEST_HOSTS,
    transport: mock,
    clock: fakeClock(),
    idToken: { getIdToken: () => Promise.resolve(s.token) },
  });
  return { client, mock };
}

/** Pass fields whose request input carries the marker and the attendee email. */
function inputFields(s: Sentinels) {
  const base = buildPass(
    { session: makeSession({ title: 'Marker session' }), eventWindow: WINDOW },
    { connections: fakeConnections() },
  ).fields;
  return { ...base, title: `${REQUEST_MARKER} ${s.email}`.slice(0, 80) };
}

/** Drive every named failure path once. Returns the text each failure exposes, and each non-error output. */
async function driveAllFailurePaths(
  s: Sentinels,
): Promise<{ errors: string[]; outputs: string[] }> {
  const errors: string[] = [];
  const outputs: string[] = [];
  const leakyBody = `${s.email} ${s.boardUrl} ${s.token} ${REQUEST_MARKER}`;

  // Compass_Client: a problem body.
  {
    const { client, mock } = clientFor(s);
    mock.enqueue('issuePasses', problem(400, 'bad_request'));
    errors.push(
      await failing(() => client.issuePasses({ platforms: ['apple'], passes: [inputFields(s)] })),
    );
  }
  // Compass_Client: a response that fails validation, whose body carries the hand-off.
  {
    const { client, mock } = clientFor(s);
    mock.enqueue(
      'createHandoff',
      jsonResponse(201, { handoffId: s.handoffId, boardUrl: s.boardUrl, expiresAt: 'not a date' }),
    );
    errors.push(
      await failing(() =>
        client.createHandoff({
          serialNumbers: [SERIAL],
          include: { apple: true, google: false, calendar: false },
        }),
      ),
    );
  }
  // Compass_Client: a problem body that is not a valid Problem, an HTTP error and a 429, all with leaky bodies.
  {
    const { client, mock } = clientFor(s);
    mock.enqueue('forgetMe', {
      status: 400,
      headers: { 'content-type': 'application/problem+json' },
      body: leakyBody,
    });
    mock.enqueue('voidPass', { status: 502, headers: {}, body: leakyBody });
    mock.enqueue('updatePass', { status: 429, headers: {}, body: leakyBody });
    errors.push(await failing(() => client.forgetMe()));
    errors.push(await failing(() => client.voidPass(SERIAL)));
    errors.push(await failing(() => client.updatePass(SERIAL, inputFields(s))));
  }
  // Compass_Client: a transport failure whose message carries every secret.
  {
    const { client, mock } = clientFor(s);
    mock.failNext(new Error(leakyBody));
    errors.push(await failing(() => client.forgetMe()));
  }
  // Compass_Client: an ID token provider that fails with the token in its message.
  {
    const client = createCompassClient({
      baseUrl: 'https://d111111abcdef8.cloudfront.net',
      allowedHosts: TEST_HOSTS,
      transport: createContractMock(),
      clock: fakeClock(),
      idToken: { getIdToken: () => Promise.reject(new Error(leakyBody)) },
    });
    errors.push(await failing(() => client.forgetMe()));
  }

  // Pass_Store: a write failure whose message carries the email, and a corrupt record.
  {
    const fs = memoryFs();
    fs.failureText = leakyBody;
    fs.failing.add('writeFile');
    const store = createPassStore({ appData, fs, clock: fakeClock() });
    errors.push(await failing(() => store.write({ passes: [] })));
    const corrupt = memoryFs({
      [`${appData.resolve()}/${RECORD_FILE_NAME}`]: JSON.stringify({ passes: [], email: s.email }),
    });
    errors.push(
      await failing(() => createPassStore({ appData, fs: corrupt, clock: fakeClock() }).read()),
    );
    const tainted = { passes: [], idToken: s.token, email: s.email } as never;
    errors.push(
      await failing(() =>
        createPassStore({ appData, fs: memoryFs(), clock: fakeClock() }).write(tainted),
      ),
    );
  }

  // Pass_Builder: text fallbacks (nothing thrown) and an impossible build (thrown).
  {
    const hostile = makeSession({
      title: `${s.boardUrl} ${s.email}`,
      venue: s.email,
      room: s.boardUrl,
    });
    const built = buildPass(
      {
        session: hostile,
        attendeeName: s.email,
        previous: {
          commitment: {
            kind: 'reservedSession',
            sessionId: 'prev',
            venue: s.email,
            startsAt: '2026-12-01T09:00:00-08:00',
            endsAt: '2026-12-01T10:00:00-08:00',
          },
        },
        eventWindow: WINDOW,
      },
      { connections: { walkMinutes: () => 5 } },
    );
    outputs.push(JSON.stringify(built.fields));
    errors.push(
      await failing(() =>
        buildPass(
          {
            session: makeSession({ title: `${s.email} ${REQUEST_MARKER}`, code: 'bad code' }),
            eventWindow: WINDOW,
          },
          { connections: fakeConnections() },
        ),
      ),
    );
  }

  // Handoff_Builder: an insecure board URL and a link too long for a QR code.
  {
    const handoffDeps = { clock: fakeClock() };
    const origin = new URL(s.boardUrl).origin;
    const bad = {
      ...handoffDeps,
      client: {
        origin,
        createHandoff: () =>
          Promise.resolve({
            handoffId: s.handoffId,
            boardUrl: s.boardUrl.replace('https:', 'http:'),
            expiresAt: '2026-12-01T10:15:00Z',
          }),
      },
    };
    errors.push(
      await failing(() =>
        createHandoffBuilder(bad).handoff([SERIAL], {
          apple: true,
          google: false,
          calendar: false,
        }),
      ),
    );
    const long = {
      ...handoffDeps,
      client: {
        origin,
        createHandoff: () =>
          Promise.resolve({
            handoffId: s.handoffId,
            boardUrl: `${s.boardUrl}${'a'.repeat(3000)}`,
            expiresAt: '2026-12-01T10:15:00Z',
          }),
      },
    };
    errors.push(
      await failing(() =>
        createHandoffBuilder(long).handoff([SERIAL], {
          apple: true,
          google: false,
          calendar: false,
        }),
      ),
    );
  }

  // Pass_Sync: the client fails while a record exists, and the builder carries the email.
  {
    const mock = createContractMock();
    mock.enqueue('issuePasses', problem(400, 'bad_request'));
    const { client } = clientFor(s, mock);
    const store = createPassStore({ appData, fs: memoryFs(), clock: fakeClock() });
    const session = makeSession({ code: 'SYNC01', title: `${REQUEST_MARKER} ${s.email}` });
    errors.push(
      await failing(() =>
        syncPasses(
          { sessions: [session], scheduleConfirmed: true },
          {
            store,
            client,
            platforms: ['apple'],
            builder: () => ({ ...inputFields(s), sessionCode: 'SYNC01' }),
          },
        ),
      ),
    );
  }

  // forgetMe orchestrator: the client fails, then local removal fails with a leaky message.
  {
    const { client, mock } = clientFor(s);
    mock.enqueue('forgetMe', problem(401, 'unauthorized'));
    const fs = memoryFs();
    const store = createPassStore({ appData, fs, clock: fakeClock() });
    errors.push(await failing(() => forgetMe({ client, store, fs, appData })));
    const removal = memoryFs();
    removal.failureText = leakyBody;
    removal.failing.add('remove');
    const second = clientFor(s);
    errors.push(
      await failing(() =>
        forgetMe({
          client: second.client,
          store: createPassStore({ appData, fs: removal, clock: fakeClock() }),
          fs: removal,
          appData,
        }),
      ),
    );
  }

  // Ics_Exporter and Itinerary_Page: write failures, invalid instants and an invalid timezone.
  {
    const leakyReserved = (startsAt: string, endsAt: string): Itinerary => ({
      commitments: [
        {
          commitment: {
            kind: 'reservedSession',
            sessionId: 's1',
            title: `${REQUEST_MARKER} ${s.email}`,
            venue: s.boardUrl,
            startsAt,
            endsAt,
          },
        },
      ],
    });
    const ok = leakyReserved('2026-12-01T10:30:00-08:00', '2026-12-01T11:30:00-08:00');

    const writeFail = memoryFs();
    writeFail.failureText = leakyBody;
    writeFail.failing.add('writeFile');
    const ics = createIcsExporter({ fs: writeFail, appData, clock: fakeClock() });
    const pageOut = createItineraryPage({ fs: writeFail, appData });
    errors.push(await failing(() => ics.writeCalendar(ok, WINDOW)));
    errors.push(await failing(() => pageOut.write(ok, WINDOW)));
    errors.push(await failing(() => ics.buildCalendar(leakyReserved(s.token, s.boardUrl), WINDOW)));
    errors.push(
      await failing(() =>
        ics.buildCalendar(
          leakyReserved('2026-12-01T11:30:00-08:00', '2026-12-01T10:30:00-08:00'),
          WINDOW,
        ),
      ),
    );
    errors.push(await failing(() => pageOut.render(leakyReserved(s.boardUrl, s.token), WINDOW)));
    errors.push(await failing(() => pageOut.render(ok, { ...WINDOW, timezone: s.email })));
  }

  return { errors, outputs };
}

describe('Feature: boarding-passes, Property 26: no secret reaches logs or errors on the named failure paths', () => {
  const spies: MockInstance[] = [];

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
    }
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  test('every failure path is clean and nothing is logged', async () => {
    await fc.assert(
      fc.asyncProperty(sentinelsArb, async (s) => {
        const { errors, outputs } = await driveAllFailurePaths(s);

        // Guard against a vacuous pass: every named failure path produced an error.
        expect(errors).toHaveLength(22);
        const forbidden = [s.token, s.email, s.handoffId, s.boardUrl, REQUEST_MARKER];
        for (const text of [...errors, ...outputs]) {
          for (const secret of forbidden) {
            expect(text).not.toContain(secret);
          }
        }
        for (const spy of spies) {
          expect(spy).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  test('the sentinel check would notice a leak', () => {
    expect(exposed(new Error('contains first.timer@example.com'))).toContain(
      'first.timer@example.com',
    );
  });

  test('the client sends the token only in the Authorization header, never in the URL or body', async () => {
    const s = {
      token: fakeIdToken('aaaaaaaaaaaaaaaa'),
      email: 'first.timer@example.com',
      handoffId: 'Zk3pQ9sLw2VnR8xT5yBc7A',
      boardUrl: 'https://d111111abcdef8.cloudfront.net/board#h=Zk3pQ9sLw2VnR8xT5yBc7A',
    };
    const { client, mock } = clientFor(s);
    const calls: Promise<unknown>[] = [
      client.issuePasses({ platforms: ['apple'], passes: [inputFields(s)] }),
      client.updatePass(SERIAL, inputFields(s)),
      client.voidPass(SERIAL),
      client.forgetMe(),
    ];
    await Promise.all(calls);
    for (const request of mock.requests) {
      expect(request.url).not.toContain(s.token);
      expect(JSON.stringify(request.body ?? null)).not.toContain(s.token);
      expect(request.headers.authorization).toBe(`Bearer ${s.token}`);
    }
  });
});
