import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
// The consumer-import fixture: import shared values AND types from the
// @compass/contracts public surface exactly as a later stream would. If any of
// these names stopped resolving, this file would fail to compile and the gate
// would fail. Importing from '../src/index.js' exercises the same public surface
// that '@compass/contracts' resolves to under the @compass/source condition.
import {
  SessionWireSchema,
  createPassFieldsSchema,
  mcpTools,
  ProblemSchema,
  VerdictSchema,
} from '../src/index.js';
import type {
  SessionWire,
  PassFields,
  Problem,
  Verdict,
  Commitment,
  CompassApi,
  EventsApi,
} from '../src/index.js';

// Acceptance gate tests (foundation-contracts, S0).
//
// Validates: Requirements 12.1, 12.2, 12.5, 12.10 (and supports the full-gate run
// in task 14.1). This file proves two things:
//   1. The consumer path: a shared type and value from @compass/contracts resolves
//      and type-checks, including the generated CompassApi and EventsApi
//      namespaces (Requirement 12.5).
//   2. The committed .env.example exists and carries placeholder values only: no
//      secret, no 12-digit run (possible account id) and no arn:aws literal
//      (Requirements 11.2, 11.5, 12.10).

const here = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(here, '..', '..', '..');

describe('Feature: foundation-contracts, consumer import path', () => {
  test('a consumer can import and use shared schemas from @compass/contracts', () => {
    // Runtime values resolve.
    expect(typeof SessionWireSchema.safeParse).toBe('function');
    expect(typeof createPassFieldsSchema).toBe('function');
    expect(typeof ProblemSchema.safeParse).toBe('function');
    expect(typeof VerdictSchema.safeParse).toBe('function');
    expect(Object.keys(mcpTools).length).toBeGreaterThan(0);

    // A shared schema parses a valid value, proving the consumer gets a working
    // schema, not just a type.
    const parsed = SessionWireSchema.safeParse({ sessionId: 's1', title: 'A session' });
    expect(parsed.success).toBe(true);
  });

  test('shared inferred types and generated namespaces are usable at the type level', () => {
    // These type-only uses must compile. A non-compiling line here fails the gate
    // through tsc -b. The runtime assertions are trivial; the value is the types.
    const session: SessionWire = { sessionId: 's1', title: 't' };
    const problem: Problem = { type: 'about:blank', title: 'x', status: 400, code: 'bad' };
    const verdict: Verdict = { decision: 'allow', reasons: [] };
    const commitment: Commitment = {
      kind: 'reservedSession',
      sessionId: 's1',
      startsAt: '2026-12-01T09:00:00-08:00',
      endsAt: '2026-12-01T10:00:00-08:00',
    };
    const fields: PassFields = {
      sessionCode: 'AIM101',
      title: 't',
      venue: 'v',
      room: 'r',
      startsAt: '2026-12-01T09:00:00-08:00',
      endsAt: '2026-12-01T10:00:00-08:00',
    };

    // Generated OpenAPI namespaces resolve as types. Referencing a member keeps the
    // import used and proves the generated types are wired into the surface.
    type CompassComponents = CompassApi.components;
    type EventsComponents = EventsApi.components;
    const compassCheck: CompassComponents | undefined = undefined;
    const eventsCheck: EventsComponents | undefined = undefined;

    expect(session.sessionId).toBe('s1');
    expect(problem.status).toBe(400);
    expect(verdict.decision).toBe('allow');
    expect(commitment.kind).toBe('reservedSession');
    expect(fields.sessionCode).toBe('AIM101');
    expect(compassCheck).toBeUndefined();
    expect(eventsCheck).toBeUndefined();
  });
});

describe('Feature: foundation-contracts, committed example files are safe', () => {
  const envExamplePath = resolve(repoRoot, '.env.example');
  const envExample = existsSync(envExamplePath)
    ? readFileSync(envExamplePath, 'utf8')
    : undefined;

  test('.env.example exists', () => {
    expect(existsSync(envExamplePath)).toBe(true);
  });

  test('.env.example contains no 12-digit run (possible account id)', () => {
    expect(envExample).toBeDefined();
    expect(/\b\d{12}\b/.test(envExample ?? '')).toBe(false);
  });

  test('.env.example contains no arn:aws literal', () => {
    expect(envExample).toBeDefined();
    expect(/arn:aws/i.test(envExample ?? '')).toBe(false);
  });

  test('.env.example contains no obvious secret assignment', () => {
    expect(envExample).toBeDefined();
    const text = envExample ?? '';
    // No line assigns a value to a key whose name looks like a secret. Placeholder
    // values (REPLACE_*, example.invalid, simulated) are fine; a real-looking
    // secret value assigned to a token or key field is not.
    const secretKey = /^(?!#).*\b(secret|token|password|private_key|api_key)\b\s*=\s*\S/im;
    expect(secretKey.test(text)).toBe(false);
  });

  test('.env.example uses only placeholder style values for hosts and emails', () => {
    expect(envExample).toBeDefined();
    const text = envExample ?? '';
    // The CloudFront base URL is a distribution placeholder, not a real domain.
    expect(text).toMatch(/REPLACE_WITH_DISTRIBUTION\.cloudfront\.net/);
    // The alert email uses the reserved .invalid TLD so it can never be real.
    expect(text).toMatch(/@example\.invalid/);
  });
});
