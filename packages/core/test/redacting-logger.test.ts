import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createRedactingLogger, type LogSink } from '../src/api/redacting-logger.js';
import {
  selectTransport,
  type Transport,
  type TransportDeps,
  type EnvLike,
  type RawResponse,
} from '../src/api/transport.js';

// Property and unit tests for the redacting logger and the transport-selection seam
// (events-client, S1). The logger is Component 8: the single logging mechanism for
// the stream, and the first half of the no-secret invariant (Requirements 2.5, 7.7,
// 20.1, 20.2). The full end-to-end no-secret run is the required security test in
// task 17.1; this file proves the scrubbing mechanism itself and the selectTransport
// branch that keeps the live path out of simulated mode (Requirements 6.1, 4.4, 18.1).

const REDACTED = '[REDACTED]';

// A capturing sink so a property can inspect every line the logger emitted.
function capturingSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  const sink: LogSink = {
    info: (line) => lines.push(line),
    warn: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { sink, lines };
}

// Arbitrary opaque secret values (refresh-token shaped: long, no dots). These are
// the values a caller registers through addSecret.
const opaqueSecretArb = fc
  .string({
    minLength: 12,
    maxLength: 48,
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-'.split('')),
  })
  .filter((s) => s.length >= 12);

// Arbitrary JWT-shaped tokens: three base64url segments of length >= 8 joined by dots.
const base64urlSegmentArb = fc.string({
  minLength: 8,
  maxLength: 24,
  unit: fc.constantFrom(
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
  ),
});
const jwtArb = fc
  .tuple(base64urlSegmentArb, base64urlSegmentArb, base64urlSegmentArb)
  .map(([a, b, c]) => `${a}.${b}.${c}`);

// Arbitrary email addresses.
const emailArb = fc
  .tuple(
    fc.string({
      minLength: 1,
      maxLength: 12,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    }),
    fc.string({
      minLength: 1,
      maxLength: 10,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    }),
    fc.constantFrom('com', 'net', 'org', 'dev', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Benign filler that contains no secret shape.
const fillerArb = fc.string({
  maxLength: 20,
  unit: fc.constantFrom(...'the quick brown fox 0123456789 status ok '.split('')),
});

describe('Feature: events-client, Property 7: No secret ever appears in logs or errors (logger scrubbing)', () => {
  test('registered opaque secrets never appear in any emitted line', () => {
    fc.assert(
      fc.property(opaqueSecretArb, fillerArb, fillerArb, (secret, before, after) => {
        const { sink, lines } = capturingSink();
        const logger = createRedactingLogger(sink);
        logger.addSecret(secret);
        logger.info(`${before}${secret}${after}`);
        logger.warn(`authorization: Bearer ${secret}`);
        logger.error(`payload=${secret} done`);
        for (const line of lines) {
          expect(line).not.toContain(secret);
          expect(line).toContain(REDACTED);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('JWT-shaped tokens are scrubbed structurally even without registration', () => {
    fc.assert(
      fc.property(jwtArb, fillerArb, (jwt, filler) => {
        const { sink, lines } = capturingSink();
        const logger = createRedactingLogger(sink);
        logger.info(`id token ${jwt} ${filler}`);
        expect(lines[0]).not.toContain(jwt);
        expect(lines[0]).toContain(REDACTED);
      }),
      { numRuns: 200 },
    );
  });

  test('email addresses are scrubbed structurally', () => {
    fc.assert(
      fc.property(emailArb, fillerArb, (email, filler) => {
        const { sink, lines } = capturingSink();
        const logger = createRedactingLogger(sink);
        logger.error(`${filler} contact ${email}`);
        expect(lines[0]).not.toContain(email);
        expect(lines[0]).toContain(REDACTED);
      }),
      { numRuns: 200 },
    );
  });

  test('Authorization credentials are removed while the scheme is kept', () => {
    fc.assert(
      fc.property(opaqueSecretArb, (credential) => {
        const { sink, lines } = capturingSink();
        const logger = createRedactingLogger(sink);
        logger.info(`Authorization: Bearer ${credential}`);
        expect(lines[0]).not.toContain(credential);
        expect(lines[0]?.toLowerCase()).toContain('bearer');
        expect(lines[0]).toContain(REDACTED);
      }),
      { numRuns: 200 },
    );
  });

  test('redact is pure: it returns a scrubbed string without a registered secret', () => {
    fc.assert(
      fc.property(opaqueSecretArb, fillerArb, (secret, filler) => {
        const logger = createRedactingLogger();
        logger.addSecret(secret);
        const out = logger.redact(`${filler} ${secret} ${filler}`);
        expect(out).not.toContain(secret);
      }),
      { numRuns: 200 },
    );
  });

  test('two registered secrets are both scrubbed, longest first so overlaps collapse', () => {
    const { sink, lines } = capturingSink();
    const logger = createRedactingLogger(sink);
    const shortSecret = 'abc123';
    const longSecret = `${shortSecret}-extended-suffix-value`;
    logger.addSecret(shortSecret);
    logger.addSecret(longSecret);
    logger.info(`token ${longSecret} and ${shortSecret} end`);
    expect(lines[0]).not.toContain(shortSecret);
    expect(lines[0]).not.toContain(longSecret);
    expect(lines[0]).toBe(`token ${REDACTED} and ${REDACTED} end`);
  });

  test('removeSecret stops scrubbing a value and empty secrets are ignored', () => {
    const { sink, lines } = capturingSink();
    const logger = createRedactingLogger(sink);
    logger.addSecret('');
    logger.addSecret(undefined);
    logger.addSecret('supersecretvalue');
    logger.removeSecret('supersecretvalue');
    logger.removeSecret(undefined);
    logger.info('ordinary line with no secret');
    expect(lines[0]).toBe('ordinary line with no secret');
  });
});

describe('Feature: events-client, the default console sink redacts before writing to the console', () => {
  test('a logger with no injected sink routes redacted lines to console.info/warn/error', () => {
    const calls: Array<[string, string]> = [];
    const original = {
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    console.info = (line: string) => {
      calls.push(['info', line]);
    };
    console.warn = (line: string) => {
      calls.push(['warn', line]);
    };
    console.error = (line: string) => {
      calls.push(['error', line]);
    };
    try {
      const logger = createRedactingLogger();
      logger.addSecret('topsecrettoken');
      logger.info('info topsecrettoken');
      logger.warn('warn topsecrettoken');
      logger.error('error topsecrettoken');
    } finally {
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    }
    expect(calls).toEqual([
      ['info', `info ${REDACTED}`],
      ['warn', `warn ${REDACTED}`],
      ['error', `error ${REDACTED}`],
    ]);
  });
});

describe('Feature: events-client, selectTransport chooses the mode without touching the other path', () => {
  function spies(): {
    deps: TransportDeps;
    readCalls: () => [number, number];
  } {
    let httpCalls = 0;
    let simCalls = 0;
    const ok: RawResponse = { status: 200, headers: new Headers(), body: undefined };
    const http: Transport = { send: () => Promise.resolve(ok) };
    const sim: Transport = { send: () => Promise.resolve(ok) };
    const deps: TransportDeps = {
      createHttpTransport: () => {
        httpCalls += 1;
        return http;
      },
      createSimulatedTransport: () => {
        simCalls += 1;
        return sim;
      },
    };
    return { deps, readCalls: () => [httpCalls, simCalls] };
  }

  test('COMPASS_MODE=simulated selects the simulated transport and never builds the live one', () => {
    const s = spies();
    const transport = selectTransport({ COMPASS_MODE: 'simulated' } satisfies EnvLike, s.deps);
    expect(transport).toBeDefined();
    const [httpCalls, simCalls] = s.readCalls();
    expect(simCalls).toBe(1);
    expect(httpCalls).toBe(0);
  });

  test('an unset or other COMPASS_MODE selects the HTTP transport', () => {
    for (const env of [
      {},
      { COMPASS_MODE: 'live' },
      { COMPASS_MODE: 'Simulated' },
    ] satisfies EnvLike[]) {
      const s = spies();
      selectTransport(env, s.deps);
      const [httpCalls, simCalls] = s.readCalls();
      expect(httpCalls).toBe(1);
      expect(simCalls).toBe(0);
    }
  });
});
