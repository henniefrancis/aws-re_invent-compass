import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { mcpTools } from '@compass/contracts';
import type { Commitment } from '@compass/contracts';
import { CompassError } from '../../src/ports/errors.js';
import { exportCalendar } from '../../src/tools/export-calendar.js';
import { issueBoardingPasses } from '../../src/tools/issue-boarding-passes.js';
import { PASS_DISCLAIMER } from '../../src/tools/pass-text.js';
import {
  ASK_SHOW_MESSAGE,
  NO_PAGE_HINT,
  QR_IN_BROWSER,
  QR_PAGE_FAILED,
  sendToPhone,
} from '../../src/tools/send-to-phone.js';
import { syncPasses } from '../../src/tools/sync-passes.js';
import type { ToolContext } from '../../src/server/types.js';
import { connect } from '../support/connect.js';
import { contextFor } from '../support/context.js';
import { syntheticCatalogView } from '../support/fake-catalog.js';
import { createFakeRuntime } from '../support/fake-runtime.js';
import { TRIPLE } from '../support/triple.js';

function setup(elicit?: ToolContext['elicit']) {
  const fake = createFakeRuntime({ catalog: syntheticCatalogView() });
  return { fake, ctx: contextFor(fake, elicit === undefined ? {} : { elicit }) };
}

const answering =
  (answer: 'accept' | 'decline' | 'cancel'): ToolContext['elicit'] =>
  () =>
    Promise.resolve(answer);

describe('issue_boarding_passes', () => {
  test('issues for reserved sessions after refreshing each one, with the disclaimer', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.aRepeat, TRIPLE.b);
    const outcome = await issueBoardingPasses({ sessionIds: [TRIPLE.aRepeat, TRIPLE.b] }, ctx);
    expect(outcome.ok && mcpTools.issue_boarding_passes.output.parse(outcome.structured)).toEqual({
      issued: [TRIPLE.aRepeat, TRIPLE.b],
      serials: ['serial-1', 'serial-2'],
    });
    expect(fake.events.callsTo('getSession').map((c) => c.args[0])).toEqual([
      TRIPLE.aRepeat,
      TRIPLE.b,
    ]);
    expect(fake.passes.calls.filter((c) => c.method === 'issue')).toHaveLength(1);
    expect(outcome.ok && outcome.text).toContain(PASS_DISCLAIMER);
    expect(outcome.ok && outcome.text).not.toMatch(/delet/i);
  });

  test('sessions that are not reserved are refused with no pass call', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.aRepeat);
    const outcome = await issueBoardingPasses({ sessionIds: [TRIPLE.aRepeat, TRIPLE.b] }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({
      issued: [TRIPLE.aRepeat],
      serials: ['serial-1'],
    });
    expect(outcome.ok && outcome.text).toContain('refused because they are not reserved');
    const none = setup();
    const refused = await issueBoardingPasses({ sessionIds: [TRIPLE.b] }, none.ctx);
    expect(refused.ok && refused.structured).toEqual({ issued: [], serials: [] });
    expect(none.fake.passes.writeCalls).toEqual([]);
    expect(none.fake.events.callsTo('getSession')).toEqual([]);
  });

  test('a decline issues nothing; bad ids, unknown sessions and sign-out are refused', async () => {
    const declined = setup(answering('decline'));
    declined.fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await issueBoardingPasses({ sessionIds: [TRIPLE.a] }, declined.ctx);
    expect(outcome.ok && outcome.text).toContain('did not confirm');
    expect(declined.fake.passes.writeCalls).toEqual([]);
    const { fake, ctx } = setup();
    await expect(issueBoardingPasses({ sessionIds: ['a/b'] }, ctx)).rejects.toMatchObject({
      code: 'IdentifierRejected',
    });
    expect(fake.events.calls).toEqual([]);
    await expect(issueBoardingPasses({ sessionIds: ['ghost'] }, ctx)).rejects.toMatchObject({
      code: 'UnknownSession',
    });
    fake.events.signedIn = false;
    await expect(issueBoardingPasses({ sessionIds: [TRIPLE.a] }, ctx)).rejects.toMatchObject({
      code: 'NotSignedIn',
    });
  });
});

// Feature: compass-power, Property 35: Passes are issued only for confirmed reservations
describe('Property 35: passes are issued only for confirmed reservations', () => {
  const IDS = [TRIPLE.a, TRIPLE.aRepeat, TRIPLE.b];
  test('the passes port receives exactly the requested sessions the schedule lists as reserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(IDS, { minLength: 1 }),
        fc.subarray(IDS),
        async (requested, reserved) => {
          const { fake, ctx } = setup();
          fake.events.schedule.reserved.push(...reserved);
          const outcome = await issueBoardingPasses({ sessionIds: requested }, ctx);
          const expected = requested.filter((id) => reserved.includes(id));
          const issueCalls = fake.passes.calls.filter((c) => c.method === 'issue');
          if (expected.length === 0) {
            expect(issueCalls).toEqual([]);
          } else {
            expect(issueCalls).toHaveLength(1);
            expect(issueCalls[0]?.args[0]).toEqual(expected);
          }
          expect(outcome.ok && outcome.structured).toMatchObject({ issued: expected });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('send_to_phone', () => {
  /** A QR page that records what it was asked to show and answers `opens`. */
  function qrPageAnswering(opens: boolean) {
    const shown: { svg: string; expiresAt: string }[] = [];
    let cleared = 0;
    return {
      shown,
      cleared: () => cleared,
      port: {
        show: (page: { svg: string; expiresAt: string }) => {
          shown.push(page);
          return Promise.resolve(opens);
        },
        clear: () => {
          cleared += 1;
          return Promise.resolve();
        },
      },
    };
  }

  function seeded(elicit?: ToolContext['elicit']) {
    const made = setup(elicit);
    made.fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    made.fake.passes.seed(TRIPLE.b, `${TRIPLE.codes.b}`);
    return made;
  }

  // Feature: compass-power, P3.1: without a choice nothing is created and nothing is called.
  test('without show it asks and creates nothing, before any sign-in or service call', async () => {
    const { fake, ctx } = seeded();
    fake.events.signedIn = false;
    const outcome = await sendToPhone({}, ctx);
    expect(outcome).toEqual({ ok: false, message: ASK_SHOW_MESSAGE });
    expect(fake.passes.calls).toEqual([]);
    expect(fake.events.calls).toEqual([]);
  });

  // Feature: compass-power, P3.2: a link and no QR code.
  test('link gives the link and expiry, no QR code and no page', async () => {
    const { fake, ctx } = seeded();
    const page = qrPageAnswering(true);
    fake.runtime.qrPage = page.port;
    const outcome = await sendToPhone({ show: 'link' }, ctx);
    // The capability is in the link's fragment: the structured result has the link without it, and
    // the full link is only in the text (security L1).
    const full = fake.passes.handoffResult.boardUrl;
    expect(outcome.ok && mcpTools.send_to_phone.output.parse(outcome.structured)).toEqual({
      handoffUrl: full.split('#')[0],
      expiresAt: fake.passes.handoffResult.expiresAt,
      shownAs: 'link',
    });
    expect(full).toContain('#');
    expect(JSON.stringify(outcome.ok && outcome.structured)).not.toContain(
      full.split('#')[1] ?? '#',
    );
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain(
      `Open this link on your phone before ${fake.passes.handoffResult.expiresAt}: ${full}`,
    );
    expect(text).toContain(
      'Do not share this link or the QR code. Anyone who has it can see these passes until it expires.',
    );
    expect(text).toContain(PASS_DISCLAIMER);
    expect(text).not.toContain('QR-TEXT');
    expect(outcome.ok && outcome.extra).toBeUndefined();
    expect(page.shown).toEqual([]);
    expect(fake.passes.calls.find((c) => c.method === 'handoff')?.args[0]).toEqual([
      'serial-1',
      'serial-2',
    ]);
    expect(fake.stderr.join('')).not.toContain('compass.invalid');
  });

  // Feature: compass-power, P3.3: the QR code on a browser page, and no link in the chat.
  test('qr opens the page with the SVG and expiry, and prints no link', async () => {
    const { fake, ctx } = seeded();
    const page = qrPageAnswering(true);
    fake.runtime.qrPage = page.port;
    const outcome = await sendToPhone({ show: 'qr' }, ctx);
    const { boardUrl, expiresAt, svg } = fake.passes.handoffResult;
    expect(page.shown).toEqual([{ svg, expiresAt }]);
    expect(outcome.ok && outcome.structured).toMatchObject({ shownAs: 'qr', qrShownIn: 'browser' });
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain(`${QR_IN_BROWSER} before ${expiresAt}. ${NO_PAGE_HINT}`);
    expect(text).not.toContain(boardUrl);
    expect(text).not.toContain(boardUrl.split('#')[1] ?? '#');
    expect(text).not.toContain('QR-TEXT');
    expect(outcome.ok && outcome.extra).toBeUndefined();
    expect(fake.stderr.join('')).not.toContain('compass.invalid');
  });

  test('both gives the link and opens the page', async () => {
    const { fake, ctx } = seeded();
    const page = qrPageAnswering(true);
    fake.runtime.qrPage = page.port;
    const outcome = await sendToPhone({ show: 'both' }, ctx);
    const text = outcome.ok ? outcome.text : '';
    expect(text).toContain(fake.passes.handoffResult.boardUrl);
    expect(text).toContain(QR_IN_BROWSER);
    expect(page.shown).toHaveLength(1);
    expect(outcome.ok && outcome.structured).toMatchObject({
      shownAs: 'both',
      qrShownIn: 'browser',
    });
  });

  // Feature: compass-power, P3.4: the fallback when the page cannot be shown.
  test('when the page cannot be shown, the text QR and the PNG go in the chat, once', async () => {
    for (const qrPage of [qrPageAnswering(false).port, undefined]) {
      const { fake, ctx } = seeded();
      if (qrPage !== undefined) fake.runtime.qrPage = qrPage;
      const outcome = await sendToPhone({ show: 'qr' }, ctx);
      const text = outcome.ok ? outcome.text : '';
      expect(text).toContain(QR_PAGE_FAILED);
      expect(text.split('QR-TEXT')).toHaveLength(2);
      expect(text).not.toContain('##');
      expect(text).not.toContain(String.fromCharCode(0x1b));
      expect(text).not.toContain(fake.passes.handoffResult.boardUrl);
      expect(outcome.ok && outcome.extra).toEqual([
        { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
      ]);
      expect(outcome.ok && outcome.structured).toMatchObject({ shownAs: 'qr', qrShownIn: 'chat' });
    }
  });

  test('the confirmation says how the passes will be shown', async () => {
    const questions: string[] = [];
    const { fake, ctx } = seeded((question) => {
      questions.push(question.message);
      return Promise.resolve('accept');
    });
    fake.runtime.qrPage = qrPageAnswering(true).port;
    for (const show of ['link', 'qr', 'both'] as const) await sendToPhone({ show }, ctx);
    expect(questions[0]).toContain('shown as a link?');
    expect(questions[1]).toContain('shown as a QR code in your browser?');
    expect(questions[2]).toContain('shown as a link and a QR code in your browser?');
  });

  test('narrows to the chosen sessions and refuses when none were issued', async () => {
    const { fake, ctx } = seeded();
    await sendToPhone({ sessionIds: [TRIPLE.b], show: 'link' }, ctx);
    expect(fake.passes.calls.find((c) => c.method === 'handoff')?.args[0]).toEqual(['serial-2']);
    await expect(
      sendToPhone({ sessionIds: [TRIPLE.aRepeat], show: 'link' }, ctx),
    ).rejects.toMatchObject({
      code: 'NoPassesIssued',
    });
    const empty = setup();
    await expect(sendToPhone({ show: 'link' }, empty.ctx)).rejects.toMatchObject({
      code: 'NoPassesIssued',
    });
    expect(empty.fake.passes.writeCalls).toEqual([]);
  });

  test('a decline creates no link or page; bad ids, unknown sessions and sign-out are refused', async () => {
    const declined = seeded(answering('cancel'));
    const page = qrPageAnswering(true);
    declined.fake.runtime.qrPage = page.port;
    const outcome = await sendToPhone({ show: 'qr' }, declined.ctx);
    expect(outcome.ok).toBe(false);
    expect(declined.fake.passes.writeCalls).toEqual([]);
    expect(page.shown).toEqual([]);
    const { fake, ctx } = setup();
    await expect(sendToPhone({ sessionIds: ['..'] }, ctx)).rejects.toMatchObject({
      code: 'IdentifierRejected',
    });
    await expect(sendToPhone({ sessionIds: ['ghost'], show: 'link' }, ctx)).rejects.toMatchObject({
      code: 'UnknownSession',
    });
    fake.events.signedIn = false;
    await expect(sendToPhone({ show: 'link' }, ctx)).rejects.toMatchObject({
      code: 'NotSignedIn',
    });
  });
});

describe('sync_passes', () => {
  test('issues, updates and voids against the fresh schedule, with the void note', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a, TRIPLE.aRepeat);
    fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    fake.passes.seed(TRIPLE.b, `${TRIPLE.codes.b}`);
    const outcome = await syncPasses({}, ctx);
    expect(outcome.ok && outcome.structured).toEqual({
      issued: [TRIPLE.aRepeat],
      updated: [TRIPLE.a],
      voided: [TRIPLE.b],
    });
    expect(outcome.ok && outcome.text).toContain('expired passes');
    expect(outcome.ok && outcome.text).toContain(`${TRIPLE.codes.b}`);
  });

  test('voiding a pass whose session is not in the catalog still works', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    fake.passes.seed('x', 'UNKNOWN9');
    const outcome = await syncPasses({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ voided: ['x'] });
  });

  test('a reserved id the catalog does not know makes the sync refuse and ask for refresh_catalog (security M4)', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a, 'ghost');
    await expect(syncPasses({}, ctx)).rejects.toMatchObject({ code: 'UnknownSession' });
    expect(
      fake.passes.calls.filter((c) => c.method === 'sync' || c.method === 'previewSync'),
    ).toEqual([]);
    // A narrowed sync only looks at the sessions it names, so an unknown id elsewhere does not matter.
    await expect(syncPasses({ sessionIds: [TRIPLE.a] }, ctx)).resolves.toMatchObject({ ok: true });
  });

  test('a narrowed sync hands S4 only the narrowed sessions and never touches other passes', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a, TRIPLE.aRepeat);
    fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    fake.passes.seed(TRIPLE.b, `${TRIPLE.codes.b}`);
    const outcome = await syncPasses({ sessionIds: [TRIPLE.aRepeat] }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({
      issued: [TRIPLE.aRepeat],
      updated: [],
      voided: [],
    });
    expect(fake.passes.entries.map((e) => e.sessionId).sort()).toEqual(
      [TRIPLE.a, TRIPLE.b, TRIPLE.aRepeat].sort(),
    );
    const call = fake.passes.calls.find((c) => c.method === 'sync');
    expect(call?.args[0]).toEqual([TRIPLE.aRepeat]);
    expect(call?.args[1]).toEqual([`${TRIPLE.codes.aRepeat}`]);
  });

  test('voiding more than five passes needs an elicited confirmation and sets allowBulkVoid', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup((q) => (asked.push(q.message), Promise.resolve('accept')));
    for (let i = 0; i < 6; i += 1) fake.passes.seed(`gone-${i}`, `GONE${i}`);
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await syncPasses({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ issued: [TRIPLE.a] });
    expect(asked[0]).toContain('6 to void');
    expect(asked[0]).toContain('- Void GONE0');
    expect(fake.passes.calls.find((c) => c.method === 'sync')?.args).toEqual([
      [TRIPLE.a],
      undefined,
      false,
      true,
    ]);
  });

  test('voiding every pass sets confirmEmpty after an explicit accept', async () => {
    const { fake, ctx } = setup(answering('accept'));
    fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    const outcome = await syncPasses({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ voided: [TRIPLE.a] });
    expect(fake.passes.calls.find((c) => c.method === 'sync')?.args.slice(2)).toEqual([
      true,
      false,
    ]);
  });

  test('without elicitation an empty or bulk void is refused and nothing is synced', async () => {
    for (const count of [1, 6]) {
      const { fake, ctx } = setup();
      for (let i = 0; i < count; i += 1) fake.passes.seed(`gone-${i}`, `GONE${i}`);
      if (count === 6) fake.events.schedule.reserved.push(TRIPLE.a);
      await expect(syncPasses({}, ctx)).rejects.toMatchObject({ code: 'BulkVoidRefused' });
      expect(fake.passes.calls.filter((c) => c.method === 'sync')).toEqual([]);
    }
  });

  test('a small void goes ahead without a question when the client cannot ask', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    fake.passes.seed(TRIPLE.a, `${TRIPLE.codes.a}`);
    fake.passes.seed(TRIPLE.b, `${TRIPLE.codes.b}`);
    const outcome = await syncPasses({}, ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ voided: [TRIPLE.b] });
  });

  test('a decline or cancel syncs nothing', async () => {
    for (const answer of ['decline', 'cancel'] as const) {
      const { fake, ctx } = setup(answering(answer));
      fake.passes.seed(TRIPLE.b, `${TRIPLE.codes.b}`);
      const outcome = await syncPasses({}, ctx);
      expect(outcome.ok && outcome.structured).toEqual({ issued: [], updated: [], voided: [] });
      expect(fake.passes.calls.filter((c) => c.method === 'sync')).toEqual([]);
    }
  });

  test('any issue, update or void is asked about first, each listed with its code and catalog title (security M3)', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup((q) => (asked.push(q.message), Promise.resolve('accept')));
    fake.events.schedule.reserved.push(TRIPLE.a, TRIPLE.aRepeat);
    fake.passes.seed(TRIPLE.a, TRIPLE.codes.a);
    fake.passes.seed(TRIPLE.b, TRIPLE.codes.b);
    await syncPasses({}, ctx);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`- Issue ${TRIPLE.codes.aRepeat} "${TRIPLE.titles.aRepeat}"`);
    expect(asked[0]).toContain(`- Update ${TRIPLE.codes.a} "${TRIPLE.titles.a}"`);
    expect(asked[0]).toContain(`- Void ${TRIPLE.codes.b}`);
    expect(asked[0]).toContain('1 to issue, 1 to update, 1 to void');
  });

  test('an issue alone is asked about, and a decline syncs nothing', async () => {
    const asked: string[] = [];
    const { fake, ctx } = setup((q) => (asked.push(q.message), Promise.resolve('decline')));
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await syncPasses({}, ctx);
    expect(asked).toHaveLength(1);
    expect(outcome.ok && outcome.text).toContain(
      'Nothing was synced, because you did not confirm.',
    );
    expect(fake.passes.calls.some((c) => c.method === 'sync')).toBe(false);
  });

  test('a plan with nothing to do asks nothing, and a client that cannot ask syncs a small plan', async () => {
    const asked: string[] = [];
    const quiet = setup((q) => (asked.push(q.message), Promise.resolve('accept')));
    await syncPasses({}, quiet.ctx);
    expect(asked).toEqual([]);
    const blind = setup();
    blind.fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await syncPasses({}, blind.ctx);
    expect(outcome.ok && outcome.structured).toMatchObject({ issued: [TRIPLE.a] });
  });

  test('bad ids and a signed-out attendee are refused', async () => {
    const { fake, ctx } = setup();
    await expect(syncPasses({ sessionIds: ['a\\b'] }, ctx)).rejects.toMatchObject({
      code: 'IdentifierRejected',
    });
    expect(fake.events.calls).toEqual([]);
    fake.events.signedIn = false;
    await expect(syncPasses({}, ctx)).rejects.toMatchObject({ code: 'NotSignedIn' });
  });
});

// Feature: compass-power, Property 36: A narrowed sync never touches other passes
describe('Property 36: a narrowed sync never touches other passes', () => {
  const IDS = [TRIPLE.a, TRIPLE.aRepeat, TRIPLE.b];
  test('only narrowed sessions reach S4 and every reported change concerns a narrowed id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(IDS),
        fc.subarray(IDS),
        fc.subarray(IDS, { minLength: 1 }),
        async (reserved, issued, narrow) => {
          const { fake, ctx } = setup(answering('accept'));
          fake.events.schedule.reserved.push(...reserved);
          for (const id of issued) fake.passes.seed(id, `C-${id}`);
          const before = fake.passes.entries.map((e) => e.sessionId).sort();
          const outcome = await syncPasses({ sessionIds: narrow }, ctx);
          const call = fake.passes.calls.find((c) => c.method === 'sync');
          for (const id of (call?.args[0] as string[] | undefined) ?? [])
            expect(narrow).toContain(id);
          if (outcome.ok) {
            for (const id of [
              ...outcome.structured.issued,
              ...outcome.structured.updated,
              ...outcome.structured.voided,
            ]) {
              expect(narrow).toContain(id);
            }
          }
          const untouched = before.filter((id) => !narrow.includes(id));
          for (const id of untouched)
            expect(fake.passes.entries.map((e) => e.sessionId)).toContain(id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('export_calendar', () => {
  test('builds from the given commitments without a sign-in', async () => {
    const { fake, ctx } = setup();
    fake.events.signedIn = false;
    const commitments: Commitment[] = [
      { kind: 'reservedSession', sessionId: TRIPLE.a, startsAt: 'x', endsAt: 'y' },
      { kind: 'personalTime', title: 'Lunch', startsAt: 'x', endsAt: 'y' },
      {
        kind: 'personalTime',
        title: 'Rest',
        startsAt: 'x',
        endsAt: 'y',
        personalTimeId: 'p1',
        location: 'Cafe',
      },
      { kind: 'reservedSession', sessionId: 'ghost', startsAt: 'x', endsAt: 'y' },
    ];
    const outcome = await exportCalendar({ commitments }, ctx);
    expect(outcome.ok && outcome.structured).toEqual({ ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR' });
    expect(fake.events.calls.map((c) => c.method)).toEqual(['catalog']);
    expect(fake.passes.calls.find((c) => c.method === 'exportCalendar')?.args[0]).toBe(3);
    // The unknown session is reported, by id and as the attendee's own data, not silently dropped.
    expect(outcome.ok && outcome.text).toContain(
      '1 sessions you named are not in the catalog Compass has cached',
    );
    expect(outcome.ok && outcome.text).toContain('"notInCatalog"');
    expect(outcome.ok && outcome.text).toContain('ghost');
    const clean = await exportCalendar({ commitments: commitments.slice(0, 2) }, ctx);
    expect(clean.ok && clean.text).not.toContain('not in the catalog');
  });

  test('builds from the confirmed schedule when none are given', async () => {
    const { fake, ctx } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    const outcome = await exportCalendar({}, ctx);
    expect(outcome.ok && outcome.text).toContain('1 entries');
    expect(fake.passes.calls.find((c) => c.method === 'exportCalendar')?.args[0]).toBe(1);
    fake.events.signedIn = false;
    await expect(exportCalendar({}, ctx)).rejects.toMatchObject({ code: 'NotSignedIn' });
  });

  test('rejects bad ids in given commitments without a pass call', async () => {
    const { fake, ctx } = setup();
    await expect(
      exportCalendar(
        { commitments: [{ kind: 'reservedSession', sessionId: 'a/b', startsAt: '', endsAt: '' }] },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'IdentifierRejected' });
    expect(fake.passes.calls).toEqual([]);
  });
});

describe('pass tool errors', () => {
  test('a pass-side error becomes its redacted summary through the client', async () => {
    const { fake } = setup();
    fake.events.schedule.reserved.push(TRIPLE.a);
    fake.passes.failWith.set(
      'issue',
      new CompassError('PassError', {
        summary: 'The pass service said no for person@example.com.',
      }),
    );
    const connection = await connect(fake.runtime);
    const result = await connection.call('issue_boarding_passes', { sessionIds: [TRIPLE.a] });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('person@example.com');
    await connection.close();
  });
});
