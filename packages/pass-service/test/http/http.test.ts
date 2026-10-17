import { ProblemSchema } from '@compass/contracts';
import fc from 'fast-check';
import { describe, expect, test, vi } from 'vitest';
import { header, type ProxyEvent } from '../../src/http/event.js';
import {
  DependencyError,
  ProblemError,
  problem,
  type ProblemCode,
  type ProblemStatus,
} from '../../src/http/problem.js';
import { HARDENING_HEADERS, binary, empty, json, withHardening } from '../../src/http/responses.js';
import { createRouter } from '../../src/http/router.js';

const STATUSES: ProblemStatus[] = [400, 401, 403, 404, 429, 500];
const CODES: ProblemCode[] = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'not_enabled',
  'rate_limited',
  'active_pass_limit',
  'internal_error',
];
const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

function eventWith(headers: ProxyEvent['headers']): ProxyEvent {
  return {
    resource: '/x',
    httpMethod: 'GET',
    headers,
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: { requestId: 'r1' },
  };
}

// Property tests do real work (signing, TLS, many records) and the machine may be busy.
vi.setConfig({ testTimeout: 120_000 });

describe('Feature: pass-service, HTTP primitives', () => {
  test('problem bodies for each status and code parse with ProblemSchema', () => {
    for (const status of STATUSES) {
      for (const code of CODES) {
        const result = problem(status, code);
        expect(result.statusCode).toBe(status);
        expect(result.headers['content-type']).toBe('application/problem+json');
        expect(result.isBase64Encoded).toBe(false);
        const body = ProblemSchema.parse(JSON.parse(result.body));
        expect(body).toEqual({ type: 'about:blank', title: TITLES[status], status, code });
      }
    }
  });

  test('a problem can carry extra headers such as Retry-After', () => {
    const result = problem(429, 'rate_limited', { 'retry-after': '120' });
    expect(result.headers['retry-after']).toBe('120');
    expect(result.headers['content-type']).toBe('application/problem+json');
  });

  test('ProblemError and DependencyError carry fixed values only', () => {
    const withHeaders = new ProblemError(429, 'rate_limited', { 'retry-after': '5' });
    expect(withHeaders.status).toBe(429);
    expect(withHeaders.code).toBe('rate_limited');
    expect(withHeaders.headers).toEqual({ 'retry-after': '5' });
    expect(withHeaders.name).toBe('ProblemError');
    expect(new ProblemError(404, 'not_found').headers).toEqual({});
    const dependency = new DependencyError('dynamodb');
    expect(dependency.kind).toBe('dynamodb');
    expect(dependency.name).toBe('DependencyError');
    expect(dependency.message).toBe('dependency failure: dynamodb');
  });

  test('json responses carry the status and a JSON body', () => {
    const result = json(201, { a: 1 });
    expect(result).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
      isBase64Encoded: false,
    });
  });

  test('binary responses are base64 with the given content type', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const result = binary(200, 'application/vnd.apple.pkpass', bytes, {
          'last-modified': 'x',
        });
        expect(result.isBase64Encoded).toBe(true);
        expect(result.headers['content-type']).toBe('application/vnd.apple.pkpass');
        expect(result.headers['last-modified']).toBe('x');
        expect(Buffer.from(result.body, 'base64').equals(Buffer.from(bytes))).toBe(true);
      }),
      { numRuns: 100 },
    );
    expect(binary(200, 'text/calendar', new Uint8Array()).headers).toEqual({
      'content-type': 'text/calendar',
    });
  });

  test('empty responses have no body', () => {
    expect(empty(204)).toEqual({ statusCode: 204, headers: {}, body: '', isBase64Encoded: false });
    expect(empty(304, { 'last-modified': 'y' }).headers).toEqual({ 'last-modified': 'y' });
  });

  test('hardening adds the three headers and never a CORS header', () => {
    const hardened = withHardening(json(200, {}));
    expect(hardened.headers).toEqual({ 'content-type': 'application/json', ...HARDENING_HEADERS });
    expect(Object.keys(hardened.headers).some((k) => k.startsWith('access-control'))).toBe(false);
    expect(HARDENING_HEADERS['cache-control']).toBe('no-store');
    expect(HARDENING_HEADERS['x-content-type-options']).toBe('nosniff');
    expect(HARDENING_HEADERS['referrer-policy']).toBe('no-referrer');
  });

  test('header lookup ignores case and tolerates null headers', () => {
    const event = eventWith({ 'X-Origin-Verify': 'abc', other: undefined });
    expect(header(event, 'x-origin-verify')).toBe('abc');
    expect(header(event, 'OTHER')).toBeUndefined();
    expect(header(event, 'missing')).toBeUndefined();
    expect(header(eventWith(null), 'x')).toBeUndefined();
  });

  test('the router returns undefined for unknown keys, including prototype names', () => {
    const handler = () => Promise.resolve(empty(200));
    const lookup = createRouter<null>({ 'GET /a': handler });
    expect(lookup('GET /a')).toBe(handler);
    expect(lookup('GET /b')).toBeUndefined();
    expect(lookup('constructor')).toBeUndefined();
    expect(lookup('__proto__')).toBeUndefined();
    expect(createRouter<null>({ 'GET /a': undefined })('GET /a')).toBeUndefined();
  });
});
