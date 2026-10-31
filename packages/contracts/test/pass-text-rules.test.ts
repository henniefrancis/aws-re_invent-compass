import { describe, expect, test } from 'vitest';
import { createPassFieldsSchema, normalisePassText } from '../src/index.js';

// Unit tests for the refined PassFields text rules and the normalisePassText helper
// (foundation-contracts, S0, build plan section 5.3).
//
// The text rule is an ALLOWLIST: a free-text value is valid only when every character is
// a Unicode letter, combining mark or digit, a space, or one of the basic punctuation
// marks . , : ; ' " ! ? ( ) & / + # @ -. On top of that, anything that looks like a URL
// (contains "://"), a www host, or a bare domain token is rejected, with a short
// allowlist of technology tokens (Node.js, ASP.NET and friends) that contain a dot but
// are not domains.

// The fixed event window from the task brief. No date is hard-coded in the contract; the
// window is supplied here only to build a schema instance to test.
const PASS_WINDOW = {
  start: '2026-11-30T00:00:00-08:00',
  end: '2026-12-05T00:00:00-08:00',
  timezone: 'America/Los_Angeles',
} as const;

const PassFieldsSchema = createPassFieldsSchema(PASS_WINDOW);

// A valid base pass value whose only varying part in these tests is the title. The time
// window values are fixed inside the event window.
const BASE = {
  sessionCode: 'AIM101',
  title: 'Valid title',
  venue: 'Venetian',
  room: 'Room 101',
  startsAt: '2026-12-01T09:00:00-08:00',
  endsAt: '2026-12-01T10:00:00-08:00',
} as const;

// Parse BASE with a replacement title and report whether it was accepted.
function titleAccepted(title: string): boolean {
  return PassFieldsSchema.safeParse({ ...BASE, title }).success;
}

describe('Feature: foundation-contracts, PassFields text allowlist', () => {
  // ------------------------------------------------------------------------------
  // A. Allowlist ACCEPTS typical titles with allowed punctuation, letters, digits,
  // combining marks and the allowed tech tokens.
  // ------------------------------------------------------------------------------
  test('A: accepts typical titles with allowed punctuation and characters', () => {
    const accepted = [
      'Reserve, board, and go!',
      'Q&A: planning (part 1)',
      'C# and F# on .NET',
      'AI/ML deep dive',
      're:Invent 2026',
      'email@domain is not shown',
      'Scale up: +5 nodes & more',
      "It's a plan; stick to it.",
      'Ask "why" first',
      // An accented name using a real combining mark: "Jose" with a combining acute on e
      // and "Munoz" with a combining tilde on n.
      'Jose\u0301 Mun\u0303oz',
    ];
    for (const title of accepted) {
      expect(titleAccepted(title), `expected to accept: ${JSON.stringify(title)}`).toBe(true);
    }
  });

  test('A: accepts the allowed technology tokens in realistic titles', () => {
    const accepted = [
      'Building with Node.js on AWS Lambda',
      'Vue.js front ends',
      'Next.js and Nuxt.js',
      'Express.js services',
      'Three.js and D3.js',
      'Modernize ASP.NET Core apps',
      'ADO.NET and VB.NET',
    ];
    for (const title of accepted) {
      expect(titleAccepted(title), `expected to accept: ${JSON.stringify(title)}`).toBe(true);
    }
  });

  // ------------------------------------------------------------------------------
  // B. Allowlist REJECTS: zero-width, C1 controls, line and paragraph separators,
  // C0 controls and DEL, bidi controls and marks, and symbols outside the set.
  // ------------------------------------------------------------------------------
  test('B: rejects characters outside the allowlist', () => {
    const rejected: Array<[string, string]> = [
      ['zero-width space', 'tab\u200Bbreak'],
      ['zero-width non-joiner', 'tab\u200Cbreak'],
      ['zero-width joiner', 'tab\u200Dbreak'],
      ['word joiner', 'tab\u2060break'],
      ['byte order mark', 'tab\uFEFFbreak'],
      ['C1 next line', 'tab\u0085break'],
      ['C1 start', 'tab\u0080break'],
      ['C1 end', 'tab\u009Fbreak'],
      ['line separator', 'tab\u2028break'],
      ['paragraph separator', 'tab\u2029break'],
      ['C0 control', 'tab\u0001break'],
      ['DEL', 'tab\u007Fbreak'],
      ['bidi override RLO', 'flip\u202Eexe'],
      ['bidi embedding LRE', 'embed\u202Atext'],
      ['bidi isolate LRI', 'isolate\u2066text'],
      ['LTR mark', 'mark\u200Etext'],
      ['RTL mark', 'mark\u200Ftext'],
      ['sun symbol', 'weather \u2600 today'],
      ['box drawing', 'line \u2500 here'],
    ];
    for (const [label, title] of rejected) {
      expect(titleAccepted(title), `expected to reject (${label})`).toBe(false);
    }
  });

  // ------------------------------------------------------------------------------
  // C. URL and domain REJECTS. A dotted token is a domain only when its last label
  // is a known TLD (a curated gTLD set plus every two-letter country code).
  // ------------------------------------------------------------------------------
  test('C: rejects URLs and real domains', () => {
    const rejected = [
      'http://x',
      'https://x/y',
      'see www.example',
      'example.com',
      'evil.co.za',
      'foo.bar.io',
      // A Unicode (non-ASCII) host is caught because labels are matched with the u
      // flag. "пример" + ".com" ends in a known TLD.
      '\u043F\u0440\u0438\u043C\u0435\u0440.com',
      // A fully qualified name with a trailing dot is still a domain.
      'example.com.',
      // IPv4 addresses, with and without a port.
      '192.168.0.1',
      'go to 10.0.0.1:8080 now',
      // A subdomain with a known TLD.
      'api.service.io',
    ];
    for (const title of rejected) {
      expect(titleAccepted(title), `expected to reject: ${JSON.stringify(title)}`).toBe(false);
    }
  });

  // ------------------------------------------------------------------------------
  // C2. Dotted technical phrases whose last label is NOT a known TLD are allowed,
  // reducing false positives.
  // ------------------------------------------------------------------------------
  test('C2: dotted non-domain phrases are allowed', () => {
    const accepted = [
      'AWS.Lambda deep dive',
      'S3.Express One Zone',
      // "example" and "js" are not known TLDs, so these are not domains.
      'visit shop.example',
      'Try mynode.js today',
    ];
    for (const title of accepted) {
      expect(titleAccepted(title), `expected to accept: ${JSON.stringify(title)}`).toBe(true);
    }
  });

  // ------------------------------------------------------------------------------
  // D. Tech tokens pass while real domains still fail.
  // ------------------------------------------------------------------------------
  test('D: tech tokens pass, real domains do not', () => {
    // The lone token passes.
    expect(titleAccepted('Node.js')).toBe(true);
    // A real domain embedded in otherwise allowed text still fails ("io" is a gTLD).
    expect(titleAccepted('visit shop.io')).toBe(false);
  });
});

describe('Feature: foundation-contracts, normalisePassText', () => {
  // ------------------------------------------------------------------------------
  // E. normalisePassText maps typographic punctuation and collapses whitespace.
  // ------------------------------------------------------------------------------
  test('E: maps dashes, quotes and ellipsis to ASCII', () => {
    // En dash and em dash both become a hyphen.
    expect(normalisePassText('nine\u2013ten')).toBe('nine-ten');
    expect(normalisePassText('nine\u2014ten')).toBe('nine-ten');
    // Curly single and double quotes become straight.
    expect(normalisePassText('\u2018hello\u2019')).toBe("'hello'");
    expect(normalisePassText('\u201Chello\u201D')).toBe('"hello"');
    // The prime and double prime also normalise.
    expect(normalisePassText('5\u2032 by 6\u2033')).toBe('5\' by 6"');
    // The ellipsis becomes three ASCII dots.
    expect(normalisePassText('wait\u2026')).toBe('wait...');
  });

  test('E: collapses mixed whitespace and trims', () => {
    expect(normalisePassText('  a\u00A0\u00A0b\n\tc  ')).toBe('a b c');
  });

  test('E: a vertical bar becomes a comma, so a real catalog room is accepted', () => {
    // The raw room, as the catalog writes it, fails the allowlist.
    const raw = 'Level 1 | Academy 409';
    expect(PassFieldsSchema.safeParse({ ...BASE, room: raw }).success).toBe(false);

    const normalised = normalisePassText(raw);
    expect(normalised).toBe('Level 1, Academy 409');
    const result = PassFieldsSchema.safeParse({ ...BASE, room: normalised });
    expect(result.success).toBe(true);
    expect(result.data?.room).toBe('Level 1, Academy 409');
  });

  test('E: bare, repeated and edge vertical bars', () => {
    expect(normalisePassText('Level 1|Academy 409')).toBe('Level 1, Academy 409');
    expect(normalisePassText('a || b | | c')).toBe('a, b, c');
    expect(normalisePassText(' | Level 1 | ')).toBe('Level 1');
    expect(normalisePassText('|')).toBe('');
    expect(normalisePassText('Level\u00A01\u00A0|\nAcademy')).toBe('Level 1, Academy');
  });

  test('E: a title failing on a curly quote or em dash passes after normalisation', () => {
    // A raw title with a curly apostrophe and an em dash fails the allowlist directly.
    const raw = 'It\u2019s a plan \u2014 reserve, board, and go';
    expect(titleAccepted(raw)).toBe(false);

    // After normalisation it becomes allowlist-safe and parses successfully as a title.
    const normalised = normalisePassText(raw);
    expect(normalised).toBe("It's a plan - reserve, board, and go");
    const result = PassFieldsSchema.safeParse({ ...BASE, title: normalised });
    expect(result.success).toBe(true);
  });
});

describe('Feature: foundation-contracts, createPassFieldsSchema window validation', () => {
  // The factory fails fast on a malformed event window, which is a caller bug.
  test('throws when start does not parse', () => {
    expect(() =>
      createPassFieldsSchema({ start: 'not a date', end: PASS_WINDOW.end, timezone: 'UTC' }),
    ).toThrow(/start is not a valid date/);
  });

  test('throws when end does not parse', () => {
    expect(() =>
      createPassFieldsSchema({ start: PASS_WINDOW.start, end: 'not a date', timezone: 'UTC' }),
    ).toThrow(/end is not a valid date/);
  });

  test('throws when end is not after start', () => {
    expect(() =>
      createPassFieldsSchema({ start: PASS_WINDOW.end, end: PASS_WINDOW.start, timezone: 'UTC' }),
    ).toThrow(/end must be after start/);
    // Equal bounds are also rejected.
    expect(() =>
      createPassFieldsSchema({ start: PASS_WINDOW.start, end: PASS_WINDOW.start, timezone: 'UTC' }),
    ).toThrow(/end must be after start/);
  });

  test('accepts a valid window', () => {
    expect(() => createPassFieldsSchema(PASS_WINDOW)).not.toThrow();
  });
});
