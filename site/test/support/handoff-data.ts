// Test data for the hand-off logic: ids, valid bodies and fake timers.

import fc from 'fast-check';
import type { HandoffId } from '../../src/lib/board/fragment';
import { GOOGLE_SAVE_PREFIX, validateHandoffView } from '../../src/lib/board/handoff-view';
import type { ValidatedHandoff } from '../../src/lib/board/handoff-view';

/** A fixed id used by example tests. The last character is canonical (A, Q, g or w). */
export const FIXED_ID = 'AbCdEfGhIjKlMnOpQrStUw' as HandoffId;

/** The unpadded base64url form of 16 bytes. */
export function idFromBytes(bytes: Uint8Array): HandoffId {
  return Buffer.from(bytes).toString('base64url') as HandoffId;
}

export const idArb: fc.Arbitrary<HandoffId> = fc
  .uint8Array({ minLength: 16, maxLength: 16 })
  .map(idFromBytes);

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function offsetText(minutes: number): string {
  if (minutes === 0) {
    return 'Z';
  }
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** A real ISO 8601 date-time with an offset. */
export const isoArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: Date.UTC(2026, 10, 25), max: Date.UTC(2026, 11, 10) }),
    fc.integer({ min: -48, max: 56 }).map((q) => q * 15),
  )
  .map(([ms, offset]) => {
    const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
    return `${local}${offsetText(offset)}`;
  });

export interface WireBody {
  expiresAt: string;
  sessions: { serialNumber: string; sessionCode: string; title: string; startsAt: string }[];
  apple: { bundlePaths: string[] };
  google: { saveUrl: string } | null;
  calendarPath: string | null;
}

export const sessionArb = fc.record({
  serialNumber: fc.uuid(),
  sessionCode: fc.stringMatching(/^[A-Z0-9]{2,12}$/),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  startsAt: isoArb,
});

const segment = fc.stringMatching(/^[A-Za-z0-9_-]{3,30}$/);
const tokenArb = fc.tuple(segment, segment, segment).map(([a, b, c]) => `eyJ${a}.${b}.${c}`);

/** A body that satisfies every rule of Requirement 17 for this id. */
export function bodyArb(id: HandoffId): fc.Arbitrary<WireBody> {
  return fc
    .tuple(isoArb, fc.array(sessionArb, { minLength: 1, maxLength: 80 }), fc.nat(), tokenArb)
    .chain(([expiresAt, sessions, bundleSeed, token]) => {
      const limit = Math.ceil(sessions.length / 10);
      const bundles = bundleSeed % (limit + 1);
      return fc.tuple(fc.boolean(), fc.boolean()).map(([withGoogle, withCalendar]): WireBody => ({
        expiresAt,
        sessions,
        apple: {
          bundlePaths: Array.from(
            { length: bundles },
            (_, index) => `/api/v1/handoffs/${id}/apple/${String(index)}`,
          ),
        },
        google: withGoogle ? { saveUrl: `${GOOGLE_SAVE_PREFIX}${token}` } : null,
        // A hand-off needs at least one action, so a body with none gets the calendar.
        calendarPath:
          withCalendar || (bundles === 0 && !withGoogle)
            ? `/api/v1/handoffs/${id}/calendar.ics`
            : null,
      }));
    });
}

/** A small valid body for example tests. */
export function exampleBody(id: HandoffId = FIXED_ID): WireBody {
  return {
    expiresAt: '2026-11-30T10:15:00-08:00',
    sessions: [
      {
        serialNumber: '6f1c2f0e-0d6f-4c52-9b3a-1a2b3c4d5e6f',
        sessionCode: 'DAT302',
        title: 'Made-up session about data',
        startsAt: '2026-11-30T10:30:00-08:00',
      },
      {
        serialNumber: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        sessionCode: 'CMP436-R',
        title: 'Another made-up session',
        startsAt: '2026-12-01T14:00:00-08:00',
      },
    ],
    apple: { bundlePaths: [`/api/v1/handoffs/${id}/apple/0`] },
    google: { saveUrl: `${GOOGLE_SAVE_PREFIX}eyJhbGciOiJSUzI1NiJ9.abc-def.ghi_jkl` },
    calendarPath: `/api/v1/handoffs/${id}/calendar.ics`,
  };
}

export function validated(body: WireBody, id: HandoffId = FIXED_ID): ValidatedHandoff {
  const result = validateHandoffView(body, id);
  if (result === null) {
    throw new Error('The test body should be valid.');
  }
  return result;
}

/** A response like fetch gives, with a content type (JSON by default). */
export function response(
  status: number,
  text: string,
  contentType: string | null = 'application/json',
): { status: number; headers: { get(name: string): string | null }; text(): Promise<string> } {
  return {
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: () => Promise.resolve(text),
  };
}

/** Fake timers: record callbacks and fire them on demand. */
export function makeTimers() {
  let next = 1;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  const cleared: number[] = [];
  return {
    pending,
    cleared,
    setTimer: (callback: () => void, ms: number): unknown => {
      const handle = next;
      next += 1;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clearTimer: (handle: unknown): void => {
      cleared.push(handle as number);
      pending.delete(handle as number);
    },
    /** Fire every pending timer once, in creation order. */
    fireAll: (): void => {
      for (const [handle, timer] of [...pending]) {
        pending.delete(handle);
        timer.callback();
      }
    },
  };
}
