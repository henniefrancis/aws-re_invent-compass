import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createQuotaTracker } from '../../src/api/quota-tracker.js';
import { createRedactingLogger } from '../../src/api/redacting-logger.js';
import { createHttpTransport } from '../../src/api/http-transport.js';
import { listEvents } from '../../src/api/list-events.js';
import { getEvent } from '../../src/api/get-event.js';
import { getSchedule } from '../../src/api/get-schedule.js';
import { associateFavorites } from '../../src/api/associate-favorites.js';
import { disassociateFavorite } from '../../src/api/disassociate-favorite.js';
import { createPersonalTime } from '../../src/api/create-personal-time.js';
import { updatePersonalTime } from '../../src/api/update-personal-time.js';
import { deletePersonalTime } from '../../src/api/delete-personal-time.js';
import { reserveSessions } from '../../src/api/reserve-sessions.js';
import { cancelReservation } from '../../src/api/cancel-reservation.js';
import { fetchAllSessions } from '../../src/catalog/paginate.js';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { resolveEventWindow, type EventWindow } from '../../src/catalog/event-window.js';
import { createEventsApiCredential } from '../../src/auth/credential-provider.js';
import { createCredentialSources } from '../../src/auth/refresh.js';
import { registerStoreSecrets } from '../../src/auth/secret-registering-store.js';
import { signIn } from '../../src/auth/sign-in.js';
import { signOut } from '../../src/auth/sign-out.js';
import { createTokenStore } from '../../src/auth/token-store.js';
import { defaultOAuthFetch } from '../../src/auth/oauth.js';
import type { ClientContext } from '../../src/api/transport.js';
import { LIVE_TEST_KEYCHAIN_SERVICE, isLiveEnabled } from './live-gate.js';

// Owner-gated live smoke tests (events-client, S1, task 18; Requirement 21.2 to 21.5,
// security finding N3).
//
// These tests talk to the REAL Events API and the REAL OAuth endpoints, open a real
// browser for sign-in and use the real OS keychain, under a SEPARATE keychain service
// name (reinvent-compass-livetest) so they never touch the owner's real session. This
// file is NOT in the default test include (it is not named *.test.ts); it runs only
// through its own config, and only when the owner opts in twice and the run is not CI:
//
//   COMPASS_LIVE_TESTS=1 COMPASS_LIVE_CONFIRM=yes COMPASS_LIVE_SESSION_ID=<id> \
//     npx vitest run --config packages/core/test/api/vitest.live.config.ts
//
// Optional: COMPASS_LIVE_EVENT_ID (default reinvent2026). Without both opt-ins, or in
// a CI run, every test here is reported as skipped and nothing is created or sent.
//
// What runs, in order: sign-in, catalog (events, event window, full session list),
// schedule read, a favorite round trip, a personal-time round trip, and exactly ONE
// reservation (the owner's session id, cancelled again afterwards). Every step that
// changes the schedule cleans up in a finally block, so a failed assertion cannot leave
// a favorite, a personal time block or a reservation behind. A favorite that already
// existed is left alone.

const LIVE = isLiveEnabled(process.env);
const SESSION_ID = process.env.COMPASS_LIVE_SESSION_ID ?? '';
const EVENT_ID = process.env.COMPASS_LIVE_EVENT_ID ?? 'reinvent2026';
const TITLE = 'Compass live smoke test';

/** Open a URL in the owner's browser without a shell. */
function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? (['rundll32', ['url.dll,FileProtocolHandler', url]] as const)
      : process.platform === 'darwin'
        ? (['open', [url]] as const)
        : (['xdg-open', [url]] as const);
  spawn(command, [...args], { detached: true, stdio: 'ignore' }).unref();
}

/** A UTC YYYY-MM-DDTHH:MM:00 value `hours` after an ISO instant (the documented format). */
function utcPlusHours(instant: string, hours: number): string {
  const ms = Date.parse(instant) + hours * 3_600_000;
  return `${new Date(ms).toISOString().slice(0, 16)}:00`;
}

describe.skipIf(!LIVE)('events-client, task 18: live smoke tests (owner only)', () => {
  // Nothing is created while the suite is collected (a skipped suite is still
  // collected): the keychain entries and the transport are built in beforeAll, which
  // never runs when the gate is closed.
  let logger: ReturnType<typeof createRedactingLogger>;
  let store: ReturnType<typeof registerStoreSecrets>;
  let ctx: ClientContext;
  let window: EventWindow;
  let reservationsMade = 0;

  beforeAll(() => {
    logger = createRedactingLogger();
    store = registerStoreSecrets(createTokenStore(undefined, LIVE_TEST_KEYCHAIN_SERVICE), logger);
    const refreshDeps = { fetch: defaultOAuthFetch, logger, now: () => Date.now() };
    const credential = createEventsApiCredential(createCredentialSources(store, refreshDeps));
    ctx = {
      eventId: EVENT_ID,
      transport: createHttpTransport({ credential, fetch: (url, init) => fetch(url, init) }),
      accessToken: credential,
      quota: createQuotaTracker(),
      logger,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
  });

  afterAll(async () => {
    await signOut(store, { fetch: defaultOAuthFetch, logger });
  });

  test('sign-in completes through the browser and stores the tokens', async () => {
    const result = await signIn({
      store,
      logger,
      fetch: defaultOAuthFetch,
      openBrowser: openInBrowser,
      now: () => Date.now(),
    });
    expect(['keychain', 'memory']).toContain(result.storage);
    expect(store.load()).toBeDefined();
  }, 330_000);

  test('catalog: the events list, the event window and the whole session list load', async () => {
    const events = await listEvents(ctx);
    const event = await getEvent(ctx, EVENT_ID);
    window = resolveEventWindow(events, event);
    const wires = await fetchAllSessions(ctx, { includeAbstracts: false });
    expect(wires.length).toBeGreaterThan(0);
    const first = wires[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(normaliseSession(first, undefined, window.timezone).sessionId).toBe(first.sessionId);
    }
  }, 120_000);

  test('schedule: the attendee schedule can be read', async () => {
    const { schedule } = await getSchedule(ctx);
    expect(Array.isArray(schedule.reserved)).toBe(true);
    expect(Array.isArray(schedule.favorites)).toBe(true);
    expect(Array.isArray(schedule.personalTime)).toBe(true);
  });

  test('a favorite round trip adds the owner session and removes it again', async () => {
    expect(SESSION_ID, 'set COMPASS_LIVE_SESSION_ID to a session id').not.toBe('');
    const before = (await getSchedule(ctx)).schedule.favorites.includes(SESSION_ID);
    let added = false;
    try {
      if (!before) {
        const { result } = await associateFavorites(ctx, [SESSION_ID]);
        added = result.successful.includes(SESSION_ID);
        expect(result.failed).toEqual([]);
      }
      expect((await getSchedule(ctx)).schedule.favorites).toContain(SESSION_ID);
    } finally {
      if (added) {
        await disassociateFavorite(ctx, SESSION_ID);
      }
    }
    if (added) {
      expect((await getSchedule(ctx)).schedule.favorites).not.toContain(SESSION_ID);
    }
  });

  test('a personal-time round trip creates, updates and deletes a block inside the event window', async () => {
    // The documented format: UTC, YYYY-MM-DDTHH:MM:00, no Z and no offset, 5-minute steps.
    const input = {
      startDateTime: utcPlusHours(window.start, 3),
      endDateTime: utcPlusHours(window.start, 4),
      title: TITLE,
      description: 'Created by the Compass live smoke test and removed again',
    };
    try {
      await createPersonalTime(ctx, input);
      const created = (await getSchedule(ctx)).schedule.personalTime.find((p) => p.title === TITLE);
      expect(created).toBeDefined();
      await updatePersonalTime(ctx, created?.personalTimeId ?? '', {
        ...input,
        title: `${TITLE} (updated)`,
      });
      expect(
        (await getSchedule(ctx)).schedule.personalTime.some(
          (p) => p.title === `${TITLE} (updated)`,
        ),
      ).toBe(true);
    } finally {
      // Remove every block this test may have left, whatever step failed.
      const { schedule } = await getSchedule(ctx);
      for (const entry of schedule.personalTime.filter((p) => p.title.startsWith(TITLE))) {
        await deletePersonalTime(ctx, entry.personalTimeId);
      }
    }
    expect(
      (await getSchedule(ctx)).schedule.personalTime.some((p) => p.title.startsWith(TITLE)),
    ).toBe(false);
  });

  test('exactly one reservation is made, with the owner session id, and cancelled again', async () => {
    expect(SESSION_ID, 'set COMPASS_LIVE_SESSION_ID to a session id').not.toBe('');
    reservationsMade += 1;
    expect(reservationsMade).toBe(1);
    let reserved = false;
    try {
      const { result } = await reserveSessions(ctx, [SESSION_ID]);
      reserved = result.successful.includes(SESSION_ID);
      // A refusal is a valid live answer (full, clash, already reserved); it is reported
      // either way, and only an actual success needs cleaning up.
      expect(result.successful.length + result.failed.length).toBe(1);
      if (reserved) {
        expect((await getSchedule(ctx)).schedule.reserved).toContain(SESSION_ID);
      }
    } finally {
      if (reserved) {
        await cancelReservation(ctx, SESSION_ID);
      }
    }
  });
});
