// Shared fast-check arbitraries and fakes for the catalog tests (events-client, S1).
// Holds no tests.

import fc from 'fast-check';
import { SessionWireSchema, type SessionWire } from '@compass/contracts';
import type { FsLike } from '../../src/catalog/cache.js';

const textArb = fc.string({ minLength: 1, maxLength: 24 });
const codeArb = fc.stringMatching(/^[A-Z]{3}[0-9]{3}$/);

/** A date string that is usually valid but sometimes malformed or impossible. */
export const dateArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .date({ min: new Date('2026-01-01'), max: new Date('2026-12-31'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10)),
  },
  { weight: 1, arbitrary: fc.constantFrom('2026-02-31', '2026-13-01', 'bad', '', '26-11-30') },
);

/** A clock time that is usually valid but sometimes malformed. */
export const timeArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
  },
  { weight: 1, arbitrary: fc.constantFrom('25:00', '12:60', 'noon', '', '9:5') },
);

/** A length in minutes that is usually valid but sometimes malformed. */
export const lengthArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 600 }).map(String) },
  { weight: 1, arbitrary: fc.constantFrom('abc', '-5', '', '1.5', '123456') },
);

export const ZONES = ['America/Los_Angeles', 'Europe/London', 'Asia/Calcutta', 'UTC'] as const;

export const zoneArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...ZONES) },
  { weight: 1, arbitrary: fc.constantFrom('Not/AZone', '') },
);

const opt = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> =>
  fc.option(arb, { nil: undefined });

/** A wire session with every optional field present or absent at random. */
export const wireArb: fc.Arbitrary<SessionWire> = fc
  .record(
    {
      sessionId: fc.stringMatching(/^[a-z0-9-]{3,12}$/),
      title: textArb,
      abbreviation: opt(
        fc.oneof(
          codeArb,
          codeArb.map((c) => `${c}-R`),
          codeArb.map((c) => `${c}-R2`),
          codeArb.map((c) => `${c}-R22`),
        ),
      ),
      abstract: opt(textArb),
      type: opt(fc.constantFrom('Workshop', 'Chalk talk', 'Breakout session')),
      level: opt(fc.constantFrom('100', '200', '300', '400')),
      venue: opt(fc.constantFrom('Venetian', 'Wynn', 'MGM Grand')),
      room: opt(
        fc.constantFrom(
          'Venetian | Level 2 | Room 102',
          'Room 115',
          'Wynn Ballroom',
          'Unknown Hall',
        ),
      ),
      isAllDaySession: opt(fc.boolean()),
      isReservable: opt(fc.boolean()),
      seatAvailability: opt(
        fc.constantFrom('available', 'limited', 'veryLimited', 'unavailable', 'walkUp', 'weird'),
      ),
      sessionTime: opt(
        fc.record({
          date: opt(dateArb),
          time: opt(timeArb),
          length: opt(lengthArb),
          timezone: opt(zoneArb),
        }),
      ),
      services: opt(fc.array(fc.constantFrom('s3', 'lambda', 'networking'), { maxLength: 3 })),
      topics: opt(fc.array(fc.constantFrom('ai', 'security', 'cost'), { maxLength: 3 })),
    },
    { requiredKeys: ['sessionId', 'title'] },
  )
  .map((raw) => SessionWireSchema.parse(raw));

/** An in-memory FsLike with failure injection and a record of every call. */
export interface FakeFs extends FsLike {
  files: Map<string, string>;
  modes: Map<string, number>;
  /** Modification times in epoch milliseconds; missing means 0. */
  mtimes: Map<string, number>;
  /** Directories that are symlinks or junctions. */
  links: Set<string>;
  /** Reported file sizes that override the real length. */
  sizes: Map<string, number>;
  dirs: { path: string; mode: number }[];
  calls: string[];
  failOn: Set<'mkdir' | 'write' | 'rename' | 'rm' | 'read' | 'lstat' | 'stat' | 'readdir'>;
}

export function fakeFs(): FakeFs {
  const fs: FakeFs = {
    files: new Map(),
    modes: new Map(),
    mtimes: new Map(),
    links: new Set(),
    sizes: new Map(),
    dirs: [],
    calls: [],
    failOn: new Set(),
    mkdirSync(path, options) {
      fs.calls.push(`mkdir ${path}`);
      if (fs.failOn.has('mkdir')) {
        throw new Error('mkdir failed');
      }
      fs.dirs.push({ path, mode: options.mode });
    },
    writeFileSync(path, data, options) {
      fs.calls.push(`write ${path} ${options.flag}`);
      if (fs.failOn.has('write') || fs.files.has(path)) {
        throw new Error('write failed');
      }
      fs.files.set(path, data);
      fs.modes.set(path, options.mode);
    },
    renameSync(from, to) {
      fs.calls.push(`rename ${from} ${to}`);
      if (fs.failOn.has('rename')) {
        throw new Error('rename failed');
      }
      const data = fs.files.get(from);
      if (data === undefined) {
        throw new Error('missing source');
      }
      fs.files.set(to, data);
      fs.modes.set(to, fs.modes.get(from) ?? 0);
      fs.files.delete(from);
    },
    readFileSync(path) {
      fs.calls.push(`read ${path}`);
      const data = fs.files.get(path);
      if (fs.failOn.has('read') || data === undefined) {
        throw new Error('read failed');
      }
      return data;
    },
    rmSync(path) {
      fs.calls.push(`rm ${path}`);
      if (fs.failOn.has('rm')) {
        throw new Error('rm failed');
      }
      fs.files.delete(path);
    },
    lstatSync(path) {
      fs.calls.push(`lstat ${path}`);
      if (fs.failOn.has('lstat')) {
        throw new Error('ENOENT');
      }
      return { isSymbolicLink: () => fs.links.has(path) };
    },
    statSync(path) {
      fs.calls.push(`stat ${path}`);
      const data = fs.files.get(path);
      if (fs.failOn.has('stat') || data === undefined) {
        throw new Error('stat failed');
      }
      return { size: fs.sizes.get(path) ?? data.length, mtimeMs: fs.mtimes.get(path) ?? 0 };
    },
    readdirSync() {
      fs.calls.push('readdir');
      if (fs.failOn.has('readdir')) {
        throw new Error('readdir failed');
      }
      return [...fs.files.keys()].map((p) => p.slice(p.lastIndexOf('/') + 1));
    },
  };
  return fs;
}
