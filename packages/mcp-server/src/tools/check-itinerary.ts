// check_itinerary (Requirements 10.3, 11.1, 11.4, 12.2; compass-power task 69): checks the whole
// week without writing anything. The week is the attendee's live schedule (reserved sessions and
// personal time) plus anything proposed. Every reserved or proposed session is checked with the
// booking guardrail against the rest of the week, so a clash or a walk that cannot be made shows
// up whether it is already booked or only proposed. The text lists the week in time order with
// each session's verdict, using ids, codes and catalog titles inside a Labelled_Data_Block, never
// session titles the model supplied. On a block it also suggests a rebooking or a safe swap.

import type { Commitment, McpToolInput, NormalisedSession, Verdict } from '@compass/contracts';
import { combineVerdicts } from '../guardrail/combine-verdicts.js';
import { suggestForBlock } from '../guardrail/suggestions.js';
import { CompassError } from '../ports/errors.js';
import { checkIdentifiers } from '../safety/identifiers.js';
import { labelUntrusted } from '../safety/labelled-data.js';
import { sessionIdResolver } from '../server/session-codes.js';
import type { ToolContext, ToolOutcome } from '../server/types.js';
import {
  commitmentFor,
  confirmedCommitments,
  ensureSignedIn,
  readFreshSchedule,
} from './common.js';

type PersonalTime = Extract<Commitment, { kind: 'personalTime' }>;
type WeekEntry =
  ToolOutcome<'check_itinerary'> extends infer O
    ? O extends { ok: true; structured: { week: (infer E)[] } }
      ? E
      : never
    : never;

interface CheckedSession {
  session: NormalisedSession;
  status: 'reserved' | 'proposed';
  verdict: Verdict;
}

/** Milliseconds since the epoch, or Infinity when the time is missing or unreadable, so it sorts last. */
function startOf(value: string | undefined): number {
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** The entry without its absent fields, so the structured result carries no undefined values. */
function present(entry: WeekEntry): WeekEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as WeekEntry;
}

/**
 * A held seat is not at risk from seat availability: the attendee already has it. The guardrail
 * judges a candidate's seats, so a reserved session is checked as if seats were available; its
 * clashes, walks, meal break and day load are judged as usual.
 */
function asHeld(session: NormalisedSession): NormalisedSession {
  return { ...session, seatAvailability: 'available' };
}

/** check_itinerary. */
export async function checkItinerary(
  input: McpToolInput<'check_itinerary'>,
  ctx: ToolContext,
): Promise<ToolOutcome<'check_itinerary'>> {
  const commitments = input.commitments ?? [];
  const proposedRaw = commitments.flatMap((c) => (c.kind === 'personalTime' ? [] : [c.sessionId]));
  const proposedPersonal = commitments.filter((c): c is PersonalTime => c.kind === 'personalTime');
  const identifiers = checkIdentifiers(proposedRaw);
  if (!identifiers.ok) {
    throw new CompassError('IdentifierRejected');
  }
  await ensureSignedIn(ctx);
  const { rules, events } = ctx.runtime;
  const catalog = await events.catalog();
  // Codes such as BWP213 are accepted wherever a session id is (task 38).
  const resolve = sessionIdResolver(catalog);
  const proposedIds = [...new Set(proposedRaw.map(resolve))];
  for (const id of proposedIds) {
    if (!catalog.byId.has(id)) {
      throw new CompassError('UnknownSession');
    }
  }

  const { schedule } = await readFreshSchedule(ctx);
  const reservedIds = schedule.reserved.filter((id) => catalog.byId.has(id));
  const reservedSet = new Set(reservedIds);
  const weekSessions: { session: NormalisedSession; status: 'reserved' | 'proposed' }[] = [
    ...reservedIds.map((id) => ({
      session: catalog.byId.get(id)!.session,
      status: 'reserved' as const,
    })),
    ...proposedIds
      .filter((id) => !reservedSet.has(id))
      .map((id) => ({ session: catalog.byId.get(id)!.session, status: 'proposed' as const })),
  ];
  const scheduledPersonal = confirmedCommitments(schedule, catalog).filter(
    (c): c is PersonalTime => c.kind === 'personalTime',
  );
  const personal: PersonalTime[] = [...scheduledPersonal, ...proposedPersonal];

  // A reserved session is judged against the rest of the schedule as it is, so a proposal never
  // makes a booking look wrong; a proposed session is judged against everything else in the week.
  const checked: CheckedSession[] = [];
  for (const [index, entry] of weekSessions.entries()) {
    const others: Commitment[] = [
      ...weekSessions
        .filter(
          (other, i) => i !== index && (entry.status === 'proposed' || other.status === 'reserved'),
        )
        .map(({ session }) => commitmentFor(session)),
      ...(entry.status === 'proposed' ? personal : scheduledPersonal),
    ];
    const candidate = entry.status === 'reserved' ? asHeld(entry.session) : entry.session;
    let verdict: Verdict;
    try {
      verdict = await rules.checkReservation(candidate, others, catalog);
    } catch {
      // S2 never throws by design; if it does, the safe answer is to block.
      verdict = {
        decision: 'block',
        reasons: ['Compass could not check this session, so it is blocked.'],
      };
    }
    checked.push({ session: entry.session, status: entry.status, verdict });
  }
  const verdict = combineVerdicts(
    checked.map(({ session, verdict: v }) => ({ code: session.code, verdict: v })),
  );

  const week: WeekEntry[] = [
    ...checked.map(({ session, status, verdict: v }) =>
      present({
        kind: 'reservedSession',
        status,
        sessionId: session.sessionId,
        code: session.code,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        venue: session.venue,
        room: session.room,
        verdict: v,
      }),
    ),
    ...scheduledPersonal.map((time) =>
      present({
        kind: 'personalTime',
        status: 'reserved',
        personalTimeId: time.personalTimeId,
        title: time.title,
        startsAt: time.startsAt,
        endsAt: time.endsAt,
        venue: time.location,
      }),
    ),
    ...proposedPersonal.map((time) =>
      present({
        kind: 'personalTime',
        status: 'proposed',
        title: time.title,
        startsAt: time.startsAt,
        endsAt: time.endsAt,
        venue: time.location,
      }),
    ),
    // Two unreadable times give Infinity - Infinity, which is NaN; the sort reads that as equal and
    // keeps their order, so entries without a readable time stay last in the order they came.
  ].sort((a, b) => startOf(a.startsAt) - startOf(b.startsAt));

  // A proposed session that blocks is the one to rebook; otherwise the first blocked booking.
  const blocked =
    checked.find((c) => c.status === 'proposed' && c.verdict.decision === 'block') ??
    checked.find((c) => c.verdict.decision === 'block');
  const confirmed: Commitment[] = [
    ...checked.filter((c) => c !== blocked).map(({ session }) => commitmentFor(session)),
    ...personal,
  ];
  const suggestions =
    blocked === undefined
      ? undefined
      : await suggestForBlock(blocked.session, confirmed, rules, catalog, schedule.favorites);

  const reservedCount = checked.filter((c) => c.status === 'reserved').length;
  const proposedCount = checked.length - reservedCount;
  const lines = [
    `Verdict: ${verdict.decision}.`,
    `Your week: ${reservedCount} reserved ${reservedCount === 1 ? 'session' : 'sessions'}` +
      (proposedCount > 0 ? `, ${proposedCount} proposed` : '') +
      `, ${personal.length} personal time ${personal.length === 1 ? 'block' : 'blocks'}.`,
    ...(checked.some((c) => c.status === 'proposed' && c.verdict.decision === 'block')
      ? ['Do not reserve these sessions as they are.']
      : []),
    ...(checked.some((c) => c.status === 'reserved' && c.verdict.decision === 'block')
      ? ['Your schedule already has a booking that does not work; see the reasons.']
      : []),
  ];
  // Sessions come from the catalog; personal time is the attendee's own text, so it gets its own
  // block with the attendee preamble, as in show_schedule. Both are in the week's time order.
  lines.push(
    labelUntrusted('catalog', {
      sessions: week
        .filter((entry) => entry.kind === 'reservedSession')
        .map((entry) => ({
          status: entry.status,
          sessionId: entry.sessionId,
          code: entry.code,
          title: entry.title,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          venue: entry.venue,
          room: entry.room,
          verdict: entry.verdict?.decision,
          reasons: entry.verdict?.reasons,
        })),
      reasons: verdict.reasons,
      rebooking: suggestions?.rebooking.map((option) => ({
        code: option.session.code,
        title: option.session.title,
        reason: option.reason,
      })),
      safeSwap: suggestions?.swap?.steps,
    }),
  );
  if (personal.length > 0) {
    lines.push(
      labelUntrusted('attendee', {
        personalTime: week
          .filter((entry) => entry.kind === 'personalTime')
          .map((entry) => ({
            status: entry.status,
            personalTimeId: entry.personalTimeId,
            title: entry.title,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            location: entry.venue,
          })),
      }),
    );
  }
  const notInCatalog = schedule.reserved.filter((id) => !catalog.byId.has(id));
  if (notInCatalog.length > 0) {
    lines.push(
      `${notInCatalog.length} reserved ${notInCatalog.length === 1 ? 'session is' : 'sessions are'} not in the catalog Compass has cached, so ${notInCatalog.length === 1 ? 'it was' : 'they were'} not checked. Run refresh_catalog if ${notInCatalog.length === 1 ? 'it should be' : 'they should be'}.`,
      labelUntrusted('catalog', { notInCatalog }),
    );
  }
  return { ok: true, structured: { verdict, week }, text: lines.join('\n') };
}
