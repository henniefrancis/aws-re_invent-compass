// A test-local normaliser, written from the S1 design (S1 `normaliseSession` is not merged
// into this branch yet). The provenance test compares the demo catalog with this mapping.
// When S1 merges, the test switches to `normaliseSession` from `@compass/core/catalog`.

import type { NormalisedSession, SessionWire } from '@compass/contracts';

const pad = (n: number): string => String(n).padStart(2, '0');

function offsetOf(zone: string, date: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const value = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return value === 'GMT' ? 'Z' : value.replace('GMT', '');
}

/** The session as the S1 normaliser makes it, for a record that has a usable sessionTime. */
export function normaliseWire(wire: SessionWire): NormalisedSession {
  const time = wire.sessionTime;
  if (
    time?.date === undefined ||
    time.time === undefined ||
    time.length === undefined ||
    time.timezone === undefined ||
    wire.abbreviation === undefined
  ) {
    throw new Error('The demo catalog needs records with a code and a usable session time.');
  }
  const missing: string[] = [];
  const optional = (name: 'type' | 'level' | 'venue' | 'room'): string | undefined => {
    const value = wire[name];
    if (value === undefined) {
      missing.push(name);
    }
    return value;
  };
  const type = optional('type');
  const level = optional('level');
  const venue = optional('venue');
  const room = optional('room');
  const [hour, minute] = time.time.split(':').map(Number) as [number, number];
  const endMinutes = hour * 60 + minute + Number(time.length);
  const offset = offsetOf(time.timezone, time.date);
  const repeat = /-R[0-9]?$/.exec(wire.abbreviation);
  const normalised: NormalisedSession = {
    sessionId: wire.sessionId,
    code: wire.abbreviation,
    title: wire.title,
    ...(type === undefined ? {} : { type }),
    ...(level === undefined ? {} : { level }),
    ...(venue === undefined ? {} : { venue }),
    ...(room === undefined ? {} : { room }),
    startsAt: `${time.date}T${pad(hour)}:${pad(minute)}:00${offset}`,
    endsAt: `${time.date}T${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}:00${offset}`,
    isAllDay: wire.isAllDaySession === true,
    isReservable: wire.isReservable === true,
    seatAvailability: wire.seatAvailability ?? 'unknown',
    ...(repeat === null ? {} : { repeatOf: wire.abbreviation.slice(0, repeat.index) }),
    missingFields: missing,
  };
  return normalised;
}
