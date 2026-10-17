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

// Owner-gated live smoke tests (events-client, S1, task 18; Requirement 21.2 to 21.5).
//
// These tests talk to the REAL Events API and the REAL OAuth endpoints, open a real
// browser for sign-in and use the real OS keychain. They run ONLY when the owner sets
// COMPASS_LIVE_TESTS=1 on their own machine, and the owner must also set
// COMPASS_LIVE_SESSION_ID to a session id they are happy to reserve. Without the flag
// every live test is reported as skipped (never as passed) and nothing here sends a
// request: the gate is checked before any setup runs. They are never run by the build,
// by CI or by an assistant.
//
//   COMPASS_LIVE_TESTS=1 COMPASS_LIVE_SESSION_ID=<id> npx vitest run live-smoke
//
// Optional: COMPASS_LIVE_EVENT_ID (default reinvent2026).
//
// What runs, in order: sign-in, catalog (events, event window, full session list),
// schedule read, a favorite round trip, a personal-time round trip, and exactly ONE
// reservation (the owner's session id, cancelled again afterwards). Everything the
// tests create is removed again; a favorite that already existed is left alone.

/** The gate: live tests are enabled only by the exact value 1. */
export function isLiveEnabled(env: Record<string, string | undefined>): boolean {
  return env.COMPASS_LIVE_TESTS === '1';
}

const LIVE = isLiveEnabled(process.env);
const SESSION_ID = process.env.COMPASS_LIVE_SESSION_ID ?? '';
const EVENT_ID = process.env.COMPASS_LIVE_EVENT_ID ?? 'reinvent2026';
const TITLE = 'Compass live smoke test';

describe('events-client, task 18: the live gate', () => {
  test('is open only when COMPASS_LIVE_TESTS is exactly 1', () => {
    expect(isLiveEnabled({})).toBe(false);
    expect(isLiveEnabled({ COMPASS_LIVE_TESTS: '' })).toBe(false);
    expect(isLiveEnabled({ COMPASS_LIVE_TESTS: '0' })).toBe(false);
    expect(isLiveEnabled({ COMPASS_LIVE_TESTS: 'true' })).toBe(false);
    expect(isLiveEnabled({ COMPASS_LIVE_TESTS: '1' })).toBe(true);
  });
});

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

describe.skipIf(!LIVE)('events-client, task 18: live smoke tests (owner only)', () => {
  // Nothing is created while the suite is collected (a skipped suite is still
  // collected): the real keychain entries and the transport are built in beforeAll,
  // which never runs when the gate is closed.
  let logger: ReturnType<typeof createRedactingLogger>;
  let store: ReturnType<typeof registerStoreSecrets>;
  let ctx: ClientContext;
  let window: EventWindow;
  let reservationsMade = 0;

  beforeAll(() => {
    logger = createRedactingLogger();
    store = registerStoreSecrets(createTokenStore(), logger);
    const refreshDeps = { fetch: defaultOAuthFetch, logger, now: () => Date.now() };
    const credential = createEventsApiCredential(createCredentialSources(store, refreshDeps));
    ctx = {
      eventId: EVENT_ID,
      transport: createHttpTransport({
        credential,
        fetch: (url, init) => fetch(url, init),
      }),
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
    if (!before) {
      const { result } = await associateFavorites(ctx, [SESSION_ID]);
      expect(result.failed).toEqual([]);
    }
    expect((await getSchedule(ctx)).schedule.favorites).toContain(SESSION_ID);
    if (!before) {
      await disassociateFavorite(ctx, SESSION_ID);
      expect((await getSchedule(ctx)).schedule.favorites).not.toContain(SESSION_ID);
    }
  });

  test('a personal-time round trip creates, updates and deletes a block inside the event window', async () => {
    const day = window.start.slice(0, 10);
    const offset = window.start.slice(-6);
    const input = {
      startDateTime: `${day}T03:00:00${offset}`,
      endDateTime: `${day}T04:00:00${offset}`,
      title: TITLE,
      description: 'Created by the Compass live smoke test and removed again',
    };
    await createPersonalTime(ctx, input);
    const created = (await getSchedule(ctx)).schedule.personalTime.find((p) => p.title === TITLE);
    expect(created).toBeDefined();
    const id = created?.personalTimeId ?? '';
    await updatePersonalTime(ctx, id, { ...input, title: `${TITLE} (updated)` });
    expect(
      (await getSchedule(ctx)).schedule.personalTime.some((p) => p.title === `${TITLE} (updated)`),
    ).toBe(true);
    await deletePersonalTime(ctx, id);
    expect(
      (await getSchedule(ctx)).schedule.personalTime.some((p) => p.personalTimeId === id),
    ).toBe(false);
  });

  test('exactly one reservation is made, with the owner session id, and cancelled again', async () => {
    expect(SESSION_ID, 'set COMPASS_LIVE_SESSION_ID to a session id').not.toBe('');
    reservationsMade += 1;
    expect(reservationsMade).toBe(1);
    const { result } = await reserveSessions(ctx, [SESSION_ID]);
    // A refusal is a valid live answer (full, clash, already reserved); it is reported
    // either way, and only an actual success needs cleaning up.
    expect(result.successful.length + result.failed.length).toBe(1);
    const { schedule } = await getSchedule(ctx);
    if (result.successful.includes(SESSION_ID)) {
      expect(schedule.reserved).toContain(SESSION_ID);
      await cancelReservation(ctx, SESSION_ID);
    }
  });
});
