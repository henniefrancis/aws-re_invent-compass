import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { ProblemError } from '../../src/http/problem.js';
import {
  DEVICE_REGISTRATION_SHAPE,
  HANDOFF_REQUEST_SHAPE,
  ISSUE_REQUEST_SHAPE,
  LOG_ENTRIES_SHAPE,
  MAX_BODY_BYTES,
  PASS_FIELDS_SHAPE,
  assertKnownKeys,
  parseHandoffRequest,
  parseIssueRequest,
  parseJsonBody,
  parseLogBody,
  parsePassFields,
  parseRegistrationBody,
  type KeyShape,
} from '../../src/validation/request-schemas.js';
import { buildEvent } from '../helpers/proxy-event.js';
import { loadContractTree, schemaKeys } from '../helpers/openapi-reader.js';
import {
  TEST_WINDOW,
  isoWithOffset,
  passFieldsArb,
  passFieldsSchema,
  samplePassFields,
} from '../helpers/pass-fields.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = 'abcdefab-1234-4abc-8abc-abcdefabcdef';

function eventWithBody(body: unknown, isBase64Encoded = false) {
  return buildEvent({ method: 'POST', resource: '/x', body, isBase64Encoded });
}

function refusal(run: () => unknown): ProblemError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemError);
    return error as ProblemError;
  }
  throw new Error('expected a refusal');
}

function expect400(run: () => unknown): void {
  const error = refusal(run);
  expect([error.status, error.code]).toEqual([400, 'invalid_request']);
}

describe('Feature: pass-service, key shapes follow the contract', () => {
  const tree = loadContractTree();
  const sorted = (keys: readonly string[]) => [...keys].sort();

  test('every shape lists exactly the properties the contract defines', () => {
    expect(sorted(PASS_FIELDS_SHAPE.keys)).toEqual(sorted(schemaKeys(tree, 'PassFields')));
    expect(sorted(PASS_FIELDS_SHAPE.children?.walkFromPrevious?.keys ?? [])).toEqual(
      sorted(schemaKeys(tree, 'PassFields', 'walkFromPrevious')),
    );
    expect(sorted(PASS_FIELDS_SHAPE.children?.nextConnection?.keys ?? [])).toEqual(
      sorted(schemaKeys(tree, 'PassFields', 'nextConnection')),
    );
    expect(sorted(ISSUE_REQUEST_SHAPE.keys)).toEqual(
      sorted(schemaKeys(tree, 'IssuePassesRequest')),
    );
    expect(sorted(HANDOFF_REQUEST_SHAPE.keys)).toEqual(
      sorted(schemaKeys(tree, 'CreateHandoffRequest')),
    );
    expect(sorted(HANDOFF_REQUEST_SHAPE.children?.include?.keys ?? [])).toEqual(
      sorted(schemaKeys(tree, 'CreateHandoffRequest', 'include')),
    );
    expect(sorted(DEVICE_REGISTRATION_SHAPE.keys)).toEqual(
      sorted(schemaKeys(tree, 'DeviceRegistration')),
    );
    expect(sorted(LOG_ENTRIES_SHAPE.keys)).toEqual(sorted(schemaKeys(tree, 'LogEntries')));
  });
});

describe('Feature: pass-service, JSON body reading', () => {
  test('a valid body parses, including a base64 flagged one', () => {
    expect(parseJsonBody(eventWithBody('{"a":1}'))).toEqual({ a: 1 });
    const encoded = Buffer.from('{"a":2}').toString('base64');
    expect(parseJsonBody(eventWithBody(encoded, true))).toEqual({ a: 2 });
  });

  test('empty, null, invalid, base64 non-JSON and oversized bodies are all the same 400', () => {
    expect400(() => parseJsonBody(buildEvent({ method: 'POST', resource: '/x' })));
    expect400(() => parseJsonBody(eventWithBody('')));
    expect400(() => parseJsonBody(eventWithBody('{not json')));
    expect400(() => parseJsonBody(eventWithBody(Buffer.from('nope').toString('base64'), true)));
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect400(() => parseJsonBody(eventWithBody(big)));
    const justUnder = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES - 20) });
    expect(() => parseJsonBody(eventWithBody(justUnder))).not.toThrow();
  });
});

describe('Feature: pass-service, unknown keys', () => {
  const shape: KeyShape = {
    keys: ['a', 'child', 'list'],
    children: { child: { keys: ['b'] } },
    lists: { list: { keys: ['c'] } },
  };

  test('known keys pass and an unknown key is refused at any depth', () => {
    expect(() => assertKnownKeys({ a: 1, child: { b: 2 }, list: [{ c: 3 }] }, shape)).not.toThrow();
    expect400(() => assertKnownKeys({ a: 1, z: 1 }, shape));
    expect400(() => assertKnownKeys({ child: { b: 2, z: 1 } }, shape));
    expect400(() => assertKnownKeys({ list: [{ c: 1 }, { z: 1 }] }, shape));
    expect400(() => assertKnownKeys(JSON.parse('{"__proto__": {"x": 1}}'), shape));
    expect400(() => assertKnownKeys({ constructor: 1 }, shape));
  });

  test('non-objects and wrongly typed nested values are left to the schema', () => {
    for (const value of [null, 1, 'x', [], [{ z: 1 }]]) {
      expect(() => assertKnownKeys(value, shape)).not.toThrow();
    }
    expect(() => assertKnownKeys({ child: 'x', list: 'y' }, shape)).not.toThrow();
  });
});

describe('Feature: pass-service, PassFields rejection', () => {
  const refused: [string, Record<string, unknown>][] = [
    ['a URL', { title: 'See https://example.test now' }],
    ['a bare domain', { title: 'Visit example.com today' }],
    ['a bidirectional override (U+202E)', { title: `Safe${String.fromCharCode(0x202e)}gnp` }],
    ['a control character', { room: `Room${String.fromCharCode(7)}1` }],
    [
      'an out-of-window date',
      { startsAt: '2027-03-01T10:00:00-08:00', endsAt: '2027-03-01T11:00:00-08:00' },
    ],
    ['an 81-character title', { title: 'x'.repeat(81) }],
    ['a 41-character venue', { venue: 'v'.repeat(41) }],
    ['an empty title', { title: '' }],
    ['endsAt before startsAt', { endsAt: '2026-12-02T09:00:00-08:00' }],
    ['a session over ten hours', { endsAt: '2026-12-02T20:30:00-08:00' }],
    ['a bad session code', { sessionCode: 'dat302' }],
    ['an unknown key', { extra: 'x' }],
    ['a server-derived field', { sharingProhibited: false }],
  ];

  test.each(refused)('%s is the same 400', (_name, change) => {
    expect400(() => parsePassFields(samplePassFields(change), TEST_WINDOW));
  });

  test('a 60,000 digit fraction is refused quickly', () => {
    const digits = '9'.repeat(60_000);
    const start = Date.now();
    expect400(() =>
      parsePassFields(
        samplePassFields({ startsAt: `2026-12-02T10:00:00.${digits}-08:00` }),
        TEST_WINDOW,
      ),
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('a valid value comes back exactly as sent, and nothing is trimmed', () => {
    const fields = samplePassFields({ attendeeName: 'Sam', title: 'Data Lakes' });
    expect(parsePassFields(fields, TEST_WINDOW)).toEqual(fields);
    const padded = samplePassFields({ title: ' padded ' });
    expect(parsePassFields(padded, TEST_WINDOW).title).toBe(' padded ');
  });

  test('the schema is built once per window object', () => {
    expect(parsePassFields(samplePassFields(), TEST_WINDOW)).toBeDefined();
    expect(parsePassFields(samplePassFields(), { ...TEST_WINDOW })).toBeDefined();
  });
});

describe('Feature: pass-service, issue request', () => {
  const pass = (code: string) => samplePassFields({ sessionCode: code });

  test('valid requests parse in order', () => {
    const body = { platforms: ['apple', 'google'], passes: [pass('AAA101'), pass('BBB202')] };
    expect(parseIssueRequest(body, TEST_WINDOW)).toEqual(body);
  });

  test('platform, list and duplicate rules', () => {
    const one = [pass('AAA101')];
    expect400(() => parseIssueRequest({ platforms: [], passes: one }, TEST_WINDOW));
    expect400(() => parseIssueRequest({ platforms: ['apple', 'apple'], passes: one }, TEST_WINDOW));
    expect400(() =>
      parseIssueRequest({ platforms: ['apple', 'google', 'apple'], passes: one }, TEST_WINDOW),
    );
    expect400(() => parseIssueRequest({ platforms: ['ios'], passes: one }, TEST_WINDOW));
    expect400(() => parseIssueRequest({ platforms: ['apple'], passes: [] }, TEST_WINDOW));
    const many = Array.from({ length: 26 }, (_, i) => pass(`AAA${String(100 + i)}`));
    expect400(() => parseIssueRequest({ platforms: ['apple'], passes: many }, TEST_WINDOW));
    expect(() =>
      parseIssueRequest({ platforms: ['apple'], passes: many.slice(0, 25) }, TEST_WINDOW),
    ).not.toThrow();
    expect400(() =>
      parseIssueRequest(
        { platforms: ['apple'], passes: [pass('AAA101'), pass('AAA101')] },
        TEST_WINDOW,
      ),
    );
    expect400(() => parseIssueRequest({ platforms: ['apple'], passes: one, x: 1 }, TEST_WINDOW));
    expect400(() =>
      parseIssueRequest(
        { platforms: ['apple'], passes: [{ ...pass('AAA101'), x: 1 }] },
        TEST_WINDOW,
      ),
    );
    expect400(() => parseIssueRequest('nope', TEST_WINDOW));
  });
});

describe('Feature: pass-service, hand-off, registration and log bodies', () => {
  const include = { apple: true, google: false, calendar: false };

  test('hand-off requests', () => {
    expect(parseHandoffRequest({ serialNumbers: [UUID_A, UUID_B], include })).toEqual({
      serialNumbers: [UUID_A, UUID_B],
      include,
    });
    expect400(() => parseHandoffRequest({ serialNumbers: [], include }));
    expect400(() => parseHandoffRequest({ serialNumbers: [UUID_A, UUID_A], include }));
    expect400(() => parseHandoffRequest({ serialNumbers: ['nope'], include }));
    expect400(() => parseHandoffRequest({ serialNumbers: [UUID_C.toUpperCase()], include }));
    expect400(() =>
      parseHandoffRequest({
        serialNumbers: [UUID_A],
        include: { apple: false, google: false, calendar: false },
      }),
    );
    expect400(() => parseHandoffRequest({ serialNumbers: [UUID_A], include, extra: 1 }));
    expect400(() =>
      parseHandoffRequest({ serialNumbers: [UUID_A], include: { ...include, extra: true } }),
    );
    const eighty = Array.from(
      { length: 80 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(() => parseHandoffRequest({ serialNumbers: eighty, include })).not.toThrow();
    expect400(() =>
      parseHandoffRequest({
        serialNumbers: [...eighty, '00000000-0000-4000-8000-999999999999'],
        include,
      }),
    );
  });

  test('registration bodies: a good token passes, everything else is the 401', () => {
    expect(parseRegistrationBody(eventWithBody({ pushToken: 'aAbB09' }))).toEqual({
      pushToken: 'aAbB09',
    });
    expect(
      parseRegistrationBody(eventWithBody({ pushToken: 'f'.repeat(256) })).pushToken,
    ).toHaveLength(256);
    const bad: unknown[] = [
      { pushToken: '' },
      { pushToken: 'g1' },
      { pushToken: 'f'.repeat(257) },
      { pushToken: 12 },
      {},
      { pushToken: 'aa', extra: 1 },
      '{not json',
      '',
    ];
    for (const body of bad) {
      const error = refusal(() => parseRegistrationBody(eventWithBody(body)));
      expect([error.status, error.code]).toEqual([401, 'unauthorized']);
    }
    const missing = refusal(() =>
      parseRegistrationBody(buildEvent({ method: 'POST', resource: '/x' })),
    );
    expect(missing.status).toBe(401);
  });

  test('log bodies return only a count and never fail', () => {
    expect(parseLogBody(eventWithBody({ logs: ['a', 'b', 'c'] }))).toEqual({ count: 3 });
    expect(parseLogBody(eventWithBody({ logs: [] }))).toEqual({ count: 0 });
    for (const body of [{ logs: [1] }, { logs: 'x' }, {}, { logs: ['a'], x: 1 }, '{bad', '']) {
      expect(parseLogBody(eventWithBody(body))).toEqual({ count: 0 });
    }
    expect(parseLogBody(buildEvent({ method: 'POST', resource: '/x' }))).toEqual({ count: 0 });
  });
});

// Feature: pass-service, Property 10: PassFields acceptance equals the shared schema plus strictness
describe('Feature: pass-service, Property 10', () => {
  const contractKeys = (() => {
    const tree = loadContractTree();
    return {
      root: schemaKeys(tree, 'PassFields'),
      walk: schemaKeys(tree, 'PassFields', 'walkFromPrevious'),
      next: schemaKeys(tree, 'PassFields', 'nextConnection'),
    };
  })();

  /** An independent strictness oracle built from the contract keys. */
  function hasUnknown(value: Record<string, unknown>): boolean {
    const extra = (o: unknown, keys: string[]) =>
      typeof o === 'object' && o !== null && Object.keys(o).some((k) => !keys.includes(k));
    return (
      extra(value, contractKeys.root) ||
      extra(value.walkFromPrevious, contractKeys.walk) ||
      extra(value.nextConnection, contractKeys.next)
    );
  }

  const HOSTILE = [
    'Visit https://example.test',
    'example.com',
    `bidi${String.fromCharCode(0x202e)}text`,
    `zero${String.fromCharCode(0x200b)}width`,
    `ctrl${String.fromCharCode(1)}char`,
    'emoji \u{1F600}',
    'line\nbreak',
    '192.168.0.1',
    'Node.js on AWS',
  ];

  const mutations: ((f: Record<string, unknown>, n: number) => Record<string, unknown>)[] = [
    (f) => f,
    (f, n) => ({ ...f, title: HOSTILE[n % HOSTILE.length] }),
    (f, n) => ({ ...f, room: HOSTILE[n % HOSTILE.length] }),
    (f) => ({ ...f, venue: 'v'.repeat(41) }),
    (f) => ({ ...f, title: 'x'.repeat(81) }),
    (f) => ({ ...f, attendeeName: '' }),
    (f) => ({ ...f, extra: 1 }),
    (f) => ({ ...f, walkFromPrevious: { minutes: 5, fromVenue: '', extra: 1 } }),
    (f) => ({ ...f, nextConnection: { ...(f.nextConnection as object), extra: 1 } }),
    (f) => ({ ...f, startsAt: isoWithOffset(Date.parse('2027-01-01T00:00:00Z')) }),
    (f) => ({ ...f, endsAt: f.startsAt }),
    (f) => ({ ...f, endsAt: isoWithOffset(Date.parse(String(f.startsAt)) + 11 * 3_600_000) }),
    (f) => ({ ...f, sessionCode: 'lower1' }),
    (f) => ({ ...f, startsAt: `${String(f.startsAt).slice(0, 19)}.${'1'.repeat(9)}-08:00` }),
    (f) => ({ ...f, startsAt: `${String(f.startsAt).slice(0, 19)}.${'1'.repeat(60_000)}-08:00` }),
    (f) => {
      const copy = { ...f };
      delete copy.room;
      return copy;
    },
  ];

  test('acceptance equals the shared schema plus strictness, and refusals are one 400', () => {
    fc.assert(
      fc.property(
        passFieldsArb,
        fc.integer({ min: 0, max: mutations.length - 1 }),
        fc.nat(100),
        (fields, which, n) => {
          const candidate = mutations[which]!({ ...fields }, n);
          const expected = passFieldsSchema.safeParse(candidate).success && !hasUnknown(candidate);
          if (expected) {
            expect(parsePassFields(candidate, TEST_WINDOW)).toEqual(candidate);
          } else {
            expect400(() => parsePassFields(candidate, TEST_WINDOW));
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  test('issue requests accept exactly when platforms, counts, codes and every pass are valid', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('apple', 'google', 'ios'), { maxLength: 3 }),
        fc.array(passFieldsArb, { maxLength: 27 }),
        fc.boolean(),
        fc.boolean(),
        (platforms, passes, duplicate, unknownKey) => {
          const list: Record<string, unknown>[] = passes.map((p, i) => ({
            ...p,
            sessionCode: `AAA${String(100 + i)}`,
          }));
          if (duplicate && list.length > 1) {
            list[1] = { ...list[1], sessionCode: list[0]?.sessionCode };
          }
          if (unknownKey && list.length > 0) {
            list[0] = { ...list[0], extra: 1 };
          }
          const request = { platforms, passes: list };
          const codes = list.map((p) => p.sessionCode);
          const expected =
            platforms.length >= 1 &&
            platforms.length <= 2 &&
            platforms.every((p) => p === 'apple' || p === 'google') &&
            new Set(platforms).size === platforms.length &&
            list.length >= 1 &&
            list.length <= 25 &&
            new Set(codes).size === codes.length &&
            list.every((p) => passFieldsSchema.safeParse(p).success && !hasUnknown(p));
          if (expected) {
            expect(parseIssueRequest(request, TEST_WINDOW)).toEqual(request);
          } else {
            expect400(() => parseIssueRequest(request, TEST_WINDOW));
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
