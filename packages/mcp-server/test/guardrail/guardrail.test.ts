import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { VerdictSchema } from '@compass/contracts';
import type { Commitment, Verdict } from '@compass/contracts';
import { combineVerdicts } from '../../src/guardrail/combine-verdicts.js';
import { guardBatch } from '../../src/guardrail/reserve-guard.js';
import { suggestForBlock } from '../../src/guardrail/suggestions.js';
import type { CatalogView } from '../../src/ports/events-port.js';
import { commitmentFor } from '../../src/tools/common.js';
import { buildCatalogView, normaliseWire, wireSession } from '../support/fake-catalog.js';
import { FakeRules } from '../support/fake-rules.js';

// Feature: compass-power, Property 30: Verdict combination follows severity precedence
describe('Property 30: verdict combination follows severity precedence', () => {
  const verdictArb: fc.Arbitrary<Verdict> = fc.oneof(
    fc
      .array(fc.constantFrom('a', 'b', 'c'), { maxLength: 2 })
      .map((reasons) => ({ decision: 'allow' as const, reasons })),
    fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 3 }).map((reasons) => ({
      decision: 'warn' as const,
      reasons: reasons as [string, ...string[]],
    })),
    fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 3 }).map((reasons) => ({
      decision: 'block' as const,
      reasons: reasons as [string, ...string[]],
    })),
  );
  const entriesArb = fc.array(
    fc.record({ code: fc.constantFrom('AAA1', 'BBB2', 'CCC3'), verdict: verdictArb }),
    { maxLength: 6 },
  );

  test('block over warn over allow with distinct coded reasons in first-seen order', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const combined = combineVerdicts(entries);
        const decisions = entries.map((e) => e.verdict.decision);
        const expected = decisions.includes('block')
          ? 'block'
          : decisions.includes('warn')
            ? 'warn'
            : 'allow';
        expect(combined.decision).toBe(expected);
        expect(VerdictSchema.safeParse(combined).success).toBe(true);
        const seen: string[] = [];
        for (const { code, verdict } of entries) {
          for (const reason of verdict.reasons) {
            const coded = `${code}: ${reason}`;
            if (!seen.includes(coded)) seen.push(coded);
          }
        }
        expect(combined.reasons).toEqual(seen);
      }),
      { numRuns: 200 },
    );
  });
});

const catalog = buildCatalogView([
  wireSession('a', {
    abbreviation: 'AAA1',
    sessionTime: {
      date: '2026-12-01',
      time: '10:00',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
  }),
  wireSession('b', {
    abbreviation: 'BBB1',
    sessionTime: {
      date: '2026-12-01',
      time: '10:30',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
  }),
  wireSession('c', {
    abbreviation: 'CCC1',
    sessionTime: {
      date: '2026-12-01',
      time: '14:00',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
  }),
  wireSession('a-r', {
    abbreviation: 'AAA1-R',
    sessionTime: {
      date: '2026-12-02',
      time: '10:00',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
  }),
  wireSession('b-r', {
    abbreviation: 'BBB1-R',
    sessionTime: {
      date: '2026-12-01',
      time: '10:15',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
  }),
  wireSession('x', { abbreviation: 'XXX1', sessionTime: undefined }),
]);
const session = (id: string) => catalog.byId.get(id)?.session ?? normaliseWire(wireSession(id));

describe('guardBatch', () => {
  test('judges each candidate against the confirmed schedule plus earlier candidates', async () => {
    const rules = new FakeRules();
    const result = await guardBatch([session('a'), session('b'), session('c')], [], rules, catalog);
    expect(result.perSession.map((p) => [p.code, p.verdict.decision])).toEqual([
      ['AAA1', 'allow'],
      ['BBB1', 'block'],
      ['CCC1', 'allow'],
    ]);
    expect(result.verdict.decision).toBe('block');
    expect(result.verdict.reasons[0]).toContain('BBB1:');
    expect(result.perSession[0]?.title).toBe('Title a');
  });

  test('a rules failure is treated as a block', async () => {
    const rules = new FakeRules();
    rules.verdictFor = () => {
      throw new Error('boom with token abc');
    };
    const result = await guardBatch([session('a')], [], rules, catalog);
    expect(result.verdict.decision).toBe('block');
    expect(JSON.stringify(result)).not.toContain('boom');
  });

  test('a candidate without times is still passed to the rules', async () => {
    const rules = new FakeRules();
    const result = await guardBatch([session('x'), session('a')], [], rules, catalog);
    expect(result.verdict.decision).toBe('allow');
    expect(commitmentFor(session('x'))).toMatchObject({ startsAt: '', endsAt: '' });
  });
});

describe('suggestForBlock', () => {
  const confirmedA: Commitment[] = [commitmentFor(session('a'))];

  test('offers a safe swap to a repeat of the clashing reservation and rebooking options', async () => {
    const rules = new FakeRules();
    const suggestions = await suggestForBlock(session('b'), confirmedA, rules, catalog, []);
    expect(suggestions.rebooking.map((o) => o.session.sessionId)).toEqual([]);
    expect(suggestions.swap).toMatchObject({ originalId: 'a', repeatId: 'a-r', blockedId: 'b' });
    expect(suggestions.swap?.steps).toHaveLength(4);
    expect(suggestions.swap?.steps[0]).toContain('AAA1-R');
  });

  test('keeps a repeat of the blocked session only when it does not block, and similar sessions always', async () => {
    const rules = new FakeRules();
    const original = rules.rebooking.bind(rules);
    rules.rebooking = async (code: string, lookup: CatalogView, favorites: readonly string[]) => {
      const options = await original(code, lookup, favorites);
      return code === 'BBB1'
        ? [...options, { kind: 'similar' as const, session: session('c'), reason: 'Similar.' }]
        : options;
    };
    const suggestions = await suggestForBlock(session('b'), confirmedA, rules, catalog, []);
    expect(suggestions.rebooking.map((o) => o.kind)).toEqual(['similar']);
    const open = await suggestForBlock(session('b'), [], rules, catalog, []);
    expect(open.rebooking.map((o) => o.session.sessionId)).toEqual(['b-r', 'c']);
    expect(open.swap).toBeUndefined();
  });

  test('no swap when no repeat of the original is safe or the original is unknown', async () => {
    const rules = new FakeRules();
    rules.verdictFor = (candidate) =>
      candidate.sessionId === 'a-r'
        ? { decision: 'block', reasons: ['x'] }
        : session('a').sessionId === candidate.sessionId
          ? { decision: 'allow', reasons: [] }
          : { decision: 'block', reasons: ['clash'] };
    const none = await suggestForBlock(session('b'), confirmedA, rules, catalog, []);
    expect(none.swap).toBeUndefined();
    const unknown: Commitment[] = [
      { kind: 'reservedSession', sessionId: 'ghost', startsAt: '', endsAt: '' },
    ];
    const ghost = await suggestForBlock(session('b'), unknown, rules, catalog, []);
    expect(ghost.swap).toBeUndefined();
  });

  test('personal time that clashes is not a swap candidate', async () => {
    const rules = new FakeRules();
    const personal: Commitment[] = [
      {
        kind: 'personalTime',
        title: 'Lunch',
        startsAt: '2026-12-01T18:30:00.000Z',
        endsAt: '2026-12-01T19:30:00.000Z',
      },
    ];
    const suggestions = await suggestForBlock(session('b'), personal, rules, catalog, []);
    expect(suggestions.swap).toBeUndefined();
  });
});
