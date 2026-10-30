import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import type { HandoffId } from '../../src/lib/board/fragment';
import {
  CONTRACT_MATCH,
  GOOGLE_SAVE_PREFIX,
  MAX_SESSIONS,
  validateHandoffView,
} from '../../src/lib/board/handoff-view';
import {
  FIXED_ID,
  bodyArb,
  applePathOf,
  calendarPathOf,
  exampleBody,
  idArb,
  idFromBytes,
  type WireBody,
} from '../support/handoff-data';

// The generated hand-off bodies hold up to 80 sessions; the machine may be busy.
vi.setConfig({ testTimeout: 60_000 });

const UNRELATED_SERIAL = '11111111-2222-4333-8444-555555555555';
const clone = (body: WireBody): WireBody => structuredClone(body);

describe('validateHandoffView examples', () => {
  test('accepts the example body and returns everything unchanged', () => {
    const result = validateHandoffView(exampleBody(), FIXED_ID);
    expect(result).toEqual({
      expiresAt: '2026-11-30T10:15:00-08:00',
      expiresAtMs: Date.parse('2026-11-30T10:15:00-08:00'),
      sessions: exampleBody().sessions,
      appleBundles: [{ path: `/api/v1/handoffs/${FIXED_ID}/apple/0`, number: 1, of: 1 }],
      googleSaveUrl: `${GOOGLE_SAVE_PREFIX}eyJhbGciOiJSUzI1NiJ9.abc-def.ghi_jkl`,
      calendarPath: `/api/v1/handoffs/${FIXED_ID}/calendar.ics`,
    });
  });

  test('accepts no bundles and no Google when there is a calendar', () => {
    const body = {
      ...exampleBody(),
      apple: { bundlePaths: [] },
      google: null,
      calendarPath: `/api/v1/handoffs/${FIXED_ID}/calendar.ics`,
    };
    const result = validateHandoffView(body, FIXED_ID);
    expect(result?.appleBundles).toEqual([]);
    expect(result?.googleSaveUrl).toBeNull();
    expect(result?.calendarPath).toBe(`/api/v1/handoffs/${FIXED_ID}/calendar.ics`);
  });

  test('the contract and the accepted shape match', () => {
    expect(CONTRACT_MATCH).toBe(true);
  });

  test('refuses things that are not objects', () => {
    for (const body of [null, undefined, 1, 'x', [], [exampleBody()]]) {
      expect(validateHandoffView(body, FIXED_ID)).toBeNull();
    }
  });

  test('refuses the limits: 0 or 81 sessions, and too many bundles', () => {
    const base = exampleBody();
    const one = base.sessions[0] as WireBody['sessions'][number];
    expect(validateHandoffView({ ...base, sessions: [] }, FIXED_ID)).toBeNull();
    expect(
      validateHandoffView(
        { ...base, sessions: Array.from({ length: MAX_SESSIONS + 1 }, () => one) },
        FIXED_ID,
      ),
    ).toBeNull();
    expect(
      validateHandoffView(
        {
          ...base,
          apple: {
            bundlePaths: [0, 1].map((i) => `/api/v1/handoffs/${FIXED_ID}/apple/${String(i)}`),
          },
        },
        FIXED_ID,
      ),
    ).toBeNull();
    expect(
      validateHandoffView({ ...base, sessions: Array.from({ length: 80 }, () => one) }, FIXED_ID),
    ).not.toBeNull();
  });

  test('a bundle path for another id is refused', () => {
    const other = idFromBytes(new Uint8Array(16).fill(7));
    const body = {
      ...exampleBody(),
      apple: { bundlePaths: [`/api/v1/handoffs/${other}/apple/0`] },
    };
    expect(validateHandoffView(body, FIXED_ID)).toBeNull();
  });

  test('a hand-off with no action at all is refused', () => {
    const base = exampleBody();
    const bare = base.sessions.map((s) => ({
      ...s,
      applePath: null,
      googleSaveUrl: null,
      calendarPath: null,
    }));
    const none = {
      ...base,
      sessions: bare,
      apple: { bundlePaths: [] },
      google: null,
      calendarPath: null,
    };
    expect(validateHandoffView(none, FIXED_ID)).toBeNull();
    const first = base.sessions[0] as WireBody['sessions'][number];
    const only = (patch: Partial<typeof first>) => ({
      ...none,
      sessions: [{ ...bare[0], ...patch }, ...bare.slice(1)],
    });
    for (const withOne of [
      { ...none, calendarPath: `/api/v1/handoffs/${FIXED_ID}/calendar.ics` },
      { ...none, google: base.google },
      { ...none, apple: { bundlePaths: [`/api/v1/handoffs/${FIXED_ID}/apple/0`] } },
      only({ applePath: first.applePath }),
      only({ googleSaveUrl: first.googleSaveUrl }),
      only({ calendarPath: first.calendarPath }),
    ]) {
      expect(validateHandoffView(withOne, FIXED_ID)).not.toBeNull();
    }
  });

  test('the Google token must look like a JWT of at most 4 KB', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.c2ln-_bmF0dXJl';
    const urlOf = (token: string) => ({
      ...exampleBody(),
      google: { saveUrl: `${GOOGLE_SAVE_PREFIX}${token}` },
    });
    expect(validateHandoffView(urlOf(jwt), FIXED_ID)).not.toBeNull();
    const bad = [
      'abc',
      'eyJabc',
      'eyJabc.def',
      'xyJabc.def.ghi',
      'eyJabc.def.ghi.jkl',
      'eyJabc..ghi',
      'eyJabc.def.',
      'eyJabc.def.gh%20i',
      `eyJ${'a'.repeat(4094)}.b.c`,
    ];
    for (const token of bad) {
      expect(validateHandoffView(urlOf(token), FIXED_ID), token.slice(0, 20)).toBeNull();
    }
    expect(validateHandoffView(urlOf(`eyJ${'a'.repeat(4000)}.b.c`), FIXED_ID)).not.toBeNull();
  });

  test('the title and the session code have length caps', () => {
    const base = exampleBody();
    const first = base.sessions[0] as WireBody['sessions'][number];
    const withSession = (patch: Partial<typeof first>) => ({
      ...base,
      sessions: [{ ...first, ...patch }],
    });
    expect(validateHandoffView(withSession({ title: 'x'.repeat(80) }), FIXED_ID)).not.toBeNull();
    expect(validateHandoffView(withSession({ title: 'x'.repeat(81) }), FIXED_ID)).toBeNull();
    expect(validateHandoffView(withSession({ title: '' }), FIXED_ID)).toBeNull();
    expect(
      validateHandoffView(withSession({ sessionCode: 'A'.repeat(20) }), FIXED_ID),
    ).not.toBeNull();
    expect(validateHandoffView(withSession({ sessionCode: 'A'.repeat(21) }), FIXED_ID)).toBeNull();
    expect(validateHandoffView(withSession({ sessionCode: '' }), FIXED_ID)).toBeNull();
  });

  test('Google links must be the exact https pay.google.com save prefix', () => {
    const bad = [
      'http://pay.google.com/gp/v/save/abc',
      'https://pay.google.com.evil.invalid/gp/v/save/abc',
      'https://evil.invalid/https://pay.google.com/gp/v/save/abc',
      'https://user@pay.google.com/gp/v/save/abc',
      'https://pay.google.com:8443/gp/v/save/abc',
      'https://pay.google.com/gp/v/other/abc',
      'https://pay.google.com/gp/v/save/',
      'https://pay.google.com/gp/v/save/abc?x=1',
      'https://pay.google.com/gp/v/save/abc def',
      'HTTPS://pay.google.com/gp/v/save/abc',
      'javascript:alert(1)',
      '',
    ];
    for (const saveUrl of bad) {
      expect(
        validateHandoffView({ ...exampleBody(), google: { saveUrl } }, FIXED_ID),
        saveUrl,
      ).toBeNull();
      // The same rule holds for one session's own link.
      const body = exampleBody();
      const first = body.sessions[0] as WireBody['sessions'][number];
      expect(
        validateHandoffView(
          { ...body, sessions: [{ ...first, googleSaveUrl: saveUrl }] },
          FIXED_ID,
        ),
        saveUrl,
      ).toBeNull();
    }
  });
});

describe('the buttons of each session', () => {
  const body = exampleBody();
  const first = body.sessions[0] as WireBody['sessions'][number];
  const withFirst = (patch: Record<string, unknown>) => ({
    ...body,
    sessions: [{ ...first, ...patch }, ...body.sessions.slice(1)],
  });

  test('every session returns its own three fields as sent', () => {
    const result = validateHandoffView(body, FIXED_ID);
    expect(result?.sessions.map((s) => [s.applePath, s.googleSaveUrl, s.calendarPath])).toEqual(
      body.sessions.map((s) => [s.applePath, s.googleSaveUrl, s.calendarPath]),
    );
    expect(result?.sessions[1]?.googleSaveUrl).toBeNull();
  });

  test('each path must be exactly this hand-off and this session', () => {
    const other = idFromBytes(new Uint8Array(16).fill(7));
    const second = body.sessions[1] as WireBody['sessions'][number];
    const bad: Record<string, unknown>[] = [
      { applePath: `/api/v1/handoffs/${other}/apple/pass/${first.serialNumber}` },
      { applePath: second.applePath },
      { applePath: `/api/v1/handoffs/${FIXED_ID}/apple/pass/${first.serialNumber}?x=1` },
      { applePath: `https://evil.invalid${first.applePath}` },
      { applePath: `${first.applePath}/` },
      { applePath: '' },
      { applePath: 5 },
      { calendarPath: `/api/v1/handoffs/${other}/calendar/${first.serialNumber}.ics` },
      { calendarPath: second.calendarPath },
      { calendarPath: `/api/v1/handoffs/${FIXED_ID}/calendar/${first.serialNumber}` },
      { calendarPath: `/api/v1/handoffs/${FIXED_ID}/calendar.ics` },
      { calendarPath: `https://evil.invalid${first.calendarPath}` },
      { calendarPath: 5 },
      { googleSaveUrl: 5 },
      { googleSaveUrl: undefined },
    ];
    for (const patch of bad) {
      expect(validateHandoffView(withFirst(patch), FIXED_ID), JSON.stringify(patch)).toBeNull();
    }
  });

  test('a session with a path field missing or an extra field is refused', () => {
    const noApple: Record<string, unknown> = { ...first };
    delete noApple['applePath'];
    expect(validateHandoffView({ ...body, sessions: [noApple] }, FIXED_ID)).toBeNull();
    expect(validateHandoffView(withFirst({ extra: 1 }), FIXED_ID)).toBeNull();
  });

  test('a service from before per-session buttons is refused as a whole', () => {
    const old = body.sessions.map((s) => ({
      serialNumber: s.serialNumber,
      sessionCode: s.sessionCode,
      title: s.title,
      startsAt: s.startsAt,
    }));
    expect(validateHandoffView({ ...body, sessions: old }, FIXED_ID)).toBeNull();
  });

  test('the top Google object has only saveUrl', () => {
    const saveUrl = `${GOOGLE_SAVE_PREFIX}eyJ.a.b`;
    expect(validateHandoffView({ ...body, google: { saveUrl } }, FIXED_ID)?.googleSaveUrl).toBe(
      saveUrl,
    );
    for (const google of [{ saveUrl, saveUrls: [saveUrl] }, { saveUrls: [saveUrl] }, {}, 'x', []]) {
      expect(validateHandoffView({ ...body, google }, FIXED_ID)).toBeNull();
    }
  });
});

describe('Property 4: Hand-off view validation is all or nothing', () => {
  // Feature: showcase-site, Property 4: Hand-off view validation is all or nothing
  test('any body built from the schema for the same id is accepted unchanged', () => {
    fc.assert(
      fc.property(
        idArb.chain((id) => fc.tuple(fc.constant(id), bodyArb(id))),
        ([id, body]) => {
          const result = validateHandoffView(body, id);
          expect(result).not.toBeNull();
          expect(result?.sessions).toEqual(body.sessions);
          expect(result?.expiresAt).toBe(body.expiresAt);
          expect(result?.appleBundles.map((b) => b.path)).toEqual(body.apple.bundlePaths);
          expect(result?.googleSaveUrl).toBe(body.google?.saveUrl ?? null);
          expect(result?.calendarPath).toBe(body.calendarPath);
        },
      ),
      { numRuns: 200 },
    );
  });

  type Mutator = (body: WireBody, id: HandoffId, pick: number) => unknown;
  const first = (body: WireBody): WireBody['sessions'][number] =>
    body.sessions[0] as WireBody['sessions'][number];
  const topKeys = ['expiresAt', 'sessions', 'apple', 'google', 'calendarPath'] as const;
  const mutators: Record<string, Mutator> = {
    missingTopField: (b, _id, pick) => {
      const c = clone(b) as unknown as Record<string, unknown>;
      delete c[topKeys[pick % topKeys.length] as string];
      return c;
    },
    extraTopField: (b) => ({ ...clone(b), extra: 1 }),
    expiresAtNumber: (b) => ({ ...clone(b), expiresAt: 1796062800000 }),
    expiresAtNoOffset: (b) => ({ ...clone(b), expiresAt: '2026-11-30T10:15:00' }),
    expiresAtNotReal: (b) => ({ ...clone(b), expiresAt: '2026-02-30T10:15:00Z' }),
    expiresAtHour24: (b) => ({ ...clone(b), expiresAt: '2026-02-28T24:00:00Z' }),
    noSessions: (b) => ({ ...clone(b), sessions: [], apple: { bundlePaths: [] } }),
    tooManySessions: (b) => ({
      ...clone(b),
      sessions: Array.from({ length: MAX_SESSIONS + 1 }, () => first(b)),
      apple: { bundlePaths: [] },
    }),
    sessionExtraField: (b) => ({ ...clone(b), sessions: [{ ...first(b), extra: 1 }] }),
    sessionMissingField: (b, _id, pick) => {
      const keys = [
        'serialNumber',
        'sessionCode',
        'title',
        'startsAt',
        'applePath',
        'googleSaveUrl',
        'calendarPath',
      ] as const;
      const s: Record<string, unknown> = { ...first(b) };
      delete s[keys[pick % keys.length] as string];
      return { ...clone(b), sessions: [s] };
    },
    serialNotUuid: (b) => ({
      ...clone(b),
      sessions: [{ ...first(b), serialNumber: 'not-a-uuid' }],
    }),
    sessionStartsNoOffset: (b) => ({
      ...clone(b),
      sessions: [{ ...first(b), startsAt: '2026-11-30T10:30:00' }],
    }),
    titleNumber: (b) => ({ ...clone(b), sessions: [{ ...first(b), title: 5 }] }),
    sessionNotObject: (b) => ({ ...clone(b), sessions: ['x'] }),
    bundleOtherId: (b) => ({
      ...clone(b),
      apple: {
        bundlePaths: [
          `/api/v1/handoffs/${idFromBytes(Uint8Array.from({ length: 16 }, (_, i) => (i + 1) * 3))}/apple/0`,
        ],
      },
    }),
    bundleOutOfOrder: (b, id) => ({
      ...clone(b),
      sessions: Array.from({ length: 20 }, () => first(b)),
      apple: {
        bundlePaths: [`/api/v1/handoffs/${id}/apple/1`, `/api/v1/handoffs/${id}/apple/0`],
      },
    }),
    tooManyBundles: (b, id) => ({
      ...clone(b),
      apple: {
        bundlePaths: Array.from(
          { length: Math.ceil(b.sessions.length / 10) + 1 },
          (_, i) => `/api/v1/handoffs/${id}/apple/${String(i)}`,
        ),
      },
    }),
    bundleExtraField: (b) => ({ ...clone(b), apple: { bundlePaths: [], extra: 1 } }),
    bundleNotArray: (b) => ({ ...clone(b), apple: { bundlePaths: 'x' } }),
    appleNotObject: (b) => ({ ...clone(b), apple: [] }),
    calendarOtherId: (b) => ({
      ...clone(b),
      calendarPath: `/api/v1/handoffs/${idFromBytes(new Uint8Array(16).fill(9))}/calendar.ics`,
    }),
    calendarWrongPath: (b, id) => ({
      ...clone(b),
      calendarPath: `/api/v1/handoffs/${id}/calendar.ics?x=1`,
    }),
    calendarAbsolute: (b, id) => ({
      ...clone(b),
      calendarPath: `https://evil.invalid/api/v1/handoffs/${id}/calendar.ics`,
    }),
    calendarNumber: (b) => ({ ...clone(b), calendarPath: 1 }),
    googleHttp: (b) => ({
      ...clone(b),
      google: { saveUrl: 'http://pay.google.com/gp/v/save/abc' },
    }),
    googleHost: (b) => ({
      ...clone(b),
      google: { saveUrl: 'https://pay.google.com.evil.invalid/gp/v/save/abc' },
    }),
    googlePath: (b) => ({
      ...clone(b),
      google: { saveUrl: 'https://pay.google.com/gp/v/other/abc' },
    }),
    googleUserInfo: (b) => ({
      ...clone(b),
      google: { saveUrl: 'https://user:pw@pay.google.com/gp/v/save/abc' },
    }),
    googlePort: (b) => ({
      ...clone(b),
      google: { saveUrl: 'https://pay.google.com:444/gp/v/save/abc' },
    }),
    googleExtraField: (b) => ({
      ...clone(b),
      google: { saveUrl: `${GOOGLE_SAVE_PREFIX}eyJ.a.b`, extra: 1 },
    }),
    googleSaveUrlsKept: (b) => ({
      ...clone(b),
      google: {
        saveUrl: `${GOOGLE_SAVE_PREFIX}eyJ.a.b`,
        saveUrls: [`${GOOGLE_SAVE_PREFIX}eyJ.a.b`],
      },
    }),
    googleNotString: (b) => ({ ...clone(b), google: { saveUrl: 5 } }),
    sessionApplePathOtherSerial: (b, id) => ({
      ...clone(b),
      sessions: [{ ...first(b), applePath: applePathOf(id, UNRELATED_SERIAL) }],
    }),
    sessionCalendarPathOtherId: (b) => ({
      ...clone(b),
      sessions: [
        {
          ...first(b),
          calendarPath: calendarPathOf(
            idFromBytes(new Uint8Array(16).fill(9)),
            first(b).serialNumber,
          ),
        },
      ],
    }),
    sessionCalendarPathNoSuffix: (b, id) => ({
      ...clone(b),
      sessions: [
        { ...first(b), calendarPath: `/api/v1/handoffs/${id}/calendar/${first(b).serialNumber}` },
      ],
    }),
    sessionGoogleForeignHost: (b) => ({
      ...clone(b),
      sessions: [{ ...first(b), googleSaveUrl: 'https://pay.google.com.evil.invalid/gp/v/save/a' }],
    }),
    sessionGoogleNotString: (b) => ({
      ...clone(b),
      sessions: [{ ...first(b), googleSaveUrl: 5 }],
    }),
    googleNotObject: (b) => ({ ...clone(b), google: 'x' }),
  };

  test('any single mutation is refused as a whole', () => {
    fc.assert(
      fc.property(
        idArb.chain((id) => fc.tuple(fc.constant(id), bodyArb(id))),
        fc.constantFrom(...Object.keys(mutators)),
        fc.nat(),
        ([id, body], name, pick) => {
          const mutate = mutators[name] as Mutator;
          expect(validateHandoffView(mutate(body, id, pick), id), name).toBeNull();
        },
      ),
      { numRuns: 600 },
    );
  });
});
