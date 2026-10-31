import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionWireSchema } from '@compass/contracts';
import { containsAnyWord } from '../../src/adapters/word-match.js';
import type { NormalisedSession, SessionWire } from '@compass/contracts';
import type { CatalogFilter, CatalogView, PlannerSession } from '../../src/ports/events-port.js';

/** The repository root, found by walking up to the package.json with workspaces. */
export function repoRoot(): string {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
        workspaces?: unknown;
      };
      if (manifest.workspaces !== undefined) {
        return current;
      }
    } catch {
      // keep walking up
    }
    current = dirname(current);
  }
}

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), 0);
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

function pad(value: number): string {
  return String(Math.abs(value)).padStart(2, '0');
}

/** Builds an ISO instant with offset from a wall-clock date and time in `timeZone`. */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetMinutes(wall, timeZone);
  const second = offsetMinutes(wall - first * 60000, timeZone);
  const sign = second < 0 ? '-' : '+';
  return `${date}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.trunc(second / 60))}:${pad(second % 60)}`;
}

/** A small stand-in for S1's normaliser, used only by tests. */
export function normaliseWire(wire: SessionWire): NormalisedSession {
  const missingFields: string[] = [];
  const time = wire.sessionTime;
  let startsAt: string | undefined;
  let endsAt: string | undefined;
  if (time?.date !== undefined && time.time !== undefined && time.timezone !== undefined) {
    startsAt = zonedIso(time.date, time.time, time.timezone);
    if (time.length !== undefined) {
      const offset = startsAt.slice(-6);
      const offsetMs =
        (offset.startsWith('-') ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) *
        60000;
      const endMs = Date.parse(startsAt) + Number(time.length) * 60000;
      endsAt = `${new Date(endMs + offsetMs).toISOString().slice(0, 19)}${offset}`;
    }
  }
  for (const key of ['type', 'level', 'venue'] as const) {
    if (wire[key] === undefined) {
      missingFields.push(key);
    }
  }
  if (startsAt === undefined) {
    missingFields.push('startsAt');
  }
  if (endsAt === undefined) {
    missingFields.push('endsAt');
  }
  const normalised: NormalisedSession = {
    sessionId: wire.sessionId,
    code: wire.abbreviation ?? wire.sessionId,
    title: wire.title,
    isAllDay: wire.isAllDaySession ?? false,
    isReservable: wire.isReservable ?? false,
    seatAvailability: wire.seatAvailability ?? 'unknown',
    missingFields,
  };
  if (wire.type !== undefined) normalised.type = wire.type;
  if (wire.level !== undefined) normalised.level = wire.level;
  if (wire.venue !== undefined) normalised.venue = wire.venue;
  if (wire.room !== undefined) normalised.room = wire.room;
  if (startsAt !== undefined) normalised.startsAt = startsAt;
  if (endsAt !== undefined) normalised.endsAt = endsAt;
  const code = normalised.code;
  if (/-R\d?$/.test(code)) normalised.repeatOf = code.replace(/-R\d?$/, '');
  return normalised;
}

/** Builds a CatalogView from wire sessions, the way S1's cache view behaves. */
export function buildCatalogView(wires: readonly SessionWire[]): CatalogView {
  const byId = new Map<string, PlannerSession>();
  const labels = new Set<string>();
  const wireById = new Map(wires.map((wire) => [wire.sessionId, wire]));
  for (const wire of wires) {
    byId.set(wire.sessionId, {
      session: normaliseWire(wire),
      services: wire.services ?? [],
    });
    for (const service of wire.services ?? []) {
      labels.add(service);
    }
  }
  return {
    byId,
    labels: [...labels].sort(),
    filter(filter: CatalogFilter): NormalisedSession[] {
      const text = filter.text?.toLowerCase();
      return [...byId.values()]
        .filter(({ session, services }) => {
          if (
            text !== undefined &&
            !session.title.toLowerCase().includes(text) &&
            !session.code.toLowerCase().includes(text)
          ) {
            return false;
          }
          if (
            filter.services !== undefined &&
            !filter.services.some((s) =>
              services.map((x) => x.toLowerCase()).includes(s.toLowerCase()),
            )
          ) {
            return false;
          }
          if (filter.level !== undefined && session.level !== filter.level) return false;
          if (filter.type !== undefined && session.type !== filter.type) return false;
          if (filter.day !== undefined && !session.startsAt?.startsWith(filter.day)) return false;
          if (filter.words !== undefined) {
            const wire = wireById.get(session.sessionId);
            return containsAnyWord(
              [session.title, wire?.abstract, ...(wire?.topics ?? []), ...services],
              filter.words,
            );
          }
          return true;
        })
        .map(({ session }) => session);
    },
  };
}

/** Parses fixtures/synthetic/catalog.json (read-only) into wire sessions. */
export function loadSyntheticWires(): SessionWire[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(repoRoot(), 'fixtures', 'synthetic', 'catalog.json'), 'utf8'),
  );
  return (raw as unknown[]).map((item) => SessionWireSchema.parse(item));
}

let cachedSynthetic: CatalogView | undefined;

/** A CatalogView over the synthetic catalog (built once; the view is never mutated). */
export function syntheticCatalogView(): CatalogView {
  cachedSynthetic ??= buildCatalogView(loadSyntheticWires());
  return cachedSynthetic;
}

/** A minimal wire session for tests that need a hand-built catalog. */
export function wireSession(sessionId: string, overrides: Partial<SessionWire> = {}): SessionWire {
  return {
    sessionId,
    title: `Title ${sessionId}`,
    abbreviation: sessionId.toUpperCase(),
    isReservable: true,
    type: 'Workshop',
    level: '300',
    venue: 'Encore',
    room: 'Room 1',
    services: ['compute'],
    sessionTime: {
      date: '2026-12-01',
      time: '10:00',
      length: '60',
      timezone: 'America/Los_Angeles',
    },
    ...overrides,
  };
}
