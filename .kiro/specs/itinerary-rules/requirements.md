# Requirements Document

## Introduction

This document specifies the itinerary rules engine (stream S2) for re:Invent Compass. The engine answers one question for the attendee: can I get into this session on time and safely, given everything else on my week. It computes boarding times, walking connections between venues, clashes, layovers (personal time for meals and rest), an energy budget per day, and rebooking options, and it packages all of these into a single guardrail function, checkReservation, that returns a Verdict of allow, warn or block with plain-English reasons.

The engine is pure. It performs no input or output, reads no files at runtime, and imports nothing from Node. It is browser-safe because the showcase site (stream S7) runs it directly through the subpath export @compass/core/rules, the same code the MCP server (S3) and the Kiro hook call. The engine owns packages/core/src/rules and data/venues.json only. It reuses the shared domain types Verdict, Venue, NormalisedSession and Commitment from @compass/contracts and never redefines them.

The engine takes its schedule as a Commitment array plus a sessions lookup. The Commitment array is the attendee's itinerary. The sessions lookup is a map of NormalisedSession keyed by sessionId. The engine resolves each piece of commitment data from a concrete input source. A commitment's venue is resolved from NormalisedSession.venue, or for a reservedSession from Commitment.venue, or for a personalTime from Commitment.location. A commitment's all-day status comes from NormalisedSession.isAllDay. A commitment's times come from the optional NormalisedSession.startsAt and NormalisedSession.endsAt together with NormalisedSession.missingFields, which lists the field names the normaliser left absent. A session's reservability comes from NormalisedSession.isReservable.

The engine follows the product voice: plain English, short sentences, and no em dash or en dash anywhere, including in this document. It is honest about uncertainty: when data is missing, it says so with a reason and never invents a value. All times are interpreted in the event's local timezone, which comes from GetEvent and is passed in as Context, and all time arithmetic is DST-safe. The engine never reads the system clock. It always takes the current instant from Context.now.

This document uses the airline metaphor from the product steering: boarding closes (session start minus 10 minutes), connection (walk between two consecutive commitments), tight connection, layover (personal time), rebooking (moving to a repeat), and standby (favorites kept as backups).

## Glossary

- **Rules_Engine**: The pure, browser-safe set of functions in packages/core/src/rules that computes boarding times, connections, clashes, layovers, energy budget, rebooking options, safe swaps, and the checkReservation verdict.
- **Commitment**: One entry on the attendee's itinerary, from @compass/contracts. Either a reserved session (kind reservedSession) or personal time (kind personalTime). Each carries startsAt and endsAt as ISO 8601 strings with offset.
- **NormalisedSession**: The internal view of a catalog session, from @compass/contracts. Carries sessionId, code, title, type, level, venue, room, startsAt, endsAt, isAllDay, isReservable, seatAvailability, repeatOf, and missingFields.
- **Schedule_Input**: The engine's view of the itinerary: a Commitment array plus a Sessions_Lookup. The engine reads every commitment from these two inputs.
- **Sessions_Lookup**: A map of NormalisedSession keyed by sessionId, supplied with the Commitment array. The engine uses it to resolve venue, all-day status, times, and reservability for a reservedSession.
- **Venue_Resolution**: The rule for finding a commitment's venue: use NormalisedSession.venue when present, otherwise for a reservedSession use Commitment.venue, otherwise for a personalTime use Commitment.location.
- **Venue**: A named place, from @compass/contracts, with an optional coordinates object. Backed by data/venues.json.
- **Verdict**: The guardrail outcome, from @compass/contracts. A discriminated union over decision allow, warn or block, each carrying a reasons array of strings. warn and block always carry at least one reason.
- **Venue_Data**: The data/venues.json file: a wrapper object holding the main re:Invent 2026 venues, their coordinates, a walking-time matrix, and a source note on each value. The file is not a bare Venue array.
- **Walking_Time_Matrix**: The part of Venue_Data that gives walking minutes between each pair of named venues.
- **Boarding_Closes**: The moment a reserved seat is released to walk-ups, equal to the session start minus 10 minutes, for reservable sessions only.
- **Reservable_Type**: A documentation label for the eight session types that re:Invent treats as requiring a reservation: bootcamp, technical session, chalk talk, code talk, exam prep, gamified learning, select lab, and workshop. This label is reference only. The engine decides reservability from NormalisedSession.isReservable, not from the type name.
- **Non_Reservable_Type**: A documentation label for the two session types that re:Invent treats as needing no reservation: keynote and lecture-style breakout. This label is reference only. The engine decides reservability from NormalisedSession.isReservable, not from the type name.
- **Connection**: The walk between two consecutive commitments. Classified as comfortable, tight, impossible, or unknown.
- **Tight**: The single definition shared by the connection rules and the guardrail. A Connection is tight when the walking time (the Walking_Time_Matrix value plus Buffer) leaves fewer than tightMarginMinutes of spare time before the next item is due, where tightMarginMinutes is taken from Context. All tight checks in this document use this one definition.
- **Buffer**: The minutes added to raw walking time to allow for queues, elevators, and finding the room. Taken from Context.bufferMinutes, default 10 minutes.
- **Layover**: A block of personal time for a meal, water, or rest.
- **Meal_Window**: The daily window in which the attendee should have at least a set number of free minutes to eat. Supplied in Context, with a default of 11:30 to 14:00 needing 30 free minutes.
- **Energy_Budget**: A per-day score from a named, explainable formula over the count of commitments, the total walking minutes, and the number of venue changes on that day, used to flag overloaded days. The formula is defined in Requirement 5.
- **Repeat**: A later run of the same session, identified by the same base code with a -R suffix.
- **Standby**: A favorited session held as a backup, not reserved.
- **Walk_Up**: Attending without a reservation by joining the walk-up line.
- **Safe_Swap**: An ordered set of steps that moves the attendee from a full or problematic session to a repeat without ever leaving the attendee with no seat.
- **Context**: The runtime input passed to the engine. It carries the Event_Timezone, the event window, the Venue_Data, and the tuning values below. Callers source it from GetEvent and the venues file. The engine never hard-codes these values and never reads the system clock; it takes the current instant only from Context.now. Context carries:
  - **now**: The current instant as an ISO 8601 string with offset. The engine uses this as the current time for every time-dependent result. There is no default; the caller always supplies it.
  - **mealWindow**: The Meal_Window start, end, and required free minutes. Default 11:30 to 14:00 needing 30 free minutes.
  - **maxStretchMinutes**: The longest unbroken stretch of commitments before the engine flags it. Default 180 minutes.
  - **overloadThreshold**: The Energy_Budget value above which a day is flagged overloaded. Default 100.
  - **tightMarginMinutes**: The spare minutes below which a Connection is tight. Default 5 minutes.
  - **bufferMinutes**: The minutes added to raw walking time for queues, elevators, and finding the room. Default 10 minutes.
- **Event_Timezone**: The IANA timezone of the event, supplied in Context, in which all commitment times are interpreted.

## Requirements

### Requirement 1: Boarding time

**User Story:** As a first-time attendee, I want to know when my seat is released, so that I arrive before the walk-up line takes it.

#### Acceptance Criteria

1. WHERE NormalisedSession.isReservable is true, THE Rules_Engine SHALL compute Boarding_Closes as the session start time minus 10 minutes, and SHALL express Boarding_Closes in the Event_Timezone supplied in Context.
2. WHERE NormalisedSession.isReservable is false, THE Rules_Engine SHALL return a boarding result of "not applicable" and SHALL state that the session needs no reservation.
3. THE Rules_Engine SHALL decide reservability from NormalisedSession.isReservable, and SHALL NOT decide reservability from the session type name.
4. THE Rules_Engine SHALL treat the eight Reservable_Type names and the two Non_Reservable_Type names listed in the Glossary as documentation only, and SHALL NOT use those names as the reservability decision mechanism.
5. IF NormalisedSession.startsAt is absent, or sessionId names the field in NormalisedSession.missingFields, THEN THE Rules_Engine SHALL return a boarding result of "unknown" and SHALL state that the start time is missing, and SHALL NOT return a Boarding_Closes value.
6. IF NormalisedSession.isReservable is absent for the session, THEN THE Rules_Engine SHALL return a boarding result of "unknown" and SHALL state that the reservability flag is missing, and SHALL NOT return a Boarding_Closes value.
7. WHEN computing Boarding_Closes, THE Rules_Engine SHALL interpret the session start time in the Event_Timezone supplied in Context.
8. IF Context does not supply an Event_Timezone, THEN THE Rules_Engine SHALL return a boarding result of "unknown" and SHALL state that the timezone is missing, and SHALL NOT return a Boarding_Closes value.

### Requirement 2: Connections between commitments

**User Story:** As an attendee moving between venues, I want to know whether I can make the walk in time, so that I do not lose a seat on the way.

#### Acceptance Criteria

1. WHEN two commitments are consecutive, THE Rules_Engine SHALL compute the Connection walking minutes as the Walking_Time_Matrix value between the two venues plus the Buffer from Context.bufferMinutes.
2. IF the attendee arrives at or before the next commitment's due time with tightMarginMinutes or more minutes to spare, THEN THE Rules_Engine SHALL classify the Connection as "comfortable", where the due time is Boarding_Closes for a reservable next commitment and the next commitment's start time otherwise, and tightMarginMinutes comes from Context.
3. IF the attendee arrives at or before the next commitment's due time with fewer than tightMarginMinutes minutes to spare, THEN THE Rules_Engine SHALL classify the Connection as "tight", using the shared Tight definition from the Glossary.
4. IF the attendee arrives after the next commitment's due time, THEN THE Rules_Engine SHALL classify the Connection as "impossible".
5. IF either commitment has no venue after Venue_Resolution (NormalisedSession.venue, then Commitment.venue for a reservedSession, then Commitment.location for a personalTime), THEN THE Rules_Engine SHALL classify the Connection as "unknown" and SHALL state the reason, naming the commitment whose venue is missing.
6. IF a named venue is absent from the Walking_Time_Matrix, THEN THE Rules_Engine SHALL classify the Connection as "unknown" and SHALL state the reason, naming the unmatched venue.
7. IF the next commitment is reservable and has no Boarding_Closes available, THEN THE Rules_Engine SHALL classify the Connection as "unknown" and SHALL state that the next commitment's boarding time is missing.
8. WHERE the next commitment is not reservable and so has no Boarding_Closes, THE Rules_Engine SHALL judge the Connection against the next commitment's start time instead of returning "unknown", classifying it comfortable, tight, or impossible by the same spare-time rules measured against that start time.
9. THE Rules_Engine SHALL attach a plain-English reason to every Connection classification that names the two venues and the computed walking minutes, stating the walk, the buffer and the total separately, and stating "an estimate" when the walking time is an estimate. Spare time SHALL be shown rounded down and lateness rounded up.
10. WHEN classifying a Connection, THE Rules_Engine SHALL interpret both commitment times in the Event_Timezone supplied in Context.

### Requirement 3: Clashes

**User Story:** As an attendee, I want overlapping commitments flagged, so that I do not double-book myself.

#### Acceptance Criteria

1. WHEN two commitments overlap in time by one second or more in the Event_Timezone, THE Rules_Engine SHALL report a clash between the two commitments.
2. WHERE a commitment's NormalisedSession.isAllDay is true, THE Rules_Engine SHALL treat the all-day item as occupying from 00:00:00 to 23:59:59 of the event day in the Event_Timezone when checking for clashes.
3. WHEN a commitment starts on one event day and ends on the next event day in the Event_Timezone, THE Rules_Engine SHALL evaluate the clash across the day boundary using the commitment start and end instants.
4. WHEN two commitments share the same start instant and the same end instant, and the end is after the start, THE Rules_Engine SHALL report a clash. A commitment whose end is not after its start is bad data and falls under criterion 10.
5. WHEN one commitment ends at the same instant that the next commitment starts, THE Rules_Engine SHALL report no clash for that pair.
6. WHEN evaluating clashes, THE Rules_Engine SHALL interpret all commitment times in the Event_Timezone supplied in Context.
7. IF a commitment's end time is missing, shown by an absent NormalisedSession.endsAt or by endsAt being named in NormalisedSession.missingFields, THEN THE Rules_Engine SHALL report the clash check result for that commitment as "unknown", SHALL state in the reason that the end time is missing, and SHALL NOT report a clash or no clash for any pair that includes that commitment.
8. IF the Event_Timezone is absent from Context, THEN THE Rules_Engine SHALL report the clash check result as "unknown" and SHALL state in the reason that the Event_Timezone is missing.
9. THE Rules_Engine SHALL attach a plain-English reason to every reported clash that names the two clashing commitments and their overlapping time range in the Event_Timezone.
10. IF a commitment's end time is not after its start time, THEN THE Rules_Engine SHALL treat the commitment as bad data, SHALL report the clash check result for it as "unknown" with a reason saying the end is not after the start, and SHALL NOT report a clash or no clash for any pair that includes it. A zero-length point strictly inside another interval is a clash when intervals are compared directly.

### Requirement 4: Layovers and personal time

**User Story:** As an attendee, I want the engine to protect time for meals and rest, so that I do not burn out mid-week.

#### Acceptance Criteria

1. WHEN a day has fewer than 30 free minutes inside the Meal_Window, where free minutes are minutes not overlapping any commitment, THE Rules_Engine SHALL report that the day has no meal Layover.
2. THE Rules_Engine SHALL use a default Meal_Window of 11:30 to 14:00 requiring 30 free minutes, in the Event_Timezone, and SHALL accept an overriding Meal_Window from Context.
3. THE Rules_Engine SHALL use a default maximum unbroken stretch of 180 minutes, and SHALL accept an overriding maximum from Context.
4. WHEN a day contains an unbroken stretch of commitments longer than the maximum unbroken stretch, THE Rules_Engine SHALL report the stretch as a long unbroken stretch.
5. WHEN the Rules_Engine reports a missing meal Layover or a long unbroken stretch, THE Rules_Engine SHALL produce one or more suggested personal-time blocks, each with a start time, an end time, and a plain-English reason.
6. WHEN proposing a suggested personal-time block, THE Rules_Engine SHALL place the block in a gap that does not clash with any existing commitment.
7. IF no clash-free gap exists for a suggested personal-time block, THEN THE Rules_Engine SHALL report that no personal-time block could be placed and SHALL state the reason.
8. WHEN evaluating meal windows and stretches, THE Rules_Engine SHALL interpret all times in the Event_Timezone supplied in Context.

### Requirement 5: Energy budget per day

**User Story:** As an attendee, I want each day scored for load, so that I can see which days are too packed before I commit to them.

Note: This is cut-list item 2 and is built last.

#### Acceptance Criteria

1. WHEN scoring a day, THE Rules_Engine SHALL compute the Energy_Budget using this named formula: Energy_Budget equals (commitmentCount times 10) plus totalWalkingMinutes plus (venueChangeCount times 15), where commitmentCount is the number of commitments on the day, totalWalkingMinutes is the sum of Connection walking minutes between consecutive commitments, and venueChangeCount is the number of consecutive commitment pairs whose venues differ.
2. WHEN a day has fewer than two commitments, THE Rules_Engine SHALL compute the venue-change count as zero and the total walking minutes as zero.
3. THE Rules_Engine SHALL take the overload threshold from Context.overloadThreshold.
4. IF an Energy_Budget is strictly greater than the overload threshold, THEN THE Rules_Engine SHALL flag the day as overloaded.
5. IF an Energy_Budget is equal to or less than the overload threshold, THEN THE Rules_Engine SHALL not flag the day as overloaded.
6. THE Rules_Engine SHALL return, with each Energy_Budget, a plain-English explanation naming the commitment count, the total walking minutes, the venue-change count, and the formula that produced the score.
7. IF a commitment on the day has no venue after Venue_Resolution or no usable time from NormalisedSession.startsAt and NormalisedSession.endsAt with NormalisedSession.missingFields, THEN THE Rules_Engine SHALL include that commitment in the count, SHALL exclude it from the walking minutes and venue-change totals, and SHALL state in the explanation that data was missing and name the affected commitment.
8. WHEN computing venue changes and walking minutes for a day, THE Rules_Engine SHALL interpret all times in the Event_Timezone supplied in Context.
9. WHERE the Energy_Budget score (this cut-list item 2) is cut from the build, THE Rules_Engine SHALL retain a count-only overload check that flags the day as overloaded when the commitment count alone is strictly greater than Context.overloadThreshold, so the guardrail in Requirement 8 still has a basis.

### Requirement 6: Rebooking options

**User Story:** As an attendee whose session is full or problematic, I want alternative ways to attend, so that I still get the content.

#### Acceptance Criteria

1. WHEN a session is flagged full or problematic, THE Rules_Engine SHALL find Repeat sessions by matching the same base code with a -R suffix and SHALL include only sessions whose start time is after Context.now, interpreted in the Event_Timezone, where Context.now is the current time and the engine never reads the system clock.
2. WHEN a session is flagged full or problematic, THE Rules_Engine SHALL list favorited sessions held as Standby that share the same base code and whose start time is after Context.now in the Event_Timezone.
3. WHEN a session is flagged full or problematic, THE Rules_Engine SHALL list Walk_Up options for the same base code whose start time is after Context.now in the Event_Timezone.
4. THE Rules_Engine SHALL attach a plain-English reason, of 1 to 200 characters, to each rebooking option, naming why that option is offered.
5. IF no Repeat, Standby, or Walk_Up option exists for the base code, THEN THE Rules_Engine SHALL return a set of zero options and SHALL include a plain-English message stating that no alternative was found.
6. WHEN evaluating rebooking options, THE Rules_Engine SHALL interpret all session times in the Event_Timezone supplied in Context.
7. IF the Event_Timezone is absent from Context, THEN THE Rules_Engine SHALL return zero options and SHALL include a plain-English message indicating that the timezone is missing, and SHALL leave the input schedule unchanged.

### Requirement 7: Safe swap

**User Story:** As an attendee moving to a repeat, I want an ordered set of steps that never leaves me without a seat, so that a swap is always safe.

Note: The safe-swap function takes a confirmation schedule as an input parameter. The caller reads GetSchedule and passes the resulting schedule in. The engine does no I/O; it only inspects the schedule it is given. Clash and timing checks use Context.now, not a system clock.

#### Acceptance Criteria

1. WHEN a Safe_Swap to a Repeat is requested, THE Rules_Engine SHALL produce an ordered list of three steps: first reserve the Repeat, second confirm the reservation by inspecting the confirmation schedule passed in by the caller (which the caller obtained from GetSchedule), third cancel the original reservation.
2. WHEN the Repeat reservation step is produced, THE Rules_Engine SHALL mark the cancel-original step as blocked until the confirmation schedule input shows that the Repeat is held.
3. IF the Repeat clashes with the original or with any other commitment, THEN THE Rules_Engine SHALL report that the swap cannot be made safely, SHALL name each commitment the Repeat clashes with, and SHALL leave the original reservation unchanged.
4. WHERE the Repeat does not clash with the original or any other commitment, THE Rules_Engine SHALL confirm that the swap can be made safely.
5. IF the confirmation schedule input does not show the Repeat as held, THEN THE Rules_Engine SHALL report that the swap cannot be completed, SHALL mark the swap outcome as failed, and SHALL leave the original reservation unchanged.
6. THE Rules_Engine SHALL attach a plain-English reason to each of the three steps and to the overall swap outcome.
7. WHEN evaluating whether the Repeat clashes, THE Rules_Engine SHALL interpret all commitment times in the Event_Timezone supplied in Context.
8. IF any other commitment cannot be checked for a clash (its times are missing or bad), THEN THE Rules_Engine SHALL mark the swap outcome as "unknown" with a reason naming that commitment, and SHALL NOT mark the swap safe. A known clash is still reported as unsafe first.

### Requirement 8: checkReservation guardrail

**User Story:** As a caller that is about to write a reservation, I want one function that tells me allow, warn or block with reasons, so that every surface enforces the same guardrail.

#### Acceptance Criteria

1. THE Rules_Engine SHALL expose a single function checkReservation that takes a candidate session as a NormalisedSession, the current schedule as a Commitment array plus a Sessions_Lookup (a map of NormalisedSession keyed by sessionId), and Context, and returns exactly one Verdict whose decision is allow, warn, or block.
2. IF the candidate clashes with an existing commitment, THEN THE checkReservation function SHALL return a Verdict with decision "block" and SHALL name the clashing commitment in the reasons.
3. IF the candidate creates an impossible Connection to or from an adjacent commitment, and the walking time is official, THEN THE checkReservation function SHALL return a Verdict with decision "block" and SHALL name the impossible Connection in the reasons. IF the walking time is an estimate, THEN the Verdict SHALL be "warn" with a reason that the connection is likely impossible.
4. WHEN the candidate creates a tight Connection, using the shared Tight definition from the Glossary (walking time, the Walking_Time_Matrix value plus Buffer, leaves fewer than tightMarginMinutes of spare time before the next item is due), THE checkReservation function SHALL return a Verdict with decision "warn" and SHALL name the tight Connection in the reasons.
5. WHEN the candidate removes the day's only meal Layover, THE checkReservation function SHALL return a Verdict with decision "warn" and SHALL name the lost meal Layover in the reasons.
6. WHEN the candidate raises the day's Energy_Budget above the defined overload threshold, THE checkReservation function SHALL return a Verdict with decision "warn" and SHALL name the overload in the reasons.
7. IF the candidate or the schedule is missing data needed to judge a rule, THEN THE checkReservation function SHALL skip that rule without blocking on it, SHALL return a Verdict with decision at least "warn", and SHALL state in the reasons that the data for that rule was missing and name the rule that could not be judged.
8. WHERE more than one rule applies to the same candidate, THE checkReservation function SHALL return a single Verdict whose decision is "block" if any block rule applies, otherwise "warn" if any warn rule or any missing-data case applies, otherwise "allow", and SHALL include one reason for every rule that applied.
9. WHERE no clash, impossible Connection, tight Connection, lost meal Layover, missing data, or overload applies, THE checkReservation function SHALL return a Verdict with decision "allow", and WHERE missing data applies THE checkReservation function SHALL return a Verdict with decision "warn" rather than "allow".
10. THE checkReservation function SHALL return every reason as plain English with no em dash and no en dash.

### Requirement 9: Venue data file

**User Story:** As a maintainer, I want venue data with cited sources, so that walking times are trustworthy and honest about estimates.

#### Acceptance Criteria

1. THE Venue_Data SHALL be a wrapper object holding a venues list, a Walking_Time_Matrix, and source notes, and SHALL NOT be a bare Venue array.
2. THE venues list SHALL contain only the main re:Invent 2026 venues that are named on official AWS re:Invent pages, and each venue entry SHALL carry a non-empty name, with optional coordinates given as a latitude from -90 to 90 and a longitude from -180 to 180.
3. THE Venue_Data SHALL include a Walking_Time_Matrix that gives, for each ordered pair of distinct named venues, a walking time in whole minutes from 0 to 240.
4. THE Venue_Data SHALL carry a source note on every walking time value and on every coordinate value, and each source note SHALL be either "official" with a URL to the official AWS re:Invent page the value came from, or "estimate".
5. IF a walking time value or a coordinate value has no official AWS re:Invent source, THEN THE Venue_Data SHALL mark that value as "estimate" in its source note.
6. THE Venue_Data wrapper schema SHALL reuse the VenueSchema from @compass/contracts for each venue entry, and a test SHALL validate the whole Venue_Data file against that wrapper schema.
7. IF any venue entry fails VenueSchema validation, THEN THE Rules_Engine SHALL reject the Venue_Data and SHALL state which entry failed and why.
8. IF a venue referenced by the Walking_Time_Matrix is absent from the venues list, THEN THE Rules_Engine SHALL treat any Connection using that venue as "unknown" and SHALL state the reason.
9. IF the Walking_Time_Matrix has no value for an ordered pair of listed venues used by a Connection, THEN THE Rules_Engine SHALL treat that Connection as "unknown" and SHALL state the reason.

### Requirement 10: Purity and browser safety

**User Story:** As the showcase site and the MCP server, I want the rules engine to run anywhere with no side effects, so that the same code guards bookings and powers the browser demo.

#### Acceptance Criteria

1. THE Rules_Engine SHALL perform no network calls, file reads, file writes, console output, timer calls, or any other input or output operation at runtime.
2. THE Rules_Engine SHALL import nothing from Node built-in modules, so that a static scan of its source and its transitive imports finds zero references to Node built-in modules.
3. WHEN loaded in a browser through the @compass/core/rules subpath export, THE Rules_Engine SHALL execute every exported function without throwing a reference error for a missing runtime global.
4. THE Rules_Engine SHALL import the Verdict, Venue, NormalisedSession, and Commitment types from @compass/contracts and SHALL NOT declare any local type that redefines those four types.
5. WHEN any exported function is called two or more times with inputs that are deeply equal, THE Rules_Engine SHALL return results that are deeply equal across all calls.
6. THE Rules_Engine SHALL leave every input value unmodified, so that each input is deeply equal to its pre-call state after the call returns.

### Requirement 11: Timezone and uncertainty discipline

**User Story:** As an attendee in a single event timezone, I want correct local times and honest gaps, so that the engine never misleads me.

#### Acceptance Criteria

1. THE Rules_Engine SHALL interpret every commitment and session time in the Event_Timezone supplied in Context.
2. THE Rules_Engine SHALL split its time work into two kinds. For durations and elapsed time, THE Rules_Engine SHALL compute on the absolute instants, which are the ISO 8601 strings with offset. For day bucketing (grouping commitments by day) and meal-window placement, THE Rules_Engine SHALL use Event_Timezone local wall-clock time computed through Intl, for example Intl.DateTimeFormat with the timeZone option. WHEN the local offset of the Event_Timezone changes at any point inside the event window, THE Rules_Engine SHALL compute boarding, connection, and clash results so that the change in offset does not shift any computed result by any number of minutes.
3. IF Context carries no Event_Timezone, THEN THE Rules_Engine SHALL return "unknown" for any time-dependent result and SHALL state that the event timezone is missing, and SHALL NOT substitute a default timezone.
4. IF the Event_Timezone in Context is not a recognised IANA timezone name, THEN THE Rules_Engine SHALL return "unknown" for any time-dependent result and SHALL state that the event timezone is unrecognised, and SHALL NOT substitute a default timezone.
5. WHERE a required field is missing, such as a venue, a start time, or an end time, THE Rules_Engine SHALL return "unknown" for the affected result and SHALL state the reason, and SHALL NOT substitute a default value.
6. THE Rules_Engine SHALL phrase every reason and warning in plain English, with each sentence no longer than 20 words and with no em dash or en dash.
7. THE Rules_Engine SHALL show every name that came from outside (a session code, a title, a venue name) in double quotes, capped at four words and 30 characters counted by code point, with control characters, format characters and line or paragraph separators removed, and any double quote inside a name replaced by a single quote. A value that is not text SHALL be treated as missing and SHALL NOT cause an error. Consumers SHALL show reasons as plain text only.

### Requirement 12: Testing and coverage

**User Story:** As the owner, I want the engine proven against the hard edges, so that I trust it on the day.

#### Acceptance Criteria

1. THE Rules_Engine test suite SHALL frame the edge cases as property-style tests, running property-based testing over generated inputs, and SHALL cover at least these cases, each asserting the exact verdict the engine returns: a commitment that crosses midnight, an all-day item, a commitment with a missing venue, a commitment with a missing end time, a commitment with identical start and end times (bad data, so "unknown" and warn), and date arithmetic across a daylight saving time change.
2. THE Rules_Engine test suite SHALL achieve 100 percent coverage of lines, branches, functions and statements over the source files this spec owns, where the only permitted exclusions are the generated types named in the build plan, and WHERE coverage of any owned file falls below 100 percent on any of those four measures THE test run SHALL fail.
3. WHEN the test suite runs, THE Rules_Engine test suite SHALL check every reason string and every warning string the engine can produce, and THE test run SHALL fail IF any such string contains an em dash character or an en dash character.
4. WHEN the test suite runs, THE Rules_Engine test suite SHALL scan the engine source files this spec owns for imports of Node built-in modules, and THE test run SHALL fail IF any such import is found.
5. THE Rules_Engine test suite SHALL keep all test sample data self-made under packages/core/test/rules, and the tests SHALL NEVER read from fixtures/synthetic, per ADR-025.

### Requirement 13: Input validation and failing closed

**User Story:** As a caller of the guardrail, I want bad settings and bad data to be refused loudly, so that a wrong input never turns into an "allow".

#### Acceptance Criteria

1. THE withContextDefaults function SHALL treat a tuning value that is undefined as left out and use its default, and SHALL keep a present value exactly as given.
2. THE ContextSchema SHALL require finite numbers, bufferMinutes from 0 to 120, tightMarginMinutes from 0 to 60, maxStretchMinutes from 1 to 1440, overloadThreshold and overloadCountThreshold finite and above 0, requiredFreeMinutes from 0 to 1440, a meal window that ends after it starts, and a text eventTimezone when present.
3. THE checkReservation function SHALL validate Context with ContextSchema, including the venue data, and IF it is invalid THEN SHALL return a Verdict with decision "warn" and a reason naming the setting, and SHALL NOT return "allow".
4. THE VenueDataSchema SHALL require at least 1 minute for each pair of distinct venues, and SHALL accept an "official" source note only with an https URL on an allowlisted host and path prefix and a retrievedOn date that is a real calendar date from 2000 to 2100.
5. IF the spare time of a connection is not a finite number, THEN THE classifyConnection function SHALL return "unknown".
6. IF a schedule has more than 200 commitments, THEN THE checkReservation function SHALL return "warn" with a reason that the schedule is too large.
7. THE checkReservation function SHALL NOT throw. IF anything unexpected goes wrong, THEN it SHALL return a Verdict with decision "block" and a fixed internal-error reason. Consumers SHALL treat a throw from any caller path as a block.
8. THE checkReservation function SHALL judge a schedule of 200 commitments in under 500 milliseconds.
9. THE Rules_Engine SHALL accept a time only when it is a real calendar date in the years 2000 to 2100 with an hour 0 to 23 and a minute and second 0 to 59, and SHALL treat any other value, including a value that is not text, as missing. An eventTimezone that is not text SHALL be treated as unrecognised.
10. THE checkReservation function SHALL read Context.now and SHALL return "warn" when the candidate has already ended, or when boarding has closed for a reservable candidate, or when the candidate has no seats left or is walk-up only. IF Context.now is not usable, THEN it SHALL report the timing check as missing data.
11. THE checkReservation function SHALL judge the nearest earlier and later commitments within 12 hours, across midnight. A reserved commitment whose session is not in the Sessions_Lookup SHALL use its own start and end times. Personal time with no location SHALL mean "stay put": it takes the venue of the commitment before it, no Connection is judged into it, and its missing location SHALL NOT be reported as missing data.
12. THE findRebookingOptions function SHALL treat -R, -R1, -R2 and so on, in any case, as repeat suffixes, SHALL NOT offer the original session (when its id is given) as its own alternative, and SHALL match nothing for an empty base code.
13. THE planSafeSwap function SHALL return outcome "unknown" when Context.now is not usable or the Repeat has already ended. The outcome "safe" SHALL mean only that nothing overlaps.
