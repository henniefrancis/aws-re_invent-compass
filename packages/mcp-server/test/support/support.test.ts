import { describe, expect, test } from 'vitest';
import net from 'node:net';
import {
  buildCatalogView,
  normaliseWire,
  syntheticCatalogView,
  wireSession,
  zonedIso,
} from './fake-catalog.js';
import { createFakeRuntime } from './fake-runtime.js';
import { installNetworkGuard } from './network-guard.js';

describe('test support', () => {
  test('the network guard records and blocks fetch and sockets, then restores them', async () => {
    const guard = installNetworkGuard();
    try {
      await expect(fetch('https://example.test')).rejects.toThrow('network guard');
      expect(() => new net.Socket().connect(1, '127.0.0.1')).toThrow('network guard');
      expect(guard.attempts).toEqual(['fetch', 'socket']);
    } finally {
      guard.restore();
    }
    expect(guard.attempts).toHaveLength(2);
  });

  test('zonedIso gives Pacific offsets for winter dates', () => {
    expect(zonedIso('2026-12-01', '10:30', 'America/Los_Angeles')).toBe(
      '2026-12-01T10:30:00-08:00',
    );
  });

  test('the synthetic catalog view normalises times and repeats', () => {
    const view = syntheticCatalogView();
    expect(view.byId.size).toBe(120);
    const repeat = [...view.byId.values()].find((s) => s.session.repeatOf !== undefined);
    expect(repeat?.session.code).toMatch(/-R\d?$/);
    const first = view.byId.get('syn-001')?.session;
    expect(first?.startsAt).toBe('2026-11-30T14:30:00-08:00');
    expect(first?.endsAt).toBe('2026-11-30T16:30:00-08:00');
  });

  test('normaliseWire records missing fields', () => {
    const wire = wireSession('x1', { type: undefined, sessionTime: undefined });
    const session = normaliseWire(wire);
    expect(session.missingFields).toEqual(expect.arrayContaining(['type', 'startsAt', 'endsAt']));
    expect(buildCatalogView([wire]).filter({ text: 'title' })).toHaveLength(1);
  });

  test('the fake runtime composes recording fakes', async () => {
    const fake = createFakeRuntime({ catalog: buildCatalogView([wireSession('a1')]) });
    await fake.runtime.events.reserve(['a1']);
    expect(fake.events.writeCalls).toHaveLength(1);
    expect(fake.events.schedule.reserved).toEqual(['a1']);
  });
});
