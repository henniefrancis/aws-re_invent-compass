import { describe, expect, test } from 'vitest';
import { sanitiseWire } from '../../src/catalog/sanitise-wire.js';
import { normaliseSession } from '../../src/catalog/normalise.js';
import { filterCatalog } from '../../src/catalog/filter.js';
import type { SessionWire } from '@compass/contracts';

// Tests for wire sanitising and the wider text filter (events-client, S1, N1 and L1).
// Special characters are built with String.fromCodePoint so the source holds no raw
// control or bidirectional characters.

const ch = (code: number): string => String.fromCodePoint(code);
const RLO = ch(0x202e);
const LRO = ch(0x202d);
const ZWSP = ch(0x200b);
const RLM = ch(0x200f);
const LRI = ch(0x2066);
const NUL = ch(0);
const BEL = ch(7);
const SOH = ch(1);

const dirty: SessionWire = {
  sessionId: 's1',
  title: `Deep${RLO}\ndive${ZWSP}`,
  abbreviation: `DAT${NUL}302`,
  abstract: `Para one\r\nPara${LRI} two`,
  type: 'Work\tshop',
  level: `3${RLM}00`,
  venue: `Ven${BEL}etian`,
  room: 'Room\n12',
  speakers: [{ name: `Alex${LRO} Gupta` }, {}],
  services: [`s3${ZWSP}`, 'lambda'],
  topics: ['a\ni'],
  tracks: [`t${SOH}`],
  focusAreas: [],
};

describe('events-client, N1: sanitiseWire', () => {
  test('every free-text field is cleaned and nothing else changes', () => {
    const clean = sanitiseWire(dirty);
    expect(clean).toEqual({
      sessionId: 's1',
      title: 'Deep dive',
      abbreviation: 'DAT302',
      abstract: 'Para one\nPara two',
      type: 'Work shop',
      level: '300',
      venue: 'Venetian',
      room: 'Room 12',
      speakers: [{ name: 'Alex Gupta' }, {}],
      services: ['s3', 'lambda'],
      topics: ['a i'],
      tracks: ['t'],
      focusAreas: [],
    });
    expect(dirty.title).toContain(RLO);
  });

  test('a minimal session is returned as is, and absent fields stay absent', () => {
    expect(sanitiseWire({ sessionId: 'x', title: 'Plain' })).toEqual({
      sessionId: 'x',
      title: 'Plain',
    });
  });

  test('normalising sanitises first, so the normalised view is clean too', () => {
    const s = normaliseSession(dirty, [{ name: 'Venetian' }], 'America/Los_Angeles');
    expect(s.title).toBe('Deep dive');
    expect(s.code).toBe('DAT302');
    expect(s.room).toBe('Room 12');
    expect(s.venue).toBe('Venetian');
  });
});

describe('events-client, L1: the text filter also searches code, room, venue and speakers', () => {
  const wire: SessionWire = {
    sessionId: 'f1',
    title: 'Serverless',
    abbreviation: 'SVS401',
    venue: 'Wynn',
    room: 'Ballroom Q',
    speakers: [{ name: 'Priya Natarajan' }, {}],
  };
  const entries = [{ session: normaliseSession(wire, undefined, 'UTC'), wire }];

  test('a code, room, venue or speaker name matches', () => {
    for (const text of ['svs401', 'ballroom', 'WYNN', 'natarajan', 'serverless']) {
      expect(filterCatalog(entries, { text })).toHaveLength(1);
    }
    expect(filterCatalog(entries, { text: 'nobody' })).toHaveLength(0);
  });
});
