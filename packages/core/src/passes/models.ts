// S4-owned data model shapes for the pass side (boarding-passes, S4).
//
// S4 defines only the small local shapes it owns. Every wire and pass shape
// (PassFields, Commitment, NormalisedSession and the rest) is imported from
// @compass/contracts and never redefined here. Under nodenext resolution with
// verbatimModuleSyntax, these are type-only imports and this file emits no
// JavaScript.
import type { Commitment, NormalisedSession, PassFields } from '@compass/contracts';

/**
 * The event window from GetEvent, passed to createPassFieldsSchema. start and end
 * are ISO 8601 with offset; timezone is the IANA zone id.
 */
export interface EventWindow {
  start: string;
  end: string;
  timezone: string;
}

/**
 * The Issued_Pass_Record entry for one pass (personal data record P5). It holds only
 * the serial number, the session code, a hash of the pass fields and the platforms
 * the pass was issued for. It never holds the ID token or the attendee email.
 */
export interface IssuedPass {
  serialNumber: string;
  sessionCode: string;
  fieldsHash: string;
  platforms: ('apple' | 'google')[];
}

/**
 * The local Issued_Pass_Record: the full set of issued passes.
 */
export interface IssuedPassRecord {
  passes: IssuedPass[];
}

/**
 * One itinerary entry for the Ics_Exporter and the Itinerary_Page. The commitment is
 * a reserved session or a layover from @compass/contracts. walkMinutes is the walk
 * resolved upstream by the Pass_Builder for a reserved commitment that has an earlier
 * commitment; it is absent when there is no earlier commitment or the walk is unknown,
 * so the Ics_Exporter can add the leave-now alarm without a ConnectionProvider.
 */
export interface ItineraryCommitment {
  commitment: Commitment;
  walkMinutes?: number;
}

/**
 * One itinerary: the ordered commitments for the attendee's week.
 */
export interface Itinerary {
  commitments: ItineraryCommitment[];
}

/**
 * The include flags S4 sends when creating a hand-off: which artifacts the phone may
 * collect.
 */
export interface IncludeFlags {
  apple: boolean;
  google: boolean;
  calendar: boolean;
}

/**
 * The input to a sync run. S1 resolves the schedule's reserved ids to the normalised
 * sessions before S4 diffs them, so Pass_Sync works over NormalisedSession values
 * keyed by their code.
 */
export interface SyncInput {
  sessions: NormalisedSession[];
}

/**
 * The session the Pass_Builder turns into a pass: a NormalisedSession from
 * @compass/contracts, already normalised by S1.
 */
export type BuildSession = NormalisedSession;

/**
 * The commitment immediately before a session, used to populate walkFromPrevious. The
 * builder reads its venue and pairs it with the ConnectionProvider walk minutes.
 */
export interface AdjacentCommitment {
  commitment: Commitment;
}

/**
 * The reserved session that follows, used to populate nextConnection. It carries the
 * following session code, start and venue; the builder adds the walk minutes.
 */
export interface AdjacentSession {
  sessionCode: string;
  startsAt: string;
  venue: string;
}

/**
 * The pass-building function Pass_Sync injects. Given a session code it returns the
 * rebuilt, validated PassFields used for the changed-case hash comparison and for the
 * PUT update body.
 */
export type BuildPassFn = (sessionCode: string) => PassFields;
